#!/usr/bin/env python3
"""
List Telegram dialogs (chats, groups, channels, DMs).

Usage:
  uv run scripts/chats.py [--limit 50] [--type group|channel|user|all] [--archived]
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_sender, format_message

from telethon.tl.types import User, Chat, Channel
from telethon.errors import FloodWaitError


def classify_dialog(dialog) -> str:
    """Classify a dialog entity into a type string."""
    entity = dialog.entity
    if isinstance(entity, User):
        return "bot" if entity.bot else "user"
    elif isinstance(entity, Chat):
        return "group"
    elif isinstance(entity, Channel):
        return "channel" if entity.broadcast else "supergroup"
    return "unknown"


async def list_chats(limit: int = 50, chat_type: str = "all", archived: bool = False):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    try:
        dialogs = await client.get_dialogs(
            limit=limit * 2 if chat_type != "all" else limit,
            archived=archived,
        )
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to get dialogs: {e}", "API_ERROR")

    chats = []
    for d in dialogs:
        dtype = classify_dialog(d)
        if chat_type != "all" and dtype != chat_type:
            continue

        entity = d.entity
        last_msg = None
        if d.message:
            last_msg = {
                "date": d.message.date.isoformat() if d.message.date else None,
                "sender": d.message.sender.first_name if hasattr(d.message, "sender") and d.message.sender and hasattr(d.message.sender, "first_name") else None,
                "text": (d.message.text or "")[:200] if d.message.text else None,
            }

        chat = {
            "id": str(entity.id),
            "name": d.name or "Unknown",
            "type": dtype,
            "unreadCount": d.unread_count,
            "lastMessage": last_msg,
            "username": getattr(entity, "username", None),
        }

        if isinstance(entity, (Chat, Channel)):
            chat["memberCount"] = getattr(entity, "participants_count", None)

        chats.append(chat)

        if len(chats) >= limit:
            break

    await client.disconnect()
    output({"chats": chats, "count": len(chats)})


def main():
    parser = argparse.ArgumentParser(description="List Telegram chats")
    parser.add_argument("--limit", type=int, default=50, help="Max chats to return (default: 50)")
    parser.add_argument("--type", dest="chat_type", default="all",
                        choices=["group", "supergroup", "channel", "user", "bot", "all"],
                        help="Filter by chat type")
    parser.add_argument("--archived", action="store_true", help="Include archived chats")
    parser.add_argument("--sync", action="store_true", help="Push chats to Seed Network API")
    args = parser.parse_args()

    if args.sync:
        asyncio.run(list_chats_and_sync(args.limit, args.chat_type, args.archived))
    else:
        asyncio.run(list_chats(args.limit, args.chat_type, args.archived))


async def list_chats_and_sync(limit: int = 500, chat_type: str = "all", archived: bool = False):
    """Fetch chats from Telegram and push to Seed Network API."""
    from _sync import sync_chats

    client = get_client()
    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    try:
        dialogs = await client.get_dialogs(limit=limit)
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to get dialogs: {e}", "API_ERROR")

    chats_to_sync = []
    for d in dialogs:
        dtype = classify_dialog(d)
        if chat_type != "all" and dtype != chat_type:
            continue

        entity = d.entity
        chats_to_sync.append({
            "telegramId": str(entity.id),
            "name": d.name or "Unknown",
            "type": dtype,
            "username": getattr(entity, "username", None),
            "description": getattr(entity, "about", None) if hasattr(entity, "about") else None,
            "memberCount": getattr(entity, "participants_count", None),
        })

    await client.disconnect()

    result = sync_chats(chats_to_sync)
    if "error" in result:
        error(result["error"], result.get("code", "SYNC_ERROR"))

    output({
        "synced": len(chats_to_sync),
        "created": result.get("created", 0),
        "updated": result.get("updated", 0),
    })


if __name__ == "__main__":
    main()
