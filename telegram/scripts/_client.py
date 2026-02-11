"""
Shared Telethon client initialization and utilities.
All scripts import from here.

Session is stored at ~/.config/seed-network/telegram/session.json
containing: { apiId, apiHash, phone, sessionString, authenticatedAt }
"""

import json
import sys
import os
from pathlib import Path
from typing import NoReturn
from telethon import TelegramClient
from telethon.sessions import StringSession

SESSION_DIR = Path.home() / ".config" / "seed-network" / "telegram"
SESSION_PATH = SESSION_DIR / "session.json"


# =============================================================================
# Session Management
# =============================================================================

def load_session() -> dict:
    """Load session from disk. Exits with error JSON if not found."""
    if not SESSION_PATH.exists():
        error("Not connected to Telegram. Run /telegram-login or: uv run scripts/login.py", "NOT_CONNECTED")
    try:
        data = json.loads(SESSION_PATH.read_text())
        if not data.get("sessionString") or not data.get("apiId") or not data.get("apiHash"):
            error("Invalid session file. Re-run /telegram-login", "INVALID_SESSION")
        return data
    except json.JSONDecodeError:
        error("Corrupt session file. Re-run /telegram-login", "INVALID_SESSION")


def save_session(api_id: int, api_hash: str, phone: str, session_string: str):
    """Save session to disk."""
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "apiId": api_id,
        "apiHash": api_hash,
        "phone": phone,
        "sessionString": session_string,
        "authenticatedAt": __import__("datetime").datetime.now().isoformat(),
    }
    SESSION_PATH.write_text(json.dumps(data, indent=2))
    SESSION_PATH.chmod(0o600)


def get_client() -> TelegramClient:
    """Create a TelegramClient from stored session. Not yet connected."""
    data = load_session()
    client = TelegramClient(
        StringSession(data["sessionString"]),
        int(data["apiId"]),
        data["apiHash"],
    )
    return client


# =============================================================================
# Output Helpers
# =============================================================================

def output(data):
    """Print JSON to stdout and exit cleanly."""
    print(json.dumps(data, default=str, ensure_ascii=False))
    sys.exit(0)


def error(msg: str, code: str = "ERROR") -> NoReturn:
    """Print error JSON to stdout and exit with code 1."""
    print(json.dumps({"error": msg, "code": code}))
    sys.exit(1)


# =============================================================================
# Chat Resolution
# =============================================================================

async def resolve_chat(client, chat_arg: str):
    """
    Resolve a chat argument to a Telethon entity.
    Accepts: numeric ID, @username, or chat name (fuzzy matched).
    Returns the entity or None.
    """
    # Try as numeric ID
    try:
        chat_id = int(chat_arg)
        return await client.get_entity(chat_id)
    except (ValueError, Exception):
        pass

    # Try as @username
    if chat_arg.startswith("@"):
        try:
            return await client.get_entity(chat_arg)
        except Exception:
            pass

    # Fuzzy match against dialogs
    try:
        dialogs = await client.get_dialogs(limit=200)
        # Exact match first
        for d in dialogs:
            if d.name and d.name.lower() == chat_arg.lower():
                return d.entity
        # Starts with
        for d in dialogs:
            if d.name and d.name.lower().startswith(chat_arg.lower()):
                return d.entity
        # Contains
        for d in dialogs:
            if d.name and chat_arg.lower() in d.name.lower():
                return d.entity
    except Exception:
        pass

    return None


def classify_entity(entity) -> str:
    """Classify a Telethon entity into a chat type string."""
    from telethon.tl.types import User, Chat, Channel

    if isinstance(entity, User):
        return "bot" if entity.bot else "user"
    elif isinstance(entity, Chat):
        return "group"
    elif isinstance(entity, Channel):
        return "channel" if entity.broadcast else "supergroup"
    return "unknown"


# =============================================================================
# Date Parsing
# =============================================================================

def parse_date(date_str: str):
    """Parse an ISO 8601 or YYYY-MM-DD date string to a timezone-aware datetime."""
    from datetime import datetime, timezone
    try:
        return datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def parse_date_end_of_day(date_str: str):
    """Parse a date string, setting time to end of day for date-only inputs."""
    from datetime import datetime, timezone
    dt = parse_date(date_str)
    # If only a date was given (no time component), set to end of day
    if "T" not in date_str and " " not in date_str:
        return dt.replace(hour=23, minute=59, second=59)
    return dt


# =============================================================================
# Formatters
# =============================================================================

def format_sender(sender) -> dict:
    """Format a Telethon User/Channel entity into a clean dict."""
    if sender is None:
        return {"id": None, "name": "Unknown", "username": None}

    from telethon.tl.types import User, Channel, Chat

    if isinstance(sender, User):
        name_parts = [sender.first_name or "", sender.last_name or ""]
        name = " ".join(p for p in name_parts if p) or "Unknown"
        return {
            "id": str(sender.id),
            "name": name,
            "username": sender.username,
            "isBot": sender.bot or False,
        }
    elif isinstance(sender, (Channel, Chat)):
        return {
            "id": str(sender.id),
            "name": sender.title or "Unknown",
            "username": getattr(sender, "username", None),
            "isBot": False,
        }
    else:
        return {"id": str(getattr(sender, "id", None)), "name": str(sender), "username": None}


def format_message(msg) -> dict:
    """Format a Telethon Message into a clean dict."""
    media_type = None
    if msg.media:
        from telethon.tl.types import (
            MessageMediaPhoto,
            MessageMediaDocument,
            MessageMediaWebPage,
        )
        if isinstance(msg.media, MessageMediaPhoto):
            media_type = "photo"
        elif isinstance(msg.media, MessageMediaDocument):
            doc = msg.media.document
            if doc:
                for attr in doc.attributes:
                    attr_name = type(attr).__name__
                    if attr_name == "DocumentAttributeVideo":
                        media_type = "video"
                        break
                    elif attr_name == "DocumentAttributeAudio":
                        media_type = "voice" if getattr(attr, "voice", False) else "audio"
                        break
                    elif attr_name == "DocumentAttributeSticker":
                        media_type = "sticker"
                        break
                if not media_type:
                    media_type = "document"
        elif isinstance(msg.media, MessageMediaWebPage):
            media_type = "webpage"

    reactions = []
    if msg.reactions and msg.reactions.results:
        for r in msg.reactions.results:
            emoji = getattr(r.reaction, "emoticon", None) or str(r.reaction)
            reactions.append({"emoji": emoji, "count": r.count})

    return {
        "id": str(msg.id),
        "date": msg.date.isoformat() if msg.date else None,
        "sender": format_sender(msg.sender),
        "text": msg.text or None,
        "replyTo": str(msg.reply_to.reply_to_msg_id) if msg.reply_to else None,
        "forwardFrom": msg.forward.chat.title if msg.forward and hasattr(msg.forward, "chat") and msg.forward.chat else (
            format_sender(msg.forward.sender) if msg.forward and hasattr(msg.forward, "sender") else None
        ),
        "mediaType": media_type,
        "views": msg.views,
        "reactions": reactions if reactions else None,
        "isPinned": msg.pinned or False,
        "editDate": msg.edit_date.isoformat() if msg.edit_date else None,
    }
