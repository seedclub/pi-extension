#!/usr/bin/env python3
"""
Fetch new messages since last digest for all active chats.

Returns structured data for the LLM to process into action items.
Updates watermarks after successful fetch so the next run skips these messages.

Usage:
  uv run scripts/digest.py [--chats "Chat A,Chat B"] [--limit 100] [--include-read] [--dry-run]

Without --chats, processes all chats that have unread messages OR have watermarks
(so chats you've digested before get checked even if Telegram shows them as read).

--include-read: Also check watermarked chats even if Telegram says 0 unread.
--dry-run: Fetch and output but don't update watermarks.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_message, classify_entity
from _watermarks import load_watermarks, set_watermarks_batch

from telethon.errors import FloodWaitError


async def run_digest(
    chat_filter: list[str] | None = None,
    limit_per_chat: int = 100,
    include_read: bool = False,
    dry_run: bool = False,
):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    watermarks = load_watermarks()

    # Get all dialogs
    try:
        dialogs = await client.get_dialogs(limit=500)
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to get dialogs: {e}", "API_ERROR")

    # Decide which chats to process
    chats_to_process = []

    for d in dialogs:
        chat_id = str(d.entity.id)
        chat_name = d.name or "Unknown"
        has_watermark = chat_id in watermarks
        has_unread = d.unread_count > 0

        # If user specified chats, only include those
        if chat_filter:
            match = False
            for f in chat_filter:
                fl = f.lower()
                if chat_name.lower() == fl or fl in chat_name.lower():
                    match = True
                    break
                if getattr(d.entity, "username", None) and f.lstrip("@").lower() == d.entity.username.lower():
                    match = True
                    break
            if not match:
                continue
        else:
            # Auto-select: unread chats, or watermarked chats if include_read
            if not has_unread and not (include_read and has_watermark):
                continue

        chats_to_process.append({
            "dialog": d,
            "chatId": chat_id,
            "chatName": chat_name,
            "unreadCount": d.unread_count,
            "hasWatermark": has_watermark,
            "watermarkMessageId": watermarks.get(chat_id, {}).get("lastMessageId"),
        })

    if not chats_to_process:
        await client.disconnect()
        output({
            "chats": [],
            "totalNewMessages": 0,
            "note": "No chats with new messages since last digest.",
        })
        return

    # Fetch new messages from each chat
    digest_chats = []
    watermark_updates = []
    total_new = 0

    for chat in chats_to_process:
        d = chat["dialog"]
        entity = d.entity
        wm_msg_id = chat["watermarkMessageId"]

        try:
            # If we have a watermark, use min_id to get only newer messages
            kwargs = {"limit": limit_per_chat}
            if wm_msg_id:
                kwargs["min_id"] = int(wm_msg_id)

            messages = await client.get_messages(entity, **kwargs)
        except FloodWaitError as e:
            # Skip this chat, don't fail the whole digest
            digest_chats.append({
                "chat": {"id": chat["chatId"], "name": chat["chatName"], "type": classify_entity(entity)},
                "error": f"Rate limited ({e.seconds}s)",
                "messages": [],
                "newCount": 0,
            })
            continue
        except Exception as e:
            digest_chats.append({
                "chat": {"id": chat["chatId"], "name": chat["chatName"], "type": classify_entity(entity)},
                "error": str(e),
                "messages": [],
                "newCount": 0,
            })
            continue

        if not messages:
            continue

        # Format messages (newest first from Telegram, reverse for chronological)
        formatted = [format_message(msg) for msg in reversed(messages)]
        total_new += len(formatted)

        # Track the highest message ID for watermark
        max_msg_id = max(int(m["id"]) for m in formatted)

        digest_chats.append({
            "chat": {
                "id": chat["chatId"],
                "name": chat["chatName"],
                "type": classify_entity(entity),
                "username": getattr(entity, "username", None),
            },
            "messages": formatted,
            "newCount": len(formatted),
            "previousWatermark": wm_msg_id,
        })

        watermark_updates.append({
            "chatId": chat["chatId"],
            "messageId": max_msg_id,
            "chatName": chat["chatName"],
        })

    await client.disconnect()

    # Update watermarks (unless dry run)
    if not dry_run and watermark_updates:
        set_watermarks_batch(watermark_updates)

    output({
        "chats": digest_chats,
        "chatCount": len(digest_chats),
        "totalNewMessages": total_new,
        "watermarksUpdated": not dry_run and len(watermark_updates) > 0,
        "dryRun": dry_run,
    })


def main():
    parser = argparse.ArgumentParser(description="Fetch new messages for digest")
    parser.add_argument("--chats", type=str, help="Comma-separated chat names to check (default: all unread)")
    parser.add_argument("--limit", type=int, default=100, help="Max messages per chat (default: 100)")
    parser.add_argument("--include-read", action="store_true",
                        help="Also check previously-watermarked chats even if 0 unread")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch messages but don't update watermarks")
    args = parser.parse_args()

    chat_filter = [c.strip() for c in args.chats.split(",")] if args.chats else None
    asyncio.run(run_digest(chat_filter, args.limit, args.include_read, args.dry_run))


if __name__ == "__main__":
    main()
