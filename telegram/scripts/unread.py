#!/usr/bin/env python3
"""
List Telegram chats with unread messages, sorted by unread count.

Usage:
  uv run scripts/unread.py [--limit 20] [--min-unread 1]
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error

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


async def list_unread(limit: int = 20, min_unread: int = 1):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    try:
        dialogs = await client.get_dialogs(limit=500)
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to get dialogs: {e}", "API_ERROR")

    # Filter to unread and sort by count
    unread_chats = []
    total_unread = 0

    for d in dialogs:
        if d.unread_count < min_unread:
            continue

        total_unread += d.unread_count
        entity = d.entity

        last_msg = None
        if d.message:
            last_msg = {
                "date": d.message.date.isoformat() if d.message.date else None,
                "text": (d.message.text or "")[:200] if d.message.text else None,
            }

        chat = {
            "id": str(entity.id),
            "name": d.name or "Unknown",
            "type": classify_entity(entity),
            "unreadCount": d.unread_count,
            "mentionCount": d.unread_mentions_count,
            "lastMessage": last_msg,
            "username": getattr(entity, "username", None),
        }

        unread_chats.append(chat)

    # Sort by unread count descending, mentions first
    unread_chats.sort(key=lambda c: (c["mentionCount"] or 0, c["unreadCount"]), reverse=True)
    unread_chats = unread_chats[:limit]

    await client.disconnect()

    output({
        "chats": unread_chats,
        "count": len(unread_chats),
        "totalUnread": total_unread,
    })


def main():
    parser = argparse.ArgumentParser(description="List unread Telegram chats")
    parser.add_argument("--limit", type=int, default=20, help="Max chats (default: 20)")
    parser.add_argument("--min-unread", type=int, default=1, help="Min unread count (default: 1)")
    args = parser.parse_args()

    asyncio.run(list_unread(args.limit, args.min_unread))


if __name__ == "__main__":
    main()
