#!/usr/bin/env python3
"""
Send a message to a Telegram chat.

Usage:
  uv run scripts/send.py <chat> <message> [--reply-to <msg_id>]
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error

from telethon.errors import FloodWaitError
from telethon.tl.types import User, Chat, Channel


async def resolve_chat(client, chat_arg: str):
    """Resolve a chat argument to a Telethon entity."""
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


async def send_message(chat_arg: str, message: str, reply_to: int | None = None):
    if not message.strip():
        error("Message cannot be empty", "INVALID_INPUT")

    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    entity = await resolve_chat(client, chat_arg)
    if not entity:
        await client.disconnect()
        error(f"Chat not found: '{chat_arg}'", "CHAT_NOT_FOUND")

    try:
        result = await client.send_message(
            entity,
            message,
            reply_to=reply_to,
        )
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to send message: {e}", "SEND_ERROR")

    chat_name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Unknown"

    await client.disconnect()

    output({
        "success": True,
        "messageId": result.id,
        "chat": chat_name,
        "date": result.date.isoformat() if result.date else None,
    })


def main():
    parser = argparse.ArgumentParser(description="Send a Telegram message")
    parser.add_argument("chat", help="Chat name, @username, or numeric ID")
    parser.add_argument("message", help="Message text to send")
    parser.add_argument("--reply-to", type=int, help="Message ID to reply to")
    args = parser.parse_args()

    asyncio.run(send_message(args.chat, args.message, args.reply_to))


if __name__ == "__main__":
    main()
