#!/usr/bin/env python3
"""
Export full chat history as JSONL for backfill/indexing.

Usage:
  uv run scripts/history.py <chat> [--output /tmp/export.jsonl] [--since 2025-01-01] [--batch-size 100]

Not wrapped as a pi tool — this is for bulk operations.
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, format_message, resolve_chat, parse_date

from telethon.errors import FloodWaitError


async def export_history(
    chat_arg: str,
    output_path: str | None = None,
    since: str | None = None,
    batch_size: int = 100,
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

    min_date = parse_date(since) if since else None

    chat_name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or "Unknown"

    # Determine output
    if output_path:
        out_file = open(output_path, "w")
    else:
        import tempfile
        fd, output_path = tempfile.mkstemp(suffix=".jsonl", prefix=f"telegram-{chat_name.replace(' ', '_')[:30]}-")
        out_file = open(fd, "w")

    total = 0
    try:
        async for msg in client.iter_messages(entity, limit=None):
            if min_date and msg.date and msg.date < min_date:
                break

            formatted = format_message(msg)
            formatted["chatId"] = str(entity.id)
            formatted["chatName"] = chat_name
            out_file.write(json.dumps(formatted, default=str, ensure_ascii=False) + "\n")
            total += 1

            if total % batch_size == 0:
                print(json.dumps({"status": "progress", "exported": total}), file=sys.stderr)

    except FloodWaitError as e:
        out_file.close()
        await client.disconnect()
        # Partial export is still useful
        output({
            "exported": total,
            "outputPath": output_path,
            "chat": chat_name,
            "partial": True,
            "floodWait": e.seconds,
            "note": f"Rate limited after {total} messages. Retry in {e.seconds}s to continue.",
        })
        return

    out_file.close()
    await client.disconnect()

    output({
        "exported": total,
        "outputPath": output_path,
        "chat": chat_name,
        "partial": False,
    })


def main():
    parser = argparse.ArgumentParser(description="Export Telegram chat history")
    parser.add_argument("chat", help="Chat name, @username, or numeric ID")
    parser.add_argument("--output", type=str, help="Output file path (default: temp file)")
    parser.add_argument("--since", type=str, help="Export messages after this date")
    parser.add_argument("--batch-size", type=int, default=100, help="Progress report interval")
    args = parser.parse_args()

    asyncio.run(export_history(args.chat, args.output, args.since, args.batch_size))


if __name__ == "__main__":
    main()
