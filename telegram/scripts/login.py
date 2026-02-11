#!/usr/bin/env python3
"""
Authenticate with Telegram and save session.

Usage:
  uv run scripts/login.py
  uv run scripts/login.py --api-id 12345 --api-hash abc123 --phone +1234567890

When called without args, prompts interactively.
When called with --code-stdin, reads verification code from stdin (for pi extension).
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Add parent dir so we can import _client
sys.path.insert(0, str(Path(__file__).parent))
from _client import save_session, output, error, SESSION_PATH

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    PhoneCodeInvalidError,
    PasswordHashInvalidError,
    SessionPasswordNeededError,
    FloodWaitError,
    PhoneNumberInvalidError,
)


async def do_login(api_id: int, api_hash: str, phone: str, code_stdin: bool = False):
    """Run the Telegram login flow."""
    client = TelegramClient(StringSession(), api_id, api_hash)

    try:
        await client.connect()
    except Exception as e:
        error(f"Failed to connect to Telegram: {e}", "CONNECTION_ERROR")

    phone_code_hash = None

    try:
        result = await client.send_code_request(phone)
        phone_code_hash = result.phone_code_hash
    except PhoneNumberInvalidError:
        error(f"Invalid phone number: {phone}", "INVALID_PHONE")
    except FloodWaitError as e:
        error(f"Rate limited. Try again in {e.seconds} seconds.", "FLOOD_WAIT")
    except Exception as e:
        error(f"Failed to send code: {e}", "CODE_SEND_ERROR")

    # Get verification code
    if code_stdin:
        # Read from stdin (pi extension pipes it in)
        print(json.dumps({"status": "code_sent", "phone": phone}), flush=True)
        code = sys.stdin.readline().strip()
    else:
        code = input("Enter the verification code: ").strip()

    if not code:
        error("No verification code provided", "NO_CODE")

    try:
        await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
    except SessionPasswordNeededError:
        # 2FA is enabled
        if code_stdin:
            print(json.dumps({"status": "2fa_required"}), flush=True)
            password = sys.stdin.readline().strip()
        else:
            import getpass
            password = getpass.getpass("Enter your 2FA password: ")

        if not password:
            error("No 2FA password provided", "NO_2FA")

        try:
            await client.sign_in(password=password)
        except PasswordHashInvalidError:
            error("Invalid 2FA password", "INVALID_2FA")
    except PhoneCodeInvalidError:
        error("Invalid verification code", "INVALID_CODE")
    except Exception as e:
        error(f"Sign-in failed: {e}", "SIGN_IN_ERROR")

    # Save the session
    session_string = client.session.save()
    save_session(api_id, api_hash, phone, session_string)

    # Get user info
    me = await client.get_me()
    name_parts = [me.first_name or "", me.last_name or ""]
    name = " ".join(p for p in name_parts if p)

    await client.disconnect()

    output({
        "success": True,
        "phone": phone,
        "name": name,
        "username": me.username,
        "userId": str(me.id),
    })


def main():
    parser = argparse.ArgumentParser(description="Authenticate with Telegram")
    parser.add_argument("--api-id", type=int, help="Telegram API ID from my.telegram.org")
    parser.add_argument("--api-hash", type=str, help="Telegram API Hash from my.telegram.org")
    parser.add_argument("--phone", type=str, help="Phone number in international format (+1234567890)")
    parser.add_argument("--code-stdin", action="store_true", help="Read verification code from stdin (for automation)")
    args = parser.parse_args()

    api_id = args.api_id
    api_hash = args.api_hash
    phone = args.phone

    if not api_id:
        try:
            api_id = int(input("Enter your API ID (from my.telegram.org/apps): ").strip())
        except (ValueError, EOFError):
            error("Invalid API ID", "INVALID_INPUT")

    if not api_hash:
        api_hash = input("Enter your API Hash: ").strip()
        if not api_hash:
            error("API Hash is required", "INVALID_INPUT")

    if not phone:
        phone = input("Enter your phone number (e.g. +1234567890): ").strip()
        if not phone:
            error("Phone number is required", "INVALID_INPUT")

    asyncio.run(do_login(api_id, api_hash, phone, args.code_stdin))


if __name__ == "__main__":
    main()
