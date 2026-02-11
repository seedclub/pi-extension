"""
Tests for _client.py pure functions.

Uses mock objects that mimic Telethon's types without needing a real connection.
Run: cd telegram && uv run --group dev pytest tests/ -v
"""

import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock
from types import SimpleNamespace

import pytest

# Add scripts dir to path so we can import _client
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from _client import (
    classify_entity,
    format_sender,
    format_message,
    parse_date,
    parse_date_end_of_day,
)


# =============================================================================
# Mock Telethon types — enough to pass isinstance checks
# =============================================================================

# We need the real types for isinstance checks in classify_entity/format_sender
from telethon.tl.types import User, Chat, Channel


def make_user(id=123, first_name="Alice", last_name="Smith", username="alice", bot=False):
    """Create a minimal User-like object."""
    u = MagicMock(spec=User)
    u.id = id
    u.first_name = first_name
    u.last_name = last_name
    u.username = username
    u.bot = bot
    # Make isinstance work
    u.__class__ = User
    return u


def make_channel(id=456, title="Test Channel", username="testchannel", broadcast=True):
    c = MagicMock(spec=Channel)
    c.id = id
    c.title = title
    c.username = username
    c.broadcast = broadcast
    c.__class__ = Channel
    return c


def make_chat(id=789, title="Test Group"):
    c = MagicMock(spec=Chat)
    c.id = id
    c.title = title
    c.__class__ = Chat
    return c


def make_message(
    id=100,
    date=None,
    sender=None,
    text="Hello world",
    reply_to=None,
    forward=None,
    media=None,
    views=None,
    reactions=None,
    pinned=False,
    edit_date=None,
    chat=None,
):
    msg = MagicMock()
    msg.id = id
    msg.date = date or datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
    msg.sender = sender
    msg.text = text
    msg.reply_to = reply_to
    msg.forward = forward
    msg.media = media
    msg.views = views
    msg.reactions = reactions
    msg.pinned = pinned
    msg.edit_date = edit_date
    msg.chat = chat
    return msg


# =============================================================================
# classify_entity
# =============================================================================


class TestClassifyEntity:
    def test_regular_user(self):
        assert classify_entity(make_user(bot=False)) == "user"

    def test_bot_user(self):
        assert classify_entity(make_user(bot=True)) == "bot"

    def test_group_chat(self):
        assert classify_entity(make_chat()) == "group"

    def test_broadcast_channel(self):
        assert classify_entity(make_channel(broadcast=True)) == "channel"

    def test_supergroup(self):
        assert classify_entity(make_channel(broadcast=False)) == "supergroup"

    def test_unknown_type(self):
        assert classify_entity("something weird") == "unknown"


# =============================================================================
# format_sender
# =============================================================================


class TestFormatSender:
    def test_none_sender(self):
        result = format_sender(None)
        assert result["id"] is None
        assert result["name"] == "Unknown"

    def test_user_with_full_name(self):
        result = format_sender(make_user(id=1, first_name="Alice", last_name="Smith", username="alice"))
        assert result["id"] == "1"
        assert result["name"] == "Alice Smith"
        assert result["username"] == "alice"
        assert result["isBot"] is False

    def test_user_first_name_only(self):
        result = format_sender(make_user(first_name="Bob", last_name=None))
        assert result["name"] == "Bob"

    def test_user_no_name(self):
        result = format_sender(make_user(first_name=None, last_name=None))
        assert result["name"] == "Unknown"

    def test_bot_user(self):
        result = format_sender(make_user(bot=True))
        assert result["isBot"] is True

    def test_channel(self):
        result = format_sender(make_channel(id=456, title="News Feed", username="news"))
        assert result["id"] == "456"
        assert result["name"] == "News Feed"
        assert result["username"] == "news"
        assert result["isBot"] is False

    def test_group_chat(self):
        result = format_sender(make_chat(id=789, title="My Group"))
        assert result["id"] == "789"
        assert result["name"] == "My Group"

    def test_unknown_entity(self):
        obj = SimpleNamespace(id=999)
        result = format_sender(obj)
        assert result["id"] == "999"


# =============================================================================
# format_message
# =============================================================================


class TestFormatMessage:
    def test_basic_text_message(self):
        sender = make_user(id=1, first_name="Alice", last_name=None, username="alice")
        msg = make_message(id=42, text="Hello!", sender=sender)
        result = format_message(msg)

        assert result["id"] == "42"
        assert result["text"] == "Hello!"
        assert result["sender"]["name"] == "Alice"
        assert result["mediaType"] is None
        assert result["replyTo"] is None
        assert result["isPinned"] is False

    def test_message_no_text(self):
        msg = make_message(text=None)
        result = format_message(msg)
        assert result["text"] is None

    def test_pinned_message(self):
        msg = make_message(pinned=True)
        result = format_message(msg)
        assert result["isPinned"] is True

    def test_reply_to(self):
        reply = MagicMock()
        reply.reply_to_msg_id = 99
        msg = make_message(reply_to=reply)
        result = format_message(msg)
        assert result["replyTo"] == "99"

    def test_views(self):
        msg = make_message(views=1500)
        result = format_message(msg)
        assert result["views"] == 1500

    def test_edit_date(self):
        edit_dt = datetime(2026, 2, 10, 15, 30, 0, tzinfo=timezone.utc)
        msg = make_message(edit_date=edit_dt)
        result = format_message(msg)
        assert result["editDate"] == edit_dt.isoformat()

    def test_date_formatting(self):
        dt = datetime(2026, 2, 10, 12, 0, 0, tzinfo=timezone.utc)
        msg = make_message(date=dt)
        result = format_message(msg)
        assert result["date"] == "2026-02-10T12:00:00+00:00"

    def test_photo_media(self):
        from telethon.tl.types import MessageMediaPhoto
        media = MagicMock(spec=MessageMediaPhoto)
        media.__class__ = MessageMediaPhoto
        msg = make_message(media=media)
        result = format_message(msg)
        assert result["mediaType"] == "photo"

    def test_webpage_media(self):
        from telethon.tl.types import MessageMediaWebPage
        media = MagicMock(spec=MessageMediaWebPage)
        media.__class__ = MessageMediaWebPage
        msg = make_message(media=media)
        result = format_message(msg)
        assert result["mediaType"] == "webpage"

    def test_no_media(self):
        msg = make_message(media=None)
        result = format_message(msg)
        assert result["mediaType"] is None

    def test_reactions(self):
        reaction1 = MagicMock()
        reaction1.reaction = MagicMock()
        reaction1.reaction.emoticon = "👍"
        reaction1.count = 5

        reaction2 = MagicMock()
        reaction2.reaction = MagicMock()
        reaction2.reaction.emoticon = "❤️"
        reaction2.count = 3

        reactions = MagicMock()
        reactions.results = [reaction1, reaction2]

        msg = make_message(reactions=reactions)
        result = format_message(msg)
        assert result["reactions"] == [
            {"emoji": "👍", "count": 5},
            {"emoji": "❤️", "count": 3},
        ]

    def test_no_reactions(self):
        msg = make_message(reactions=None)
        result = format_message(msg)
        assert result["reactions"] is None

    def test_forward_from_chat(self):
        fwd = MagicMock()
        fwd.chat = MagicMock()
        fwd.chat.title = "News Channel"
        msg = make_message(forward=fwd)
        result = format_message(msg)
        assert result["forwardFrom"] == "News Channel"

    def test_forward_from_sender(self):
        fwd = MagicMock()
        fwd.chat = None  # no chat attribute
        fwd.sender = make_user(id=5, first_name="Bob", last_name=None)
        # hasattr(fwd, 'chat') is True but fwd.chat is falsy
        msg = make_message(forward=fwd)
        result = format_message(msg)
        # Should fall through to format_sender path
        assert result["forwardFrom"]["name"] == "Bob"


# =============================================================================
# parse_date / parse_date_end_of_day
# =============================================================================


class TestParseDates:
    def test_iso_format(self):
        result = parse_date("2026-02-10T15:30:00")
        assert result.year == 2026
        assert result.month == 2
        assert result.day == 10
        assert result.hour == 15
        assert result.tzinfo == timezone.utc

    def test_date_only(self):
        result = parse_date("2026-02-10")
        assert result.year == 2026
        assert result.hour == 0
        assert result.tzinfo == timezone.utc

    def test_end_of_day_date_only(self):
        result = parse_date_end_of_day("2026-02-10")
        assert result.year == 2026
        assert result.hour == 23
        assert result.minute == 59
        assert result.second == 59

    def test_end_of_day_iso(self):
        # When given a full ISO timestamp, should preserve the time
        result = parse_date_end_of_day("2026-02-10T08:00:00")
        assert result.hour == 8
        assert result.tzinfo == timezone.utc
