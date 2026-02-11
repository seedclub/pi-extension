"""
Shared sync helpers for pushing Telegram data to the Seed Network API.
Used by scripts with --sync flag.
"""

import json
import os
import sys
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

# Load Seed Network API credentials
SEED_CONFIG_PATH = Path.home() / ".config" / "seed-network" / "token"


def get_api_config() -> tuple[str, str]:
    """Get (api_base, token) from stored config or env vars."""
    token = os.environ.get("SEED_NETWORK_TOKEN")
    api_base = os.environ.get("SEED_NETWORK_API", "https://beta.seedclub.com")

    if not token and SEED_CONFIG_PATH.exists():
        try:
            data = json.loads(SEED_CONFIG_PATH.read_text())
            token = data.get("token")
            api_base = data.get("apiBase", api_base)
        except (json.JSONDecodeError, KeyError):
            pass

    if not token:
        print(json.dumps({"error": "Not connected to Seed Network. Run /seed-connect first.", "code": "NOT_CONNECTED"}))
        sys.exit(1)

    return api_base, token


def api_request(method: str, endpoint: str, body: dict | None = None) -> dict:
    """Make an authenticated request to the Seed Network API."""
    api_base, token = get_api_config()
    url = f"{api_base}/api/mcp{endpoint}"

    data = json.dumps(body).encode() if body else None
    req = Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        try:
            error_data = json.loads(body_text)
            return {"error": error_data.get("error", f"HTTP {e.code}"), "code": f"HTTP_{e.code}"}
        except json.JSONDecodeError:
            return {"error": f"HTTP {e.code}: {body_text[:200]}", "code": f"HTTP_{e.code}"}
    except URLError as e:
        return {"error": f"Connection failed: {e.reason}", "code": "CONNECTION_ERROR"}


def sync_chats(chats: list[dict]) -> dict:
    """Push chat metadata to the Seed Network API."""
    return api_request("POST", "/telegram/chats", {"chats": chats})


def sync_messages(chat_telegram_id: str, messages: list[dict]) -> dict:
    """Push messages to the Seed Network API in batches of 500."""
    total_created = 0
    total_updated = 0
    total_skipped = 0
    chat_info = None

    # Batch into chunks of 500
    for i in range(0, len(messages), 500):
        batch = messages[i : i + 500]
        result = api_request("POST", "/telegram/messages", {
            "chatTelegramId": chat_telegram_id,
            "messages": batch,
        })

        if "error" in result:
            return result

        total_created += result.get("created", 0)
        total_updated += result.get("updated", 0)
        total_skipped += result.get("skipped", 0)
        if result.get("chat"):
            chat_info = result["chat"]

    return {
        "created": total_created,
        "updated": total_updated,
        "skipped": total_skipped,
        "chat": chat_info,
    }
