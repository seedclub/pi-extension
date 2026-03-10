#!/usr/bin/env python3
"""
Export an invite link for a Telegram group or channel.

Usage:
  uv run scripts/export_invite_link.py <chat>
  uv run scripts/export_invite_link.py <chat> --title "Custom title for the link"
  uv run scripts/export_invite_link.py <chat> --expire-hours 24
  uv run scripts/export_invite_link.py <chat> --member-limit 1

Returns JSON with the invite link URL.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, resolve_chat, classify_entity

from telethon.errors import FloodWaitError, ChatAdminRequiredError
from telethon.tl.functions.messages import ExportChatInviteRequest
from telethon.tl.types import Chat, Channel


async def export_invite_link(
    chat_arg: str,
    title: str | None = None,
    expire_hours: int | None = None,
    member_limit: int | None = None,
):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    entity = await resolve_chat(client, chat_arg)
    if not entity:
        await client.disconnect()
        error(f"Chat not found: '{chat_arg}'", "CHAT_NOT_FOUND")

    chat_type = classify_entity(entity)
    if chat_type not in ("group", "supergroup", "channel"):
        await client.disconnect()
        error(f"Cannot create invite link for chat type: {chat_type}", "INVALID_CHAT_TYPE")

    try:
        # Build request kwargs
        kwargs = {"peer": entity}
        if title:
            kwargs["title"] = title
        if expire_hours:
            from datetime import datetime, timezone, timedelta
            expire_date = datetime.now(timezone.utc) + timedelta(hours=expire_hours)
            kwargs["expire_date"] = expire_date
        if member_limit:
            kwargs["usage_limit"] = member_limit

        result = await client(ExportChatInviteRequest(**kwargs))

        chat_name = getattr(entity, "title", None) or str(entity.id)

        await client.disconnect()

        output({
            "success": True,
            "link": result.link,
            "chatId": str(entity.id),
            "chatName": chat_name,
            "chatType": chat_type,
            "title": getattr(result, "title", None),
            "expireDate": result.expire_date.isoformat() if getattr(result, "expire_date", None) else None,
            "usageLimit": getattr(result, "usage_limit", None),
        })

    except ChatAdminRequiredError:
        await client.disconnect()
        error("Admin privileges required to create invite link", "ADMIN_REQUIRED")
    except FloodWaitError as e:
        await client.disconnect()
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        await client.disconnect()
        error(f"Failed to export invite link: {e}", "EXPORT_ERROR")


def main():
    parser = argparse.ArgumentParser(description="Export a Telegram group/channel invite link")
    parser.add_argument("chat", help="Chat name, @username, or numeric ID")
    parser.add_argument("--title", type=str, help="Custom title for the invite link")
    parser.add_argument("--expire-hours", type=int, help="Link expires after this many hours")
    parser.add_argument("--member-limit", type=int, help="Max number of users who can join via this link")
    args = parser.parse_args()

    asyncio.run(export_invite_link(args.chat, args.title, args.expire_hours, args.member_limit))


if __name__ == "__main__":
    main()
