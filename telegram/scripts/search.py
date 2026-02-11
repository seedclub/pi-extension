#!/usr/bin/env python3
"""
Search messages across Telegram chats.

Usage:
  uv run scripts/search.py <query> [--chat <chat>] [--limit 20] [--from-user alice] [--since 2026-01-01]
"""

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_message

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


def classify_entity(entity) -> str:
    if isinstance(entity, User):
        return "bot" if entity.bot else "user"
    elif isinstance(entity, Chat):
        return "group"
    elif isinstance(entity, Channel):
        return "channel" if entity.broadcast else "supergroup"
    return "unknown"


async def search_messages(
    query: str,
    chat_arg: str | None = None,
    limit: int = 20,
    from_user: str | None = None,
    since: str | None = None,
):
    if not query or len(query.strip()) < 2:
        error("Search query must be at least 2 characters", "INVALID_QUERY")

    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    # Resolve chat if specified
    entity = None
    if chat_arg:
        entity = await resolve_chat(client, chat_arg)
        if not entity:
            await client.disconnect()
            error(f"Chat not found: '{chat_arg}'", "CHAT_NOT_FOUND")

    # Resolve from_user
    from_entity = None
    if from_user:
        try:
            from_entity = await client.get_entity(from_user if from_user.startswith("@") else f"@{from_user}")
        except Exception:
            try:
                from_entity = await client.get_entity(int(from_user))
            except Exception:
                pass

    min_date = None
    if since:
        try:
            min_date = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)
        except ValueError:
            min_date = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    try:
        if entity:
            # Search within a specific chat
            messages = await client.get_messages(
                entity,
                search=query,
                limit=limit,
                from_user=from_entity,
            )
        else:
            # Global search across all chats
            from telethon.tl.functions.messages import SearchGlobalRequest
            from telethon.tl.types import InputMessagesFilterEmpty

            # Use iter_messages with search for global search
            messages = []
            async for msg in client.iter_messages(None, search=query, limit=limit * 2):
                messages.append(msg)
                if len(messages) >= limit * 2:
                    break
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Search failed: {e}", "API_ERROR")

    # Filter and format
    formatted = []
    for msg in messages:
        if min_date and msg.date and msg.date < min_date:
            continue

        formatted_msg = format_message(msg)

        # Add chat context for global searches
        if not entity and msg.chat:
            chat_name = getattr(msg.chat, "title", None) or getattr(msg.chat, "first_name", None) or "Unknown"
            formatted_msg["chat"] = {
                "id": str(msg.chat.id),
                "name": chat_name,
                "type": classify_entity(msg.chat),
            }

        formatted.append(formatted_msg)
        if len(formatted) >= limit:
            break

    await client.disconnect()

    result = {
        "query": query,
        "messages": formatted,
        "count": len(formatted),
    }
    if entity:
        chat_name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Unknown"
        result["chat"] = {"id": str(entity.id), "name": chat_name, "type": classify_entity(entity)}

    output(result)


def main():
    parser = argparse.ArgumentParser(description="Search Telegram messages")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--chat", type=str, help="Limit search to this chat")
    parser.add_argument("--limit", type=int, default=20, help="Max results (default: 20)")
    parser.add_argument("--from-user", type=str, help="Filter by sender")
    parser.add_argument("--since", type=str, help="Only messages after this date")
    args = parser.parse_args()

    asyncio.run(search_messages(args.query, args.chat, args.limit, args.from_user, args.since))


if __name__ == "__main__":
    main()
