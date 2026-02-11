#!/usr/bin/env python3
"""
List or search Telegram contacts.

Usage:
  uv run scripts/contacts.py [--search <query>]
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_sender

from telethon.errors import FloodWaitError
from telethon.tl.functions.contacts import GetContactsRequest, SearchRequest


async def list_contacts(search: str | None = None):
    client = get_client()

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect: {e}", "CONNECTION_ERROR")

    try:
        if search:
            result = await client(SearchRequest(q=search, limit=50))
            contacts = [format_sender(u) for u in result.users]
        else:
            result = await client(GetContactsRequest(hash=0))
            contacts = [format_sender(u) for u in result.users]
    except FloodWaitError as e:
        error(f"Rate limited. Retry in {e.seconds}s", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to get contacts: {e}", "API_ERROR")

    await client.disconnect()

    output({
        "contacts": contacts,
        "count": len(contacts),
    })


def main():
    parser = argparse.ArgumentParser(description="List Telegram contacts")
    parser.add_argument("--search", type=str, help="Search by name or username")
    args = parser.parse_args()

    asyncio.run(list_contacts(args.search))


if __name__ == "__main__":
    main()
