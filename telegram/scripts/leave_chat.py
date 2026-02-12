#!/usr/bin/env python3
"""
Leave a Telegram group chat.

Usage:
  uv run scripts/leave_chat.py <chat>

Chat can be a name, @username, or numeric ID.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, resolve_chat

from telethon.errors import FloodWaitError


async def leave_chat(chat_arg: str, delete: bool = False):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    entity = await resolve_chat(client, chat_arg)
    if not entity:
        await client.disconnect()
        error(f"Chat not found: '{chat_arg}'", "CHAT_NOT_FOUND")

    chat_name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Unknown"

    try:
        if delete:
            await client.delete_dialog(entity)
        else:
            from telethon.tl.functions.messages import DeleteChatUserRequest
            from telethon.tl.types import Chat, Channel

            if isinstance(entity, Channel):
                from telethon.tl.functions.channels import LeaveChannelRequest
                await client(LeaveChannelRequest(entity))
            elif isinstance(entity, Chat):
                me = await client.get_me()
                await client(DeleteChatUserRequest(chat_id=entity.id, user_id=me.id))
            else:
                await client.delete_dialog(entity)
    except FloodWaitError as e:
        await client.disconnect()
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        await client.disconnect()
        error(f"Failed to leave chat: {e}", "LEAVE_ERROR")

    await client.disconnect()

    output({
        "success": True,
        "chat": chat_name,
        "action": "deleted" if delete else "left",
    })


def main():
    parser = argparse.ArgumentParser(description="Leave a Telegram group chat")
    parser.add_argument("chat", help="Chat name, @username, or numeric ID")
    parser.add_argument("--delete", action="store_true", help="Also delete the chat history")
    args = parser.parse_args()

    asyncio.run(leave_chat(args.chat, args.delete))


if __name__ == "__main__":
    main()
