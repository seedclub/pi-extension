#!/usr/bin/env python3
"""
Read messages from a Telegram chat.

Usage:
  uv run scripts/read.py <chat> [--limit 50] [--offset-id 0] [--since 2026-02-09] [--until 2026-02-10] [--from-user alice]

<chat> can be: chat name (fuzzy matched), @username, numeric chat ID, or invite link.
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_message

from telethon.errors import FloodWaitError
from telethon.tl.types import User, Chat, Channel


async def resolve_chat(client, chat_arg: str):
    """Resolve a chat argument to a Telethon entity."""
    # Try as numeric ID
    try:
        chat_id = int(chat_arg)
        return await client.get_entity(chat_id)
    except (ValueError, Exception):
        pass

    # Try as @username
    if chat_arg.startswith("@"):
        try:
            return await client.get_entity(chat_arg)
        except Exception:
            pass

    # Try as exact or fuzzy name match against dialogs
    try:
        dialogs = await client.get_dialogs(limit=200)
        # Exact match first
        for d in dialogs:
            if d.name and d.name.lower() == chat_arg.lower():
                return d.entity

        # Fuzzy: starts with
        for d in dialogs:
            if d.name and d.name.lower().startswith(chat_arg.lower()):
                return d.entity

        # Fuzzy: contains
        for d in dialogs:
            if d.name and chat_arg.lower() in d.name.lower():
                return d.entity
    except Exception:
        pass

    return None


def classify_entity(entity) -> str:
    if isinstance(entity, User):
        return "bot" if entity.bot else "user"
    elif isinstance(entity, Chat):
        return "group"
    elif isinstance(entity, Channel):
        return "channel" if entity.broadcast else "supergroup"
    return "unknown"


async def read_messages(
    chat_arg: str,
    limit: int = 50,
    offset_id: int = 0,
    since: str | None = None,
    until: str | None = None,
    from_user: str | None = None,
):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    entity = await resolve_chat(client, chat_arg)
    if not entity:
        await client.disconnect()
        error(f"Chat not found: '{chat_arg}'. Use telegram_chats to list available chats.", "CHAT_NOT_FOUND")

    # Parse date filters
    offset_date = None
    if until:
        try:
            offset_date = datetime.fromisoformat(until).replace(tzinfo=timezone.utc)
        except ValueError:
            # Try date-only
            offset_date = datetime.strptime(until, "%Y-%m-%d").replace(tzinfo=timezone.utc, hour=23, minute=59, second=59)

    min_date = None
    if since:
        try:
            min_date = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)
        except ValueError:
            min_date = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    # Resolve from_user
    from_entity = None
    if from_user:
        try:
            from_entity = await client.get_entity(from_user if from_user.startswith("@") else f"@{from_user}")
        except Exception:
            # Try as numeric ID
            try:
                from_entity = await client.get_entity(int(from_user))
            except Exception:
                await client.disconnect()
                error(f"User not found: '{from_user}'", "USER_NOT_FOUND")

    try:
        # Fetch more than needed to account for date filtering
        fetch_limit = limit * 2 if min_date else limit
        messages = await client.get_messages(
            entity,
            limit=fetch_limit,
            offset_id=offset_id,
            offset_date=offset_date,
            from_user=from_entity,
        )
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to read messages: {e}", "API_ERROR")

    # Filter by min_date and format
    formatted = []
    for msg in messages:
        if min_date and msg.date and msg.date < min_date:
            continue
        formatted.append(format_message(msg))
        if len(formatted) >= limit:
            break

    # Chat info
    chat_name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Unknown"
    chat_info = {
        "id": str(entity.id),
        "name": chat_name,
        "type": classify_entity(entity),
    }

    await client.disconnect()

    output({
        "chat": chat_info,
        "messages": formatted,
        "count": len(formatted),
        "hasMore": len(messages) >= fetch_limit,
    })


def main():
    parser = argparse.ArgumentParser(description="Read messages from a Telegram chat")
    parser.add_argument("chat", help="Chat name, @username, or numeric ID")
    parser.add_argument("--limit", type=int, default=50, help="Max messages (default: 50)")
    parser.add_argument("--offset-id", type=int, default=0, help="Start from this message ID")
    parser.add_argument("--since", type=str, help="Only messages after this date (ISO 8601 or YYYY-MM-DD)")
    parser.add_argument("--until", type=str, help="Only messages before this date")
    parser.add_argument("--from-user", type=str, help="Filter by sender (@username or user ID)")
    parser.add_argument("--sync", action="store_true", help="Push messages to Seed Network API")
    args = parser.parse_args()

    if args.sync:
        asyncio.run(read_and_sync(args.chat, args.limit, args.offset_id, args.since, args.until, args.from_user))
    else:
        asyncio.run(read_messages(args.chat, args.limit, args.offset_id, args.since, args.until, args.from_user))


async def read_and_sync(
    chat_arg: str,
    limit: int = 200,
    offset_id: int = 0,
    since: str | None = None,
    until: str | None = None,
    from_user: str | None = None,
):
    """Read messages and push to Seed Network API."""
    from _sync import sync_messages

    client = get_client()
    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    entity = await resolve_chat(client, chat_arg)
    if not entity:
        await client.disconnect()
        error(f"Chat not found: '{chat_arg}'", "CHAT_NOT_FOUND")

    # Parse date filters
    offset_date = None
    if until:
        try:
            offset_date = datetime.fromisoformat(until).replace(tzinfo=timezone.utc)
        except ValueError:
            offset_date = datetime.strptime(until, "%Y-%m-%d").replace(tzinfo=timezone.utc, hour=23, minute=59, second=59)

    min_date = None
    if since:
        try:
            min_date = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)
        except ValueError:
            min_date = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    try:
        messages = await client.get_messages(
            entity,
            limit=limit,
            offset_id=offset_id,
            offset_date=offset_date,
        )
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to read messages: {e}", "API_ERROR")

    # Format for API
    api_messages = []
    for msg in messages:
        if min_date and msg.date and msg.date < min_date:
            continue

        sender = msg.sender
        sender_id = str(sender.id) if sender and hasattr(sender, "id") else None
        sender_name = None
        sender_username = None
        sender_is_bot = False

        if sender:
            from telethon.tl.types import User as TUser
            if isinstance(sender, TUser):
                parts = [sender.first_name or "", sender.last_name or ""]
                sender_name = " ".join(p for p in parts if p) or "Unknown"
                sender_username = sender.username
                sender_is_bot = sender.bot or False
            else:
                sender_name = getattr(sender, "title", None) or str(sender)
                sender_username = getattr(sender, "username", None)

        api_msg = {
            "telegramMessageId": str(msg.id),
            "senderId": sender_id,
            "senderName": sender_name,
            "senderUsername": sender_username,
            "senderIsBot": sender_is_bot,
            "text": msg.text or None,
            "date": msg.date.isoformat() if msg.date else None,
            "replyToMessageId": str(msg.reply_to.reply_to_msg_id) if msg.reply_to else None,
            "mediaType": None,  # Simplified for sync
            "views": msg.views,
            "isPinned": msg.pinned or False,
            "editDate": msg.edit_date.isoformat() if msg.edit_date else None,
        }
        api_messages.append(api_msg)

    await client.disconnect()

    if not api_messages:
        output({"synced": 0, "chat": chat_arg, "note": "No messages to sync"})
        return

    result = sync_messages(str(entity.id), api_messages)
    if "error" in result:
        error(result["error"], result.get("code", "SYNC_ERROR"))

    output({
        "synced": len(api_messages),
        "created": result.get("created", 0),
        "updated": result.get("updated", 0),
        "skipped": result.get("skipped", 0),
        "chat": result.get("chat", {}).get("name", chat_arg),
    })


if __name__ == "__main__":
    main()
