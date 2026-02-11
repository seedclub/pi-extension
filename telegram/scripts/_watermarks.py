"""
Watermark tracking for Telegram digest.

Stores { chatId: { lastMessageId, lastRunAt } } in a local JSON file.
This tracks what the *agent* has processed, independent of Telegram's
unread counts (which clear when you open the app).
"""

import json
from datetime import datetime, timezone
from pathlib import Path

WATERMARKS_PATH = Path.home() / ".config" / "seed-network" / "telegram" / "watermarks.json"


def load_watermarks() -> dict:
    """Load watermarks from disk. Returns empty dict if file doesn't exist."""
    if not WATERMARKS_PATH.exists():
        return {}
    try:
        return json.loads(WATERMARKS_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def save_watermarks(watermarks: dict):
    """Save watermarks to disk."""
    WATERMARKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    WATERMARKS_PATH.write_text(json.dumps(watermarks, indent=2))


def get_watermark(chat_id: str) -> int | None:
    """Get the last seen message ID for a chat. Returns None if never seen."""
    wm = load_watermarks()
    entry = wm.get(str(chat_id))
    if entry and isinstance(entry, dict):
        return entry.get("lastMessageId")
    return None


def set_watermark(chat_id: str, message_id: int, chat_name: str | None = None):
    """Update the watermark for a chat."""
    wm = load_watermarks()
    wm[str(chat_id)] = {
        "lastMessageId": message_id,
        "lastRunAt": datetime.now(timezone.utc).isoformat(),
        "chatName": chat_name,
    }
    save_watermarks(wm)


def set_watermarks_batch(updates: list[dict]):
    """Update multiple watermarks at once. Each dict: { chatId, messageId, chatName? }"""
    wm = load_watermarks()
    now = datetime.now(timezone.utc).isoformat()
    for u in updates:
        wm[str(u["chatId"])] = {
            "lastMessageId": u["messageId"],
            "lastRunAt": now,
            "chatName": u.get("chatName"),
        }
    save_watermarks(wm)


def clear_watermarks():
    """Delete all watermarks (next digest will process everything)."""
    if WATERMARKS_PATH.exists():
        WATERMARKS_PATH.unlink()
