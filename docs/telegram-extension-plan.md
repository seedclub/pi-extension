# Telegram Pi Extension — Implementation Plan

## Overview

A feature-complete pi extension that gives the agent full read/write access to Telegram via the user's authenticated account. Built as Python CLI scripts using Telethon, wrapped by TypeScript pi extension tools for structured agent interaction.

The architecture follows the same pattern as the web-browser skill (Python/JS CLI scripts callable via bash) but elevated to a first-class extension (registered tools with descriptions, `ctx.ui` for auth and confirmations, status bar integration).

## Architecture

```
seed-network-pi/
  src/
    index.ts                    ← registers /telegram-login, /telegram-logout, /telegram-status
    tools/telegram.ts           ← registers telegram_* tools (shells out to Python scripts)
    telegram-client.ts          ← helpers: run script, check auth, parse output
  telegram/
    scripts/
      _client.py                ← shared Telethon client init (session loading, connect/disconnect)
      login.py                  ← interactive auth flow (phone → code → 2FA → save session)
      logout.py                 ← revoke session
      chats.py                  ← list dialogs
      read.py                   ← read messages from a chat
      search.py                 ← search messages across chats or within a chat
      send.py                   ← send a message
      info.py                   ← chat metadata (members, description, pinned messages)
      unread.py                 ← list chats with unread messages, sorted by count
      contacts.py               ← list/search contacts
      history.py                ← export full chat history (for backfill/indexing)
    pyproject.toml              ← declares telethon dependency, inline script metadata
  skills/
    telegram/SKILL.md           ← teaches the agent the CLI interface for direct bash usage
  prompts/
    telegram-digest.md          ← "summarize my unread telegram messages"
    telegram-search.md          ← "search telegram for X"
```

### Why This Architecture

**Python scripts (not a TypeScript GramJS wrapper):**
- Telethon is the gold standard — 10k+ stars, every MTProto edge case handled, massive community
- GramJS exists but is poorly documented and less battle-tested
- Each script is independently testable: `uv run telegram/scripts/read.py "Seed Club" --limit 5`
- No long-running process to manage — connect, do work, disconnect (~200ms overhead)

**Pi extension tools (not just a skill):**
- Tools get proper descriptions in the system prompt — the agent knows what's available without reading SKILL.md
- `ctx.ui.input()` for the auth flow (phone number, verification code, 2FA)
- `ctx.ui.confirm()` before sending messages
- Status bar shows Telegram connection state
- Structured JSON output in tool results, not raw bash stdout

**Skill as a fallback:**
- SKILL.md documents the raw CLI interface for when the agent needs to do something the tools don't cover
- Power users can also use the scripts directly from terminal

## Session & Auth

### Credentials Storage

```
~/.config/seed-network/telegram/
  session.json        ← { apiId, apiHash, phone, sessionString, authenticatedAt }
```

- `sessionString` is Telethon's `StringSession` — a single base64 string containing the auth key
- Sessions don't expire unless explicitly revoked from Telegram's active sessions
- API ID and API Hash are obtained once from https://my.telegram.org/apps

### Auth Flow

**`/telegram-login` command (in pi):**

```
1. ctx.ui.input("Telegram API ID:", "Get from my.telegram.org/apps")
2. ctx.ui.input("Telegram API Hash:")
3. ctx.ui.input("Phone number:", "+1234567890")
   → Runs login.py with these params
   → Telethon sends verification code to Telegram app
4. ctx.ui.input("Verification code sent to Telegram:")
   → If 2FA enabled:
5. ctx.ui.input("Two-factor authentication password:")
   → Session string returned, saved to session.json
6. ctx.ui.setStatus("telegram", "📱 +1***890")
   → ctx.ui.notify("✓ Connected to Telegram", "success")
```

**Alternative: CLI-only auth (no pi needed):**

```bash
cd ~/seed-network-pi/telegram
uv run scripts/login.py
# Interactive prompts in terminal
# Saves to ~/.config/seed-network/telegram/session.json
```

### Session Check

Every tool call runs a fast pre-check:
1. Does `session.json` exist?
2. Can we parse the session string?
3. If not → return `{ error: "Not connected to Telegram. Run /telegram-login" }`

We don't pre-validate the session on every call (too slow). If the session is expired/revoked, Telethon throws an `AuthKeyError` which the script catches and returns as a structured error.

## Python Scripts

### Shared Client (`_client.py`)

```python
"""
Shared Telethon client initialization.
All scripts import get_client() from here.
"""

import json, sys, os
from pathlib import Path
from telethon import TelegramClient
from telethon.sessions import StringSession

SESSION_PATH = Path.home() / ".config" / "seed-network" / "telegram" / "session.json"

def load_session():
    """Load session from disk. Raises SystemExit if not found."""
    if not SESSION_PATH.exists():
        print(json.dumps({"error": "Not connected. Run /telegram-login or: uv run scripts/login.py"}))
        sys.exit(1)
    data = json.loads(SESSION_PATH.read_text())
    return data

def get_client():
    """Create and return a connected TelegramClient."""
    data = load_session()
    client = TelegramClient(
        StringSession(data["sessionString"]),
        int(data["apiId"]),
        data["apiHash"]
    )
    return client

def output(data):
    """Print JSON to stdout and exit cleanly."""
    print(json.dumps(data, default=str, ensure_ascii=False))
    sys.exit(0)

def error(msg, code="ERROR"):
    """Print error JSON and exit."""
    print(json.dumps({"error": msg, "code": code}))
    sys.exit(1)
```

### Script Contracts

Every script:
- Outputs a single JSON object to stdout
- Outputs nothing else to stdout (logs go to stderr)
- Returns exit code 0 on success, 1 on error
- Errors are JSON: `{"error": "message", "code": "ERROR_CODE"}`
- Has `--help` for standalone usage
- Uses `argparse` for argument parsing

### `login.py`

```
uv run scripts/login.py --api-id 12345 --api-hash abc123 --phone +1234567890
# Or interactive (no args):
uv run scripts/login.py
```

**Input:** API ID, API Hash, phone number (args or stdin prompts)
**Flow:** Connect → send code → receive code (stdin) → optional 2FA (stdin) → save session
**Output:** `{"success": true, "phone": "+1***890"}`

When called from the pi extension, the extension passes args from `ctx.ui.input()` values and feeds the verification code via stdin pipe.

### `chats.py`

```
uv run scripts/chats.py [--limit 50] [--type group|channel|user|all] [--archived]
```

**Output:**
```json
{
  "chats": [
    {
      "id": -1001234567890,
      "name": "Seed Club Deals",
      "type": "group",           // "group" | "supergroup" | "channel" | "user" | "bot"
      "unreadCount": 12,
      "lastMessage": {
        "date": "2026-02-10T14:30:00Z",
        "sender": "alice",
        "text": "Just heard back from the founder..."
      },
      "memberCount": 47,
      "username": null            // @username if public
    }
  ],
  "count": 50
}
```

### `read.py`

```
uv run scripts/read.py <chat> [--limit 50] [--offset-id 0] [--since 2026-02-09] [--until 2026-02-10] [--from-user alice]
```

`<chat>` can be: chat name (fuzzy matched), @username, chat ID, or invite link.

**Output:**
```json
{
  "chat": { "id": -1001234567890, "name": "Seed Club Deals", "type": "supergroup" },
  "messages": [
    {
      "id": 4523,
      "date": "2026-02-10T14:30:00Z",
      "sender": { "id": 12345, "name": "Alice", "username": "alice" },
      "text": "Just heard back from the founder, they're raising at $8M pre",
      "replyTo": 4521,
      "forwards": null,
      "media": null,              // "photo" | "document" | "video" | "voice" | null
      "views": null,
      "reactions": []
    }
  ],
  "count": 50,
  "hasMore": true
}
```

### `search.py`

```
uv run scripts/search.py <query> [--chat <chat>] [--limit 20] [--from-user alice] [--since 2026-01-01]
```

Searches globally across all chats, or within a specific chat if `--chat` is provided.

**Output:** Same structure as `read.py` but with a `query` field and messages from mixed chats (each message includes its chat context).

### `send.py`

```
uv run scripts/send.py <chat> <message> [--reply-to <msg_id>]
```

**Output:** `{"success": true, "messageId": 4524, "chat": "Seed Club Deals"}`

### `info.py`

```
uv run scripts/info.py <chat>
```

**Output:**
```json
{
  "id": -1001234567890,
  "name": "Seed Club Deals",
  "type": "supergroup",
  "description": "Deal discussion for Seed Club members",
  "memberCount": 47,
  "username": "seedclubdeals",
  "created": "2025-06-15T00:00:00Z",
  "pinnedMessages": [
    { "id": 100, "text": "Rules: ...", "date": "2025-06-15T12:00:00Z" }
  ],
  "admins": [
    { "id": 12345, "name": "Connor", "username": "connor" }
  ],
  "members": [
    { "id": 12345, "name": "Connor", "username": "connor" },
    { "id": 67890, "name": "Alice", "username": "alice" }
  ]
}
```

Members list may be large — capped at 200 by default with `--all-members` flag to paginate.

### `unread.py`

```
uv run scripts/unread.py [--limit 20] [--min-unread 1]
```

Lists chats with unread messages, sorted by unread count descending. This is the "triage" entry point — what needs attention right now.

**Output:**
```json
{
  "chats": [
    {
      "id": -1001234567890,
      "name": "Seed Club Deals",
      "type": "supergroup",
      "unreadCount": 23,
      "mentionCount": 2,
      "lastMessage": { "date": "...", "sender": "alice", "text": "..." }
    }
  ],
  "totalUnread": 156
}
```

### `contacts.py`

```
uv run scripts/contacts.py [--search <query>]
```

List or search the user's Telegram contacts.

### `history.py`

```
uv run scripts/history.py <chat> [--output /tmp/chat-export.jsonl] [--since 2025-01-01] [--batch-size 100]
```

Full history export as JSONL (one message per line). For backfill and indexing workflows.
Not wrapped as a pi tool — this is a utility script for bulk operations.

## Pi Extension Tools

### Tool Registration (`src/tools/telegram.ts`)

Each tool shells out to the corresponding Python script via `pi.exec()` and parses the JSON output.

```typescript
// Pattern for each tool:
async function telegramRead(args) {
  const cmdArgs = [SCRIPTS_DIR + "/read.py", args.chat];
  if (args.limit) cmdArgs.push("--limit", String(args.limit));
  if (args.since) cmdArgs.push("--since", args.since);

  const result = await exec("uv", ["run", ...cmdArgs], { timeout: 30000 });

  if (result.code !== 0) {
    return { error: result.stderr || "Script failed" };
  }
  return JSON.parse(result.stdout);
}
```

### Tools Registered

| Tool | Description | Wraps |
|------|-------------|-------|
| `telegram_chats` | List Telegram dialogs (groups, channels, DMs). Filter by type. | `chats.py` |
| `telegram_read` | Read recent messages from a specific chat. Supports date range, sender filter, and pagination. | `read.py` |
| `telegram_search` | Search messages across all chats or within a specific chat. | `search.py` |
| `telegram_send` | Send a message to a chat. **Requires `ctx.ui.confirm()` approval before executing.** | `send.py` |
| `telegram_unread` | List chats with unread messages, sorted by urgency. Start here for triage. | `unread.py` |
| `telegram_info` | Get metadata about a chat: description, members, pinned messages, admins. | `info.py` |
| `telegram_contacts` | List or search Telegram contacts. | `contacts.py` |

### Send Confirmation

The `telegram_send` tool uses `ctx.ui.confirm()` before executing:

```typescript
pi.registerTool({
  name: "telegram_send",
  // ...
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const ok = await ctx.ui.confirm(
      "Send Telegram Message",
      `To: ${params.chat}\n\n${params.message}`
    );
    if (!ok) return { content: [{ type: "text", text: "Message send cancelled by user." }] };

    // Actually send...
  }
});
```

## Commands

### `/telegram-login`

Full interactive auth flow using `ctx.ui.input()`. Stores session to `~/.config/seed-network/telegram/session.json`.

See [Auth Flow](#auth-flow) above for the step-by-step.

### `/telegram-logout`

Deletes the stored session file. Optionally revokes the session on Telegram's side (so it disappears from "Active Sessions" in the app).

### `/telegram-status`

Shows current connection status:
- `📱 Connected as +1***890 (since Feb 8, 2026)`
- `Not connected. Run /telegram-login`

## Session Start Hook

```typescript
pi.on("session_start", async (_event, ctx) => {
  // Check if telegram session exists
  const hasSession = await telegramSessionExists();
  if (hasSession) {
    ctx.ui.setStatus("telegram", "📱 Connected");
  }
});
```

No Telegram API call on startup — just check if the session file exists. The status is a hint, not a guarantee the session is still valid.

## Prompt Templates

### `telegram-digest.md`

```markdown
# Telegram Digest

Summarize my unread Telegram messages.

1. Use `telegram_unread` to see which chats have unread messages
2. For each chat with significant unread count (>5), use `telegram_read`
   with `--since` set to roughly when messages started accumulating
3. Produce a digest grouped by chat:
   - Chat name and unread count
   - Key topics discussed
   - Action items or asks directed at me
   - Deals, companies, or founders mentioned
4. Flag anything urgent or time-sensitive
```

### `telegram-search.md`

```markdown
# Telegram Search

The user wants to find something in their Telegram messages.

Use `telegram_search` with their query. If results are sparse, try
alternative phrasings or search specific chats with `--chat`.

Present results grouped by chat, with context (surrounding messages
if needed via `telegram_read` with `--offset-id`).
```

### `telegram-monitor.md`

```markdown
# Telegram Monitor

Scan recent Telegram activity for deal-relevant signals.

1. Use `telegram_unread` to find active chats
2. Read recent messages from deal-related groups
3. Look for:
   - Companies or founders being discussed
   - Fundraising mentions
   - Intro requests
   - Market/category signals
4. For anything interesting, check if a signal already exists
   in Seed Network using `search_signals`
5. Create signal events for noteworthy activity using `create_event`
6. Summarize findings
```

## Skill (SKILL.md)

The skill documents the raw CLI interface as a fallback. The agent should prefer the registered tools, but can drop to bash for advanced usage (history export, custom flag combinations).

```markdown
---
name: telegram
description: |
  Read and interact with Telegram via your authenticated account.
  Prefer the telegram_* tools over direct CLI usage.
  Use CLI for advanced operations like full history export.
---

# Telegram CLI

Python scripts for Telegram access via Telethon.
Prefer the registered telegram_* tools. Use these scripts directly
only for operations the tools don't cover.

## Setup (one-time)
/telegram-login

## Scripts (via bash)
uv run {baseDir}/scripts/chats.py --limit 20
uv run {baseDir}/scripts/read.py "<chat>" --limit 50 --since 2026-02-09
uv run {baseDir}/scripts/search.py "<query>" --limit 20 --chat "<chat>"
uv run {baseDir}/scripts/send.py "<chat>" "<message>"
uv run {baseDir}/scripts/unread.py
uv run {baseDir}/scripts/info.py "<chat>"
uv run {baseDir}/scripts/history.py "<chat>" --output /tmp/export.jsonl
```

## Python Dependency Management

### `pyproject.toml`

```toml
[project]
name = "seed-telegram"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "telethon>=1.37",
    "cryptg>=0.4",      # faster crypto for MTProto (optional but recommended)
]

[tool.uv]
# Scripts use inline metadata, but pyproject.toml pins versions
```

### Inline Script Metadata (alternative)

Each script can declare its own deps for `uv run` without a virtual env:

```python
#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["telethon>=1.37"]
# ///
```

This means `uv run scripts/read.py ...` just works with no install step. `uv` resolves and caches the dependency automatically.

**Recommendation:** Use `pyproject.toml` so all scripts share one cached venv (faster after first run). Include inline metadata as a fallback for standalone usage.

## Output Truncation

Telegram chats can be huge. All tools enforce output limits:

- `telegram_read`: Default 50 messages, max 200 per call
- `telegram_search`: Default 20 results, max 100
- `telegram_chats`: Default 50 dialogs, max 200
- `telegram_info`: Members capped at 200

The pi extension also applies `truncateHead` from pi's truncation utilities if the JSON output exceeds 50KB, with a note pointing to a temp file with the full output.

## Error Handling

All scripts return structured errors:

```json
{"error": "Chat not found: 'Seed Clu'", "code": "CHAT_NOT_FOUND"}
{"error": "Not connected. Run /telegram-login", "code": "NOT_CONNECTED"}
{"error": "Session expired or revoked", "code": "AUTH_EXPIRED"}
{"error": "Flood wait: retry in 30 seconds", "code": "FLOOD_WAIT", "retryAfter": 30}
{"error": "Search query too short", "code": "INVALID_QUERY"}
```

The pi extension maps error codes to user-friendly guidance:
- `NOT_CONNECTED` → "Run /telegram-login to connect"
- `AUTH_EXPIRED` → Clear session, prompt re-login
- `FLOOD_WAIT` → Wait and retry automatically
- `CHAT_NOT_FOUND` → Suggest `telegram_chats` to find the right name

## Implementation Sequence

### Phase 1: Core (get reading working)

1. `_client.py` — shared client initialization
2. `login.py` — auth flow (CLI-only first)
3. `chats.py` — list dialogs
4. `read.py` — read messages
5. `telegram-client.ts` — session check, script runner helper
6. `tools/telegram.ts` — register `telegram_chats` and `telegram_read`
7. Wire into `index.ts`
8. Test: "read my last 20 messages from [group]"

### Phase 2: Search & Triage

1. `search.py` — message search
2. `unread.py` — unread message triage
3. Register `telegram_search` and `telegram_unread` tools
4. `telegram-digest.md` prompt template
5. Test: `/telegram-digest` produces a useful summary

### Phase 3: Auth Polish & Send

1. `/telegram-login` command with `ctx.ui.input()` flow
2. `/telegram-logout` and `/telegram-status` commands
3. Session start hook (status bar)
4. `send.py` + `telegram_send` tool with `ctx.ui.confirm()`
5. Test: send a message with approval flow

### Phase 4: Metadata & Advanced

1. `info.py` + `telegram_info` tool
2. `contacts.py` + `telegram_contacts` tool
3. `history.py` (CLI-only, for bulk export)
4. `telegram/SKILL.md` for advanced CLI usage
5. Remaining prompt templates

## Seed Network Web App: Schema & API Routes

The Telegram data needs a permanent home in Postgres so the pi extension (and future processes) can query indexed messages instead of hitting Telegram live every time. This follows the same patterns as existing Seed Network tables (Drizzle ORM, MCP API routes with Bearer auth).

### Database Schema (`db/schema.ts`)

#### `telegram_chats`

Stores every Telegram dialog the user has synced. The `telegramId` is Telegram's native chat identifier (can be negative for groups/channels).

```typescript
export const telegramChatTypeEnum = pgEnum("telegram_chat_type", [
  "user",        // 1:1 DM
  "bot",         // Bot conversation
  "group",       // Legacy group
  "supergroup",  // Modern group
  "channel",     // Broadcast channel
]);

export const telegramChats = pgTable(
  "telegram_chats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")                            // Which Seed Network user synced this
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    telegramId: text("telegram_id").notNull(),          // Telegram's native ID (bigint as text)
    type: telegramChatTypeEnum("type").notNull(),
    name: text("name").notNull(),                       // Display name
    username: text("username"),                          // @username if public
    description: text("description"),
    memberCount: integer("member_count"),
    imageUrl: text("image_url"),                         // Chat photo URL (if downloaded)

    // Sync state
    lastSyncedAt: timestamp("last_synced_at"),           // When we last pulled messages
    lastSyncedMessageId: text("last_synced_message_id"), // Highest message ID we've stored
    syncEnabled: boolean("sync_enabled").notNull().default(true), // User can disable per-chat

    // Optional link to a Seed Network signal (e.g., a company or person)
    signalId: uuid("signal_id").references(() => signals.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("telegram_chats_user_telegram_unique").on(table.userId, table.telegramId),
    index("telegram_chats_user_idx").on(table.userId),
    index("telegram_chats_telegram_id_idx").on(table.telegramId),
    index("telegram_chats_signal_idx").on(table.signalId),
  ]
);
```

#### `telegram_senders`

Normalized sender identities. A sender appears once per Seed Network user (since different users may know the same Telegram person by different contexts).

```typescript
export const telegramSenders = pgTable(
  "telegram_senders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    telegramId: text("telegram_id").notNull(),            // Telegram user ID
    name: text("name").notNull(),                          // Display name at last sync
    username: text("username"),                             // @username at last sync
    phone: text("phone"),                                  // Phone if known (contacts only)
    imageUrl: text("image_url"),
    isBot: boolean("is_bot").notNull().default(false),

    // Optional link to a Seed Network signal (person, company founder, etc.)
    signalId: uuid("signal_id").references(() => signals.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("telegram_senders_user_telegram_unique").on(table.userId, table.telegramId),
    index("telegram_senders_user_idx").on(table.userId),
    index("telegram_senders_telegram_id_idx").on(table.telegramId),
    index("telegram_senders_signal_idx").on(table.signalId),
  ]
);
```

#### `telegram_messages`

The core table — every message indexed. Text is full-text searchable. Each message references its chat and sender.

```typescript
export const telegramMessages = pgTable(
  "telegram_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")                               // Which Seed Network user this belongs to
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => telegramChats.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .references(() => telegramSenders.id, { onDelete: "set null" }),

    // Telegram native IDs
    telegramMessageId: text("telegram_message_id").notNull(), // Message ID within the chat
    telegramChatId: text("telegram_chat_id").notNull(),       // Denormalized for fast queries

    // Content
    text: text("text"),                                        // Message text (null for media-only)
    mediaType: text("media_type"),                             // "photo" | "video" | "document" | "voice" | "sticker" | null
    mediaUrl: text("media_url"),                               // Local path or URL if downloaded

    // Threading
    replyToMessageId: text("reply_to_message_id"),             // Telegram message ID of parent
    forwardFromChatId: text("forward_from_chat_id"),           // If forwarded
    forwardFromName: text("forward_from_name"),

    // Metadata
    views: integer("views"),
    reactions: jsonb("reactions").$type<{ emoji: string; count: number }[]>(),
    editDate: timestamp("edit_date"),
    isPinned: boolean("is_pinned").notNull().default(false),

    // Telegram's native timestamp
    date: timestamp("date").notNull(),

    // Our ingest timestamp
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Primary lookup: messages in a chat, ordered by date
    index("telegram_messages_chat_date_idx").on(table.chatId, table.date),
    // User-scoped queries
    index("telegram_messages_user_idx").on(table.userId),
    // Dedup: one message per user+chat+messageId
    unique("telegram_messages_user_chat_msg_unique").on(
      table.userId, table.telegramChatId, table.telegramMessageId
    ),
    // Full-text search on message content
    index("telegram_messages_text_search_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.text}, ''))`
    ),
    // Date range queries across all chats
    index("telegram_messages_user_date_idx").on(table.userId, table.date),
    // Sender lookups
    index("telegram_messages_sender_idx").on(table.senderId),
  ]
);
```

#### Types

```typescript
export type TelegramChat = typeof telegramChats.$inferSelect;
export type NewTelegramChat = typeof telegramChats.$inferInsert;
export type TelegramChatType = (typeof telegramChatTypeEnum.enumValues)[number];

export type TelegramSender = typeof telegramSenders.$inferSelect;
export type NewTelegramSender = typeof telegramSenders.$inferInsert;

export type TelegramMessage = typeof telegramMessages.$inferSelect;
export type NewTelegramMessage = typeof telegramMessages.$inferInsert;
```

### API Routes

All routes live under `/api/mcp/telegram/` and use the same `requireMcpAuth` pattern as existing MCP routes. Every route is scoped to the authenticated user — you can only query your own Telegram data.

#### `GET /api/mcp/telegram/chats`

List synced Telegram chats.

**Query params:**
- `?type=supergroup` — filter by chat type
- `?search=seed` — fuzzy search chat names
- `?hasUnread=true` — only chats with messages newer than `lastSyncedAt` (future: actual unread tracking)
- `?limit=50` — max results

**Response:**
```json
{
  "chats": [
    {
      "id": "uuid",
      "telegramId": "-1001234567890",
      "type": "supergroup",
      "name": "Seed Club Deals",
      "username": null,
      "memberCount": 47,
      "messageCount": 1234,
      "lastMessage": { "text": "...", "date": "...", "senderName": "Alice" },
      "lastSyncedAt": "2026-02-10T14:00:00Z",
      "signalId": null,
      "syncEnabled": true
    }
  ],
  "count": 12
}
```

#### `GET /api/mcp/telegram/messages`

Query messages with filters. This is the primary read interface.

**Query params:**
- `?chatId=uuid` — messages from a specific chat (our UUID, not Telegram ID)
- `?search=fundraising` — full-text search across all chats (uses Postgres `to_tsvector`)
- `?senderId=uuid` — messages from a specific sender
- `?since=2026-02-09T00:00:00Z` — date range start
- `?until=2026-02-10T00:00:00Z` — date range end
- `?limit=50&cursor=...` — pagination (cursor is ISO date of last result)
- `?hasMedia=true` — only messages with media

**Response:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "chat": { "id": "uuid", "name": "Seed Club Deals", "type": "supergroup" },
      "sender": { "id": "uuid", "name": "Alice", "username": "alice" },
      "text": "Just heard back from the founder, they're raising at $8M pre",
      "date": "2026-02-10T14:30:00Z",
      "replyToMessageId": "4521",
      "mediaType": null,
      "reactions": [],
      "isPinned": false
    }
  ],
  "nextCursor": "2026-02-10T14:25:00Z",
  "hasMore": true,
  "totalEstimate": 1234
}
```

#### `POST /api/mcp/telegram/messages`

Bulk ingest messages. Called by the Python sync scripts. Accepts up to 500 messages per request. Upserts by `(userId, telegramChatId, telegramMessageId)`.

**Body:**
```json
{
  "chatTelegramId": "-1001234567890",
  "messages": [
    {
      "telegramMessageId": "4523",
      "senderId": "12345",
      "senderName": "Alice",
      "senderUsername": "alice",
      "text": "Just heard back from the founder...",
      "date": "2026-02-10T14:30:00Z",
      "replyToMessageId": "4521",
      "mediaType": null,
      "isPinned": false,
      "reactions": []
    }
  ]
}
```

The route handles:
1. Upsert the chat record (create if first sync, update `lastSyncedAt`)
2. Upsert sender records (create or update name/username)
3. Upsert messages (skip if already exists with same content, update if edited)

**Response:**
```json
{
  "created": 45,
  "updated": 3,
  "skipped": 2,
  "chat": { "id": "uuid", "name": "Seed Club Deals" }
}
```

#### `POST /api/mcp/telegram/chats`

Bulk upsert chats from a sync. Called by `chats.py --sync` to register all dialogs.

**Body:**
```json
{
  "chats": [
    {
      "telegramId": "-1001234567890",
      "type": "supergroup",
      "name": "Seed Club Deals",
      "username": null,
      "description": "Deal discussion...",
      "memberCount": 47
    }
  ]
}
```

#### `PATCH /api/mcp/telegram/chats`

Update chat settings (enable/disable sync, link to signal).

**Body:**
```json
{
  "chatId": "uuid",
  "fields": {
    "syncEnabled": false,
    "signalId": "uuid-of-signal"
  }
}
```

#### `GET /api/mcp/telegram/senders`

List known senders, optionally filtered.

**Query params:**
- `?search=alice` — search by name or username
- `?chatId=uuid` — senders who have posted in a specific chat
- `?limit=50`

#### `PATCH /api/mcp/telegram/senders`

Link a sender to a Seed Network signal (person signal).

**Body:**
```json
{
  "senderId": "uuid",
  "signalId": "uuid-of-person-signal"
}
```

#### `GET /api/mcp/telegram/stats`

Overview stats for the Telegram integration.

**Response:**
```json
{
  "totalChats": 45,
  "totalMessages": 12340,
  "totalSenders": 234,
  "oldestMessage": "2025-01-15T00:00:00Z",
  "newestMessage": "2026-02-10T14:30:00Z",
  "chatsByType": { "supergroup": 12, "channel": 8, "user": 25 },
  "lastSyncedAt": "2026-02-10T14:00:00Z"
}
```

### How the Sync Scripts Change

With the DB in place, the Python scripts gain a `--sync` mode that pushes data to the Seed Network API instead of (or in addition to) printing to stdout.

#### `chats.py --sync`

1. Fetches all dialogs from Telegram via Telethon
2. POSTs to `/api/mcp/telegram/chats` to upsert them all
3. Prints summary: "Synced 45 chats (12 new, 33 updated)"

#### `read.py <chat> --sync`

1. Reads messages from Telegram
2. POSTs to `/api/mcp/telegram/messages` in batches of 500
3. Updates the chat's `lastSyncedAt` and `lastSyncedMessageId`
4. Prints summary: "Synced 234 messages from Seed Club Deals"

#### `history.py <chat> --sync`

Full backfill mode:
1. Reads entire chat history from Telegram (paginated, rate-limit aware)
2. POSTs to `/api/mcp/telegram/messages` in batches
3. Shows progress: "Synced 5,000 / ~12,000 messages..."

#### `sync-all.py` (new script)

Orchestrator that syncs everything:
1. Runs `chats.py --sync` to register all dialogs
2. For each chat with `syncEnabled=true`:
   - Fetches messages since `lastSyncedMessageId`
   - POSTs to messages endpoint
3. Can be run on a cron (every 15 minutes) or manually

```bash
# Full initial sync
uv run scripts/sync-all.py --full

# Incremental (only new messages since last sync)
uv run scripts/sync-all.py

# Sync specific chats only
uv run scripts/sync-all.py --chat "Seed Club Deals" --chat "Crypto Twitter"
```

### How Pi Extension Tools Evolve

With the DB populated, the pi extension tools shift from shelling out to Python scripts to querying the Seed Network API directly (same as deals, signals, research tools):

| Tool | v1 (Phase 1-4) | v2 (with DB) |
|------|----------------|--------------|
| `telegram_chats` | `uv run chats.py` → stdout JSON | `GET /api/mcp/telegram/chats` |
| `telegram_read` | `uv run read.py` → stdout JSON | `GET /api/mcp/telegram/messages?chatId=...` |
| `telegram_search` | `uv run search.py` → stdout JSON | `GET /api/mcp/telegram/messages?search=...` |
| `telegram_send` | `uv run send.py` (always live) | `uv run send.py` (always live) |
| `telegram_unread` | `uv run unread.py` → stdout JSON | `GET /api/mcp/telegram/chats?hasUnread=true` |
| `telegram_info` | `uv run info.py` → stdout JSON | `GET /api/mcp/telegram/chats` + senders |
| `telegram_sync` | n/a | `uv run sync-all.py` (triggers sync) |

The `telegram_send` tool always goes through Telethon live — you can't send messages via a database. Everything else can read from the DB once it's populated.

### New Pi Extension Tools (DB-powered)

| Tool | Description |
|------|-------------|
| `telegram_sync` | Trigger a sync: full backfill or incremental. Wraps `sync-all.py --sync`. |
| `telegram_link_chat` | Link a Telegram chat to a Seed Network signal. `PATCH /api/mcp/telegram/chats`. |
| `telegram_link_sender` | Link a Telegram sender to a person signal. `PATCH /api/mcp/telegram/senders`. |
| `telegram_stats` | Show sync status and message counts. `GET /api/mcp/telegram/stats`. |

### Entity Linking

The `signalId` foreign keys on `telegram_chats` and `telegram_senders` are how Telegram data connects to the rest of the Seed Network graph:

- **Chat → Signal:** "Seed Club Deals" group → linked to a `company` or `topic` signal. Now when events fire for that signal, the agent knows which Telegram chat has context.
- **Sender → Signal:** "Alice" in Telegram → linked to a `person` signal for Alice. Now when the agent looks up Alice, it can query her Telegram messages for context.

These links are set manually via `telegram_link_chat` / `telegram_link_sender` tools, or the agent can suggest them: "I see a sender named 'alice_founder' who matches the person signal for Alice Chen — want me to link them?"

### Privacy & Access Control

- All Telegram data is **scoped to the user who synced it.** Every query includes `userId` in the WHERE clause.
- No cross-user visibility. If two Seed Network users both sync the same group, they each have their own copy.
- The `syncEnabled` flag lets users exclude specific chats from sync (e.g., personal DMs).
- Message content is stored in plaintext in Postgres. The same security posture as existing deal memos and research artifacts — protected by API auth, not encrypted at rest.

### Implementation Status

All five phases are complete. Summary:

- **Phase 1 ✅** — `_client.py`, `login.py`, `logout.py`, `chats.py`, `read.py`, `telegram-client.ts`, `tools/telegram.ts` (8 tools with custom renderers)
- **Phase 2 ✅** — `search.py`, `unread.py`, `send.py`, `info.py`, `contacts.py`, `history.py`, 3 prompt templates, SKILL.md
- **Phase 3 ✅** — 3 DB tables (`telegram_chats`, `telegram_senders`, `telegram_messages` with FTS), 4 API route files
- **Phase 4 ✅** — `--sync` flag on scripts, `_sync.py` helpers, `sync-all.py` orchestrator, `telegram_sync` tool
- **Phase 5 ✅** — `/telegram-login` (phone-only, built-in app credentials), `/telegram-logout`, `/telegram-status`, `ctx.ui.confirm` on send, session start hook

#### Outstanding (not blocked, implement when needed)
- Run DB migrations for the 3 new tables
- Switch pi tools from live Telethon → DB API queries once sync pipeline is in use
- `telegram_link_chat` / `telegram_link_sender` tools for entity linking
- Background continuous sync (long-running Telethon event handler, separate from pi)

## Future Considerations

### Background Continuous Sync

Once the DB and sync pipeline are solid, the next step is a long-running process (separate from pi) that keeps messages flowing in continuously:

- Telethon `client.on(events.NewMessage)` handler
- Runs as a systemd service, Docker container, or Railway deployment
- Writes directly to the DB (or POSTs to the ingest API)
- Means the DB is always current — no manual `telegram_sync` needed

This is what enables the real-time intelligence layer: relationship temperature tracking, cross-conversation pattern detection, founder update ingestion — all operating on the continuously-updated DB.

### Voice Message Transcription

Telethon can download voice messages. A future addition could:
- Detect voice/audio messages in `read.py` output
- Download and transcribe via Whisper (the transcribe skill already exists)
- Include transcription in the message text

### Mark as Read

Telethon supports `client.send_read_acknowledge()`. Could add a `mark-read.py` script and tool so the agent can mark chats as read after processing them in a digest.

### AI Analysis Jobs

With messages in the DB, periodic jobs can run analysis:
- **Action item extraction:** Find messages that contain asks, todos, or commitments
- **Relationship scoring:** Message frequency × recency × sentiment per sender
- **Topic clustering:** Group messages by topic across chats
- **Founder update detection:** Pattern-match portfolio founder messages for progress updates

These would write results to `signal_events` or a new `telegram_insights` table, surfaced through the existing event feed.
