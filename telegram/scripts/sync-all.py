#!/usr/bin/env python3
"""
Sync all Telegram chats and messages to the Seed Network API.

Usage:
  uv run scripts/sync-all.py                           # Incremental sync (new messages only)
  uv run scripts/sync-all.py --full                     # Full backfill of all enabled chats
  uv run scripts/sync-all.py --chat "Seed Club Deals"   # Sync specific chat(s)
  uv run scripts/sync-all.py --limit 200                # Messages per chat (default: 200)
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_sender
from _sync import sync_chats, sync_messages, api_request

from telethon.tl.types import User, Chat, Channel
from telethon.errors import FloodWaitError


def classify_entity(entity) -> str:
    if isinstance(entity, User):
        return "bot" if entity.bot else "user"
    elif isinstance(entity, Chat):
        return "group"
    elif isinstance(entity, Channel):
        return "channel" if entity.broadcast else "supergroup"
    return "unknown"


async def resolve_chat(client, chat_arg: str):
    try:
        chat_id = int(chat_arg)
        return await client.get_entity(chat_id)
    except (ValueError, Exception):
        pass
    if chat_arg.startswith("@"):
        try:
            return await client.get_entity(chat_arg)
        except Exception:
            pass
    try:
        dialogs = await client.get_dialogs(limit=200)
        for d in dialogs:
            if d.name and d.name.lower() == chat_arg.lower():
                return d.entity
        for d in dialogs:
            if d.name and chat_arg.lower() in d.name.lower():
                return d.entity
    except Exception:
        pass
    return None


def format_msg_for_api(msg) -> dict:
    """Format a Telethon message for the Seed Network API."""
    sender = msg.sender
    sender_id = str(sender.id) if sender and hasattr(sender, "id") else None
    sender_name = None
    sender_username = None
    sender_is_bot = False

    if sender:
        if isinstance(sender, User):
            parts = [sender.first_name or "", sender.last_name or ""]
            sender_name = " ".join(p for p in parts if p) or "Unknown"
            sender_username = sender.username
            sender_is_bot = sender.bot or False
        else:
            sender_name = getattr(sender, "title", None) or str(sender)
            sender_username = getattr(sender, "username", None)

    return {
        "telegramMessageId": str(msg.id),
        "senderId": sender_id,
        "senderName": sender_name,
        "senderUsername": sender_username,
        "senderIsBot": sender_is_bot,
        "text": msg.text or None,
        "date": msg.date.isoformat() if msg.date else None,
        "replyToMessageId": str(msg.reply_to.reply_to_msg_id) if msg.reply_to else None,
        "mediaType": None,
        "views": msg.views,
        "isPinned": msg.pinned or False,
        "editDate": msg.edit_date.isoformat() if msg.edit_date else None,
    }


async def do_sync(
    chat_names: list[str] | None = None,
    full: bool = False,
    msg_limit: int = 200,
):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    # Step 1: Sync all chats metadata
    print(json.dumps({"status": "syncing_chats"}), file=sys.stderr)

    try:
        dialogs = await client.get_dialogs(limit=500)
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")

    chats_to_sync = []
    for d in dialogs:
        entity = d.entity
        chats_to_sync.append({
            "telegramId": str(entity.id),
            "name": d.name or "Unknown",
            "type": classify_entity(entity),
            "username": getattr(entity, "username", None),
            "memberCount": getattr(entity, "participants_count", None),
        })

    chat_result = sync_chats(chats_to_sync)
    if "error" in chat_result:
        error(chat_result["error"], chat_result.get("code", "SYNC_ERROR"))

    # Step 2: Determine which chats to sync messages from
    if chat_names:
        # Specific chats
        target_dialogs = []
        for name in chat_names:
            entity = await resolve_chat(client, name)
            if entity:
                target_dialogs.append((name, entity))
            else:
                print(json.dumps({"warning": f"Chat not found: {name}"}), file=sys.stderr)
    else:
        # Get enabled chats from API
        api_chats = api_request("GET", "/telegram/chats?limit=200")
        if "error" in api_chats:
            # Fall back to all groups/channels
            target_dialogs = [
                (d.name, d.entity) for d in dialogs
                if classify_entity(d) in ("supergroup", "group", "channel")
            ]
        else:
            enabled_ids = {
                c["telegramId"]
                for c in api_chats.get("chats", [])
                if c.get("syncEnabled", True)
            }
            target_dialogs = [
                (d.name, d.entity) for d in dialogs
                if str(d.entity.id) in enabled_ids
            ]

    # Step 3: Sync messages for each target chat
    total_synced = 0
    chat_results = []

    for chat_name, entity in target_dialogs:
        telegram_id = str(entity.id)
        print(json.dumps({"status": "syncing_messages", "chat": chat_name}), file=sys.stderr)

        try:
            if full:
                # Full history — paginate through everything
                all_msgs = []
                async for msg in client.iter_messages(entity, limit=msg_limit):
                    all_msgs.append(format_msg_for_api(msg))
                messages = all_msgs
            else:
                # Incremental — just recent messages
                raw_msgs = await client.get_messages(entity, limit=msg_limit)
                messages = [format_msg_for_api(m) for m in raw_msgs]
        except FloodWaitError as e:
            print(json.dumps({"warning": f"Rate limited on {chat_name}, waiting {e.seconds}s"}), file=sys.stderr)
            await asyncio.sleep(e.seconds)
            continue
        except Exception as e:
            print(json.dumps({"warning": f"Failed to read {chat_name}: {e}"}), file=sys.stderr)
            continue

        if not messages:
            continue

        result = sync_messages(telegram_id, messages)
        if "error" in result:
            print(json.dumps({"warning": f"Sync failed for {chat_name}: {result['error']}"}), file=sys.stderr)
            continue

        synced = result.get("created", 0) + result.get("updated", 0)
        total_synced += synced
        chat_results.append({
            "chat": chat_name,
            "synced": len(messages),
            "created": result.get("created", 0),
            "updated": result.get("updated", 0),
            "skipped": result.get("skipped", 0),
        })

        # Small delay between chats to avoid rate limiting
        await asyncio.sleep(0.5)

    await client.disconnect()

    output({
        "chatsSynced": chat_result.get("created", 0) + chat_result.get("updated", 0),
        "messagesSynced": total_synced,
        "chatDetails": chat_results,
    })


def main():
    parser = argparse.ArgumentParser(description="Sync Telegram to Seed Network")
    parser.add_argument("--full", action="store_true", help="Full backfill (not just recent)")
    parser.add_argument("--chat", action="append", dest="chats", help="Sync specific chat(s)")
    parser.add_argument("--limit", type=int, default=200, help="Messages per chat (default: 200)")
    args = parser.parse_args()

    asyncio.run(do_sync(args.chats, args.full, args.limit))


if __name__ == "__main__":
    main()
