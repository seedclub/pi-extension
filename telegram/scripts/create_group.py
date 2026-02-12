#!/usr/bin/env python3
"""
Create a Telegram group chat and optionally send a first message.

Usage:
  uv run scripts/create_group.py <title> --users <user1> <user2> [--message <msg>]

Users can be @usernames, numeric IDs, or contact names.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_sender

from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import CreateChatRequest
from telethon.tl.functions.contacts import SearchRequest


async def resolve_user(client, user_arg: str):
    """Resolve a user argument to a Telethon InputUser entity."""
    # Try as numeric ID
    try:
        user_id = int(user_arg)
        return await client.get_entity(user_id)
    except (ValueError, Exception):
        pass

    # Try as @username
    username = user_arg if user_arg.startswith("@") else f"@{user_arg}"
    try:
        return await client.get_entity(username)
    except Exception:
        pass

    # Try contact search
    try:
        result = await client(SearchRequest(q=user_arg, limit=10))
        if result.users:
            # Exact match on name
            for u in result.users:
                name_parts = [u.first_name or "", u.last_name or ""]
                full_name = " ".join(p for p in name_parts if p)
                if full_name.lower() == user_arg.lower():
                    return u
            # Exact match on username
            for u in result.users:
                if u.username and u.username.lower() == user_arg.lower().lstrip("@"):
                    return u
            # Partial match fallback — return first result
            return result.users[0]
    except Exception:
        pass

    return None


async def create_group(title: str, user_args: list[str], message: str | None = None):
    if not user_args:
        error("At least one user is required", "INVALID_INPUT")
    if not title.strip():
        error("Group title cannot be empty", "INVALID_INPUT")

    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    # Resolve all users
    resolved_users = []
    failed_users = []
    for user_arg in user_args:
        entity = await resolve_user(client, user_arg)
        if entity:
            resolved_users.append(entity)
        else:
            failed_users.append(user_arg)

    if failed_users:
        await client.disconnect()
        error(f"Could not resolve users: {', '.join(failed_users)}", "USER_NOT_FOUND")

    if not resolved_users:
        await client.disconnect()
        error("No valid users to add to group", "INVALID_INPUT")

    # Create the group
    try:
        result = await client(CreateChatRequest(
            users=resolved_users,
            title=title,
        ))
    except FloodWaitError as e:
        await client.disconnect()
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        await client.disconnect()
        error(f"Failed to create group: {e}", "CREATE_ERROR")

    # Extract chat info from the result
    # CreateChatRequest returns InvitedUsers with .updates containing the Updates object
    updates = getattr(result, 'updates', result)
    chats = getattr(updates, 'chats', [])
    chat = chats[0] if chats else None
    chat_id = chat.id if chat else None
    chat_title = chat.title if chat else title

    # Send the first message if provided
    first_message = None
    if message and message.strip() and chat:
        try:
            entity = await client.get_entity(chat_id)
            msg_result = await client.send_message(entity, message)
            first_message = {
                "messageId": msg_result.id,
                "text": message,
                "date": msg_result.date.isoformat() if msg_result.date else None,
            }
        except Exception as e:
            # Group was created but message failed — still report success
            first_message = {"error": f"Group created but failed to send message: {e}"}

    members = [format_sender(u) for u in resolved_users]

    await client.disconnect()

    output({
        "success": True,
        "chatId": chat_id,
        "title": chat_title,
        "members": members,
        "memberCount": len(members) + 1,  # +1 for creator
        "firstMessage": first_message,
    })


def main():
    parser = argparse.ArgumentParser(description="Create a Telegram group chat")
    parser.add_argument("title", help="Group chat title")
    parser.add_argument("--users", nargs="+", required=True, help="Users to add (@username, ID, or contact name)")
    parser.add_argument("--message", type=str, help="First message to send in the group")
    args = parser.parse_args()

    asyncio.run(create_group(args.title, args.users, args.message))


if __name__ == "__main__":
    main()
