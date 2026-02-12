# Telegram Update

Process Telegram messages and surface action items in the webapp, then execute any previously-approved actions.

## Phase 1: Process Inbox Responses

First, check if there are any previously-approved action items waiting for execution.

1. Call `poll_action_responses` (with `acknowledge: false`) to get all unacknowledged user responses
2. For each response:

**Approved** — Execute the action described in `agentCommand.prompt` (or use `agentCommand.tool` + `agentCommand.args` if specified):
- For Telegram messages: use `telegram_send`
- For intros: use `telegram_create_group` or send individual messages asking permission first
- For follow-ups: use `telegram_send` to the appropriate chat

**Rejected** — Skip, just note in the summary.

**Custom Response** — Read `userResponse` and execute according to their instruction instead of the original suggestion.

3. If an approved action seems risky or unclear, mention it in the summary rather than executing blindly.
4. **After successfully executing each action**, call `acknowledge_actions` with the IDs of the items you processed. This ensures items aren't lost if execution is interrupted. Acknowledge rejected items too since they don't need further action.

## Phase 2: Digest New Messages

1. Call `telegram_digest` to fetch all new messages since the last digest
2. If there are no new messages, skip to the summary
3. Analyze all messages for actionable items

## Phase 3: Create Action Items

For every actionable item found, call `create_action_items` with a single batch.
Map each item to the right type:

- **intro_request** — Someone asked for an introduction to someone else
- **follow_up** — Someone is waiting to hear back, or committed to doing something
- **response_needed** — A direct question or request that needs a reply
- **approval_needed** — Something that needs explicit approval
- **task** — A concrete task to complete

For each action item, include:
- `title`: Short, specific summary (e.g., "Alice asked for intro to Bob Chen")
- `description`: Context with relevant quote snippets from the actual messages
- `suggestedAction`: What you'd do if approved (e.g., "Message Bob asking if he'd like to connect with Alice")
- `sourceContext`: Include `platform: "telegram"`, `chatName`, and `people` involved
- `agentCommand`: Include a `prompt` describing what to do when approved:
  - Intros: `{ prompt: "Send a message to [person] in Telegram asking if they'd like an intro to [other person]. Context: [why]" }`
  - Follow-ups: `{ prompt: "Send a follow-up message in [chat] to [person] about [topic]" }`
  - Responses: `{ prompt: "Reply to [person] in [chat] about [topic]. Suggested response: [response]" }`

## Output Format

### ✅ Executed Actions
Actions approved by the user that were just executed. Skip this section if none.

- [Title] — [What you did]

### ⚡ New Action Items
Summary of what was pushed to the webapp.

- X action items created (Y intro requests, Z follow-ups, etc.)
- Open the feed at /feed to review and approve/dismiss

### 💬 Notable Threads
Important discussions, news, or alpha worth knowing about but not actionable. Keep to 1-2 sentences each.

- **[Chat Name]** — [Summary]

### 📊 Stats
- Chats processed: X
- New messages: Y
- Actions executed: Z
- New action items: W

## Guidelines

- Skip bot messages, join/leave notifications, and media-only messages with no meaningful text
- If a message is ambiguous about whether it needs action, still create an action item as `follow_up` — the user can dismiss it easily
- For group chats, only flag things directed at me or relevant to my interests (investing, startups, intros)
- Quote actual message text in the `description` when it helps clarify what's needed
- If the same person appears across multiple chats, note that
- Be generous with creating action items — it's easier to dismiss than to miss something
- Always set `agentCommand.prompt` so the agent knows what to do when the user approves
- The `telegram_send` tool will prompt for terminal confirmation before actually sending — this is expected and acts as a final safety check even for pre-approved actions
- When executing multiple approved sends in a row, batch them together and note to the user how many sends require terminal confirmation
