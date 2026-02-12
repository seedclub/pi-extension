#!/usr/bin/env python3
"""
Logout from Telegram and remove the stored session.

Usage:
  uv run scripts/logout.py [--revoke]

With --revoke, also terminates the session on Telegram's side
(removes it from Settings > Devices > Active Sessions).
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _client import get_client, output, error, SESSION_PATH


async def do_logout(revoke: bool = False):
    if not SESSION_PATH.exists():
        output({"success": True, "note": "No session found, already logged out"})

    if revoke:
        try:
            client = get_client()
            await client.connect()
            await client.log_out()
            await client.disconnect()
        except Exception as e:
            # Still delete the local file even if remote revoke fails
            pass

    SESSION_PATH.unlink(missing_ok=True)
    output({"success": True, "revoked": revoke})


def main():
    parser = argparse.ArgumentParser(description="Logout from Telegram")
    parser.add_argument("--revoke", action="store_true",
                        help="Also revoke session on Telegram's servers")
    args = parser.parse_args()

    asyncio.run(do_logout(args.revoke))


if __name__ == "__main__":
    main()
