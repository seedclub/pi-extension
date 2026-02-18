#!/usr/bin/env python3
"""
Authenticate with Telegram and save session.

Three-phase flow (driven by /telegram-login command in the pi extension):

  login.py request-code --phone +1234567890
      Connects to Telegram, sends an OTP to the user's phone/app.
      Saves pending state to ~/.config/seed-network/telegram/pending.json.
      Outputs: {"status": "code_sent", "phone": "+1234567890"}

  login.py sign-in --code 12345
      Loads pending state, signs in with the OTP.
      On success: saves session.json, outputs {"success": true, ...}
      If 2FA is required: saves 2FA-pending session to pending.json,
      outputs {"status": "2fa_required"}

  login.py sign-in-2fa --password <password>
      Loads the 2FA-pending session from pending.json, submits the password.
      On success: saves session.json, outputs {"success": true, ...}

App credentials (api_id + api_hash) are loaded from, in priority order:
  1. --api-id / --api-hash CLI args
  2. TELEGRAM_API_ID / TELEGRAM_API_HASH environment variables
  3. ~/.config/seed-network/telegram/app.json (written by /seed-connect)

Usage (manual / legacy):
  uv run scripts/login.py request-code --phone +1234567890
  uv run scripts/login.py sign-in --code 12345
  uv run scripts/login.py sign-in-2fa --password mypassword
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import save_session, output, error, SESSION_PATH

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    PasswordHashInvalidError,
    SessionPasswordNeededError,
    FloodWaitError,
    PhoneNumberInvalidError,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

CONFIG_DIR = Path.home() / ".config" / "seed-network" / "telegram"
PENDING_PATH = CONFIG_DIR / "pending.json"
APP_CONFIG_PATH = CONFIG_DIR / "app.json"


# ---------------------------------------------------------------------------
# App credential resolution
# ---------------------------------------------------------------------------

def load_app_credentials(cli_api_id: int | None, cli_api_hash: str | None) -> tuple[int, str]:
    """
    Resolve api_id and api_hash from (in priority order):
      1. CLI args
      2. Environment variables
      3. ~/.config/seed-network/telegram/app.json
    Exits with an error if no credentials are found.
    """
    api_id = cli_api_id or int(os.environ.get("TELEGRAM_API_ID", "0") or "0")
    api_hash = cli_api_hash or os.environ.get("TELEGRAM_API_HASH", "")

    if not api_id or not api_hash:
        if APP_CONFIG_PATH.exists():
            try:
                data = json.loads(APP_CONFIG_PATH.read_text())
                api_id = api_id or int(data.get("apiId", 0))
                api_hash = api_hash or data.get("apiHash", "")
            except Exception:
                pass

    if not api_id or not api_hash:
        error(
            "Telegram app credentials not found. Run /seed-connect first, "
            "or set TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables.",
            "NO_APP_CREDENTIALS",
        )

    return api_id, api_hash  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Pending state helpers
# ---------------------------------------------------------------------------

def load_pending() -> dict:
    """Load pending login state. Exits if not found."""
    if not PENDING_PATH.exists():
        error("No pending login session found. Run 'login.py request-code' first.", "NO_PENDING")
    try:
        return json.loads(PENDING_PATH.read_text())
    except Exception:
        error("Corrupt pending session. Run 'login.py request-code' again.", "NO_PENDING")


def save_pending(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_PATH.write_text(json.dumps(data, indent=2))
    PENDING_PATH.chmod(0o600)


def clear_pending() -> None:
    try:
        PENDING_PATH.unlink()
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# Phase 1: request-code
# ---------------------------------------------------------------------------

async def cmd_request_code(phone: str, api_id: int, api_hash: str) -> None:
    """
    Connect to Telegram and send an OTP to the user's phone/app.
    Saves pending state (phone, phone_code_hash, api_id, api_hash, partial session).
    """
    client = TelegramClient(StringSession(), api_id, api_hash)

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect to Telegram: {e}", "CONNECTION_ERROR")

    try:
        result = await client.send_code_request(phone)
    except PhoneNumberInvalidError:
        error(f"Invalid phone number: {phone}", "INVALID_PHONE")
    except FloodWaitError as e:
        error(f"Rate limited. Try again in {e.seconds} seconds.", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to send code: {e}", "CODE_SEND_ERROR")

    # Save the MTProto session (DC + auth key) so phase 2 can reuse it.
    # This avoids re-doing the DH handshake and is more reliable than a fresh connection.
    session_string = client.session.save()
    await client.disconnect()

    save_pending({
        "phone": phone,
        "phoneCodeHash": result.phone_code_hash,
        "sessionString": session_string,
        "apiId": api_id,
        "apiHash": api_hash,
    })

    output({"status": "code_sent", "phone": phone})


# ---------------------------------------------------------------------------
# Phase 2: sign-in
# ---------------------------------------------------------------------------

async def cmd_sign_in(code: str) -> None:
    """
    Load pending state and sign in with the OTP.
    On success: saves session.json and exits.
    If 2FA is required: saves the 2FA-pending session to pending.json and exits
    with {"status": "2fa_required"} so the caller can run sign-in-2fa.
    """
    pending = load_pending()
    phone = pending["phone"]
    phone_code_hash = pending["phoneCodeHash"]
    api_id = pending["apiId"]
    api_hash = pending["apiHash"]
    session_string = pending.get("sessionString", "")

    client = TelegramClient(StringSession(session_string), api_id, api_hash)

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect to Telegram: {e}", "CONNECTION_ERROR")

    try:
        await client.sign_in(phone, code, phone_code_hash=phone_code_hash)

    except SessionPasswordNeededError:
        # Save the 2FA-pending session so sign-in-2fa can resume from this exact state.
        # At this point Telethon has validated the OTP server-side; the session encodes
        # the "authenticated but 2FA pending" MTProto state.
        pending["sessionString"] = client.session.save()
        pending["phase"] = "2fa"
        await client.disconnect()
        save_pending(pending)
        output({"status": "2fa_required"})

    except PhoneCodeInvalidError:
        await client.disconnect()
        error("Invalid verification code.", "INVALID_CODE")

    except PhoneCodeExpiredError:
        await client.disconnect()
        clear_pending()
        error("Verification code expired. Run /telegram-login again.", "CODE_EXPIRED")

    except Exception as e:
        await client.disconnect()
        error(f"Sign-in failed: {e}", "SIGN_IN_ERROR")

    else:
        # Success — save final session
        final_session = client.session.save()
        me = await client.get_me()
        await client.disconnect()
        clear_pending()

        name_parts = [me.first_name or "", me.last_name or ""]
        name = " ".join(p for p in name_parts if p)
        save_session(api_id, api_hash, phone, final_session)

        output({
            "success": True,
            "phone": phone,
            "name": name,
            "username": me.username,
            "userId": str(me.id),
        })


# ---------------------------------------------------------------------------
# Phase 3: sign-in-2fa
# ---------------------------------------------------------------------------

async def cmd_sign_in_2fa(password: str) -> None:
    """
    Load the 2FA-pending session from pending.json and complete sign-in
    by submitting the account password.
    """
    pending = load_pending()

    if pending.get("phase") != "2fa":
        error("Not in 2FA state. Run 'login.py request-code' to start over.", "NOT_IN_2FA")

    phone = pending["phone"]
    api_id = pending["apiId"]
    api_hash = pending["apiHash"]
    session_string = pending["sessionString"]

    client = TelegramClient(StringSession(session_string), api_id, api_hash)

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect to Telegram: {e}", "CONNECTION_ERROR")

    try:
        await client.sign_in(password=password)
    except PasswordHashInvalidError:
        await client.disconnect()
        error("Invalid 2FA password.", "INVALID_2FA")
    except Exception as e:
        await client.disconnect()
        error(f"2FA sign-in failed: {e}", "SIGN_IN_ERROR")

    final_session = client.session.save()
    me = await client.get_me()
    await client.disconnect()
    clear_pending()

    name_parts = [me.first_name or "", me.last_name or ""]
    name = " ".join(p for p in name_parts if p)
    save_session(api_id, api_hash, phone, final_session)

    output({
        "success": True,
        "phone": phone,
        "name": name,
        "username": me.username,
        "userId": str(me.id),
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram authentication")
    parser.add_argument("--api-id", type=int, help="Override Telegram API ID")
    parser.add_argument("--api-hash", type=str, help="Override Telegram API Hash")

    sub = parser.add_subparsers(dest="command", required=True)

    p_req = sub.add_parser("request-code", help="Send OTP to phone")
    p_req.add_argument("--phone", required=True, help="Phone number (+1234567890)")

    p_sign = sub.add_parser("sign-in", help="Submit OTP code")
    p_sign.add_argument("--code", required=True, help="OTP code received on phone")

    p_2fa = sub.add_parser("sign-in-2fa", help="Submit 2FA password")
    p_2fa.add_argument("--password", required=True, help="Telegram account 2FA password")

    args = parser.parse_args()

    if args.command == "request-code":
        api_id, api_hash = load_app_credentials(args.api_id, args.api_hash)
        asyncio.run(cmd_request_code(args.phone, api_id, api_hash))

    elif args.command == "sign-in":
        asyncio.run(cmd_sign_in(args.code))

    elif args.command == "sign-in-2fa":
        asyncio.run(cmd_sign_in_2fa(args.password))


if __name__ == "__main__":
    main()
