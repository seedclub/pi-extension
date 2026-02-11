# Telegram Digest

Run my daily Telegram digest.

## Steps

1. Call `telegram_digest` to fetch all new messages since the last digest
2. If there are no new messages, say so and stop
3. Analyze all messages and produce the structured digest below

## Output Format

### 🔴 Action Items
Things I need to do, respond to, or decide on. Be specific about what's needed and who asked.

- **[Chat Name]** — [Who] asked [what]. _[Quote relevant message snippet]_

### 🟡 Follow-ups to Track  
Commitments others made, things someone said they'd do, or conversations that need a check-in. Include a suggested follow-up date if one is implied.

- **[Chat Name]** — [Who] said they'd [what] by [when]. Follow up: [suggested date]

### 🔵 Intro Requests
Anyone asking for an introduction to someone else.

- **[Chat Name]** — [Who] wants an intro to [Target]. Context: [why]

### 💬 Notable Threads
Important discussions, news, or alpha worth knowing about. Keep to 1-2 sentences each.

- **[Chat Name]** — [Summary]

### 📊 Stats
- Chats processed: X
- New messages: Y
- Action items: Z

## Guidelines

- Skip bot messages, join/leave notifications, and media-only messages with no meaningful text
- If a message is ambiguous about whether it needs action from me, include it in Follow-ups rather than Action Items
- For group chats, only flag things that seem directed at me or relevant to my interests (investing, startups, intros)
- Quote actual message text when it helps clarify what's needed
- If the same person appears across multiple chats, note that
