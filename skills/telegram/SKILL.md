---
name: telegram
description: |
  Read and interact with Telegram via your authenticated account.
  Prefer the registered telegram_* tools over direct CLI usage.
  Use CLI for advanced operations like full history export.
---

# Telegram CLI

Python scripts for Telegram access via Telethon. The registered `telegram_*` tools
wrap these scripts — prefer the tools for normal usage. Use these scripts directly
via bash only for advanced operations the tools don't cover.

## Setup (one-time)

```bash
/telegram-login
```

Or directly via CLI:

```bash
cd {baseDir}/..
uv run scripts/login.py
```

## Scripts

### List chats

```bash
cd {baseDir}/.. && uv run scripts/chats.py --limit 20
cd {baseDir}/.. && uv run scripts/chats.py --type supergroup
```

### Read messages

```bash
cd {baseDir}/.. && uv run scripts/read.py "<chat name or @username>" --limit 50
cd {baseDir}/.. && uv run scripts/read.py "<chat>" --since 2026-02-09
cd {baseDir}/.. && uv run scripts/read.py "<chat>" --from-user alice --limit 20
```

### Search messages

```bash
cd {baseDir}/.. && uv run scripts/search.py "<query>" --limit 20
cd {baseDir}/.. && uv run scripts/search.py "<query>" --chat "<chat name>"
```

### Send a message

```bash
cd {baseDir}/.. && uv run scripts/send.py "<chat>" "<message>"
cd {baseDir}/.. && uv run scripts/send.py "<chat>" "<message>" --reply-to 4521
```

### Chat info

```bash
cd {baseDir}/.. && uv run scripts/info.py "<chat>"
cd {baseDir}/.. && uv run scripts/info.py "<chat>" --all-members
```

### Unread messages

```bash
cd {baseDir}/.. && uv run scripts/unread.py
cd {baseDir}/.. && uv run scripts/unread.py --min-unread 5
```

### Full history export (bulk)

```bash
cd {baseDir}/.. && uv run scripts/history.py "<chat>" --output /tmp/export.jsonl
cd {baseDir}/.. && uv run scripts/history.py "<chat>" --since 2025-01-01
```

### Contacts

```bash
cd {baseDir}/.. && uv run scripts/contacts.py
cd {baseDir}/.. && uv run scripts/contacts.py --search alice
```

## Output Format

All scripts output JSON to stdout. Errors are also JSON:

```json
{"error": "message", "code": "ERROR_CODE"}
```

Common error codes:
- `NOT_CONNECTED` — run `/telegram-login`
- `CHAT_NOT_FOUND` — use `telegram_chats` to find the right name
- `FLOOD_WAIT` — rate limited, wait and retry
- `AUTH_EXPIRED` — session revoked, re-login
