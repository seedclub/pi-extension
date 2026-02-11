#!/usr/bin/env python3
"""
Get metadata about a Telegram chat.

Usage:
  uv run scripts/info.py <chat> [--all-members]
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_sender

from telethon.errors import FloodWaitError, ChatAdminRequiredError
from telethon.tl.types import User, Chat, Channel, ChannelParticipantsRecent
from telethon.tl.functions.channels import GetFullChannelRequest, GetParticipantsRequest
from telethon.tl.functions.messages import GetFullChatRequest


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


def classify_entity(entity) -> str:
    if isinstance(entity, User):
        return "bot" if entity.bot else "user"
    elif isinstance(entity, Chat):
        return "group"
    elif isinstance(entity, Channel):
        return "channel" if entity.broadcast else "supergroup"
    return "unknown"


async def get_info(chat_arg: str, all_members: bool = False):
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
    chat_name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Unknown"

    info = {
        "id": str(entity.id),
        "name": chat_name,
        "type": chat_type,
        "username": getattr(entity, "username", None),
    }

    # Get full info
    try:
        if isinstance(entity, Channel):
            full = await client(GetFullChannelRequest(entity))
            info["description"] = full.full_chat.about or None
            info["memberCount"] = full.full_chat.participants_count
            info["created"] = entity.date.isoformat() if entity.date else None

            # Pinned messages
            pinned = []
            try:
                async for msg in client.iter_messages(entity, filter=None, limit=5):
                    if msg.pinned:
                        pinned.append({
                            "id": str(msg.id),
                            "text": (msg.text or "")[:200],
                            "date": msg.date.isoformat() if msg.date else None,
                        })
            except Exception:
                pass
            info["pinnedMessages"] = pinned

            # Members (limited)
            members = []
            try:
                member_limit = 200 if all_members else 50
                result = await client(GetParticipantsRequest(
                    entity,
                    filter=ChannelParticipantsRecent(),
                    offset=0,
                    limit=member_limit,
                    hash=0,
                ))
                for u in result.users:
                    members.append(format_sender(u))
            except (ChatAdminRequiredError, Exception):
                info["membersNote"] = "Cannot access member list (admin required or restricted)"

            if members:
                info["members"] = members

        elif isinstance(entity, Chat):
            full = await client(GetFullChatRequest(entity.id))
            info["description"] = full.full_chat.about or None
            info["memberCount"] = getattr(full.full_chat, "participants_count", None)

            # Members from chat participants
            members = []
            if hasattr(full.full_chat, "participants") and full.full_chat.participants:
                for p in full.full_chat.participants.participants:
                    try:
                        user = await client.get_entity(p.user_id)
                        members.append(format_sender(user))
                    except Exception:
                        members.append({"id": str(p.user_id), "name": "Unknown"})
            if members:
                info["members"] = members

        elif isinstance(entity, User):
            info["phone"] = entity.phone
            info["isBot"] = entity.bot or False
            name_parts = [entity.first_name or "", entity.last_name or ""]
            info["fullName"] = " ".join(p for p in name_parts if p)
            if entity.status:
                status_name = type(entity.status).__name__
                info["status"] = status_name.replace("UserStatus", "").lower()

    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        info["error"] = f"Could not fetch full info: {e}"

    await client.disconnect()
    output(info)


def main():
    parser = argparse.ArgumentParser(description="Get Telegram chat info")
    parser.add_argument("chat", help="Chat name, @username, or numeric ID")
    parser.add_argument("--all-members", action="store_true", help="Fetch up to 200 members (default: 50)")
    args = parser.parse_args()

    asyncio.run(get_info(args.chat, args.all_members))


if __name__ == "__main__":
    main()
