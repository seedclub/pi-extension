"""
Tests for _watermarks.py

Run: cd telegram && uv run --group dev pytest tests/test_watermarks.py -v
"""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import _watermarks as wm


@pytest.fixture(autouse=True)
def tmp_watermarks(tmp_path):
    """Redirect watermarks to a temp file for each test."""
    fake_path = tmp_path / "watermarks.json"
    with patch.object(wm, "WATERMARKS_PATH", fake_path):
        yield fake_path


class TestLoadSave:
    def test_load_empty(self, tmp_watermarks):
        assert wm.load_watermarks() == {}

    def test_save_and_load(self, tmp_watermarks):
        data = {"123": {"lastMessageId": 456, "lastRunAt": "2026-02-10T12:00:00"}}
        wm.save_watermarks(data)
        assert wm.load_watermarks() == data

    def test_load_corrupt_file(self, tmp_watermarks):
        tmp_watermarks.write_text("not json{{{")
        assert wm.load_watermarks() == {}

    def test_creates_parent_dirs(self, tmp_path):
        deep_path = tmp_path / "a" / "b" / "c" / "watermarks.json"
        with patch.object(wm, "WATERMARKS_PATH", deep_path):
            wm.save_watermarks({"x": 1})
            assert deep_path.exists()


class TestGetSet:
    def test_get_no_watermark(self):
        assert wm.get_watermark("999") is None

    def test_set_and_get(self):
        wm.set_watermark("123", 500, "Test Chat")
        result = wm.get_watermark("123")
        assert result == 500

    def test_set_updates_existing(self):
        wm.set_watermark("123", 100, "Chat")
        wm.set_watermark("123", 200, "Chat")
        assert wm.get_watermark("123") == 200

    def test_multiple_chats(self):
        wm.set_watermark("111", 10, "Chat A")
        wm.set_watermark("222", 20, "Chat B")
        assert wm.get_watermark("111") == 10
        assert wm.get_watermark("222") == 20

    def test_set_stores_metadata(self, tmp_watermarks):
        wm.set_watermark("123", 500, "My Chat")
        data = json.loads(tmp_watermarks.read_text())
        assert data["123"]["chatName"] == "My Chat"
        assert "lastRunAt" in data["123"]


class TestBatch:
    def test_batch_update(self):
        wm.set_watermarks_batch([
            {"chatId": "111", "messageId": 100, "chatName": "A"},
            {"chatId": "222", "messageId": 200, "chatName": "B"},
            {"chatId": "333", "messageId": 300},
        ])
        assert wm.get_watermark("111") == 100
        assert wm.get_watermark("222") == 200
        assert wm.get_watermark("333") == 300

    def test_batch_preserves_existing(self):
        wm.set_watermark("111", 50, "Old")
        wm.set_watermarks_batch([
            {"chatId": "222", "messageId": 200},
        ])
        # Old watermark still there
        assert wm.get_watermark("111") == 50
        assert wm.get_watermark("222") == 200

    def test_batch_overwrites_existing(self):
        wm.set_watermark("111", 50, "Old")
        wm.set_watermarks_batch([
            {"chatId": "111", "messageId": 999, "chatName": "New"},
        ])
        assert wm.get_watermark("111") == 999


class TestClear:
    def test_clear(self, tmp_watermarks):
        wm.set_watermark("123", 100)
        wm.clear_watermarks()
        assert wm.load_watermarks() == {}
        assert not tmp_watermarks.exists()

    def test_clear_nonexistent(self, tmp_watermarks):
        # Should not raise
        wm.clear_watermarks()
