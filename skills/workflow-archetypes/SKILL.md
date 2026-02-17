---
name: workflow-archetypes
description: |
  Workflow templates for pre-seed VC deal flow on Telegram. Use when creating
  multi-step workflows via create_action_items. Covers intros, deal intake,
  meetings, and follow-ups. Load this skill before creating any multi-step workflow.
---

# Workflow Archetypes

A workflow tracks a relationship or deal from first contact through close. It's a single thread — one `workflowId` — that grows over time as the relationship progresses. Steps within a workflow are grouped into **phases**.

## Phases

| Phase | Steps | When |
|-------|-------|------|
| `intro` | Qualify → Opt-in → Connect | Someone asks for a warm intro |
| `deal` | Capture → Next Step | A pitch or deal surfaces |
| `meeting` | Schedule → Debrief | Need to get on a call |
| `follow-up` | Draft → Send | Need to nudge or close a loop |

A single workflow can span multiple phases:

```
Workflow: "Alice (Acme Corp)"
├─ intro
│  ├─ Step 0: Qualify
│  ├─ Step 1: Opt-in
│  └─ Step 2: Connect
├─ meeting
│  ├─ Step 3: Schedule call
│  └─ Step 4: Debrief
├─ follow-up
│  └─ Step 5: Send deck follow-up
└─ deal
   └─ Step 6: Create deal
```

## How to use

Set `phase` on every step. Set `workflowMetadata` when creating a new workflow (or update it on a later step if the context changes):

```json
{
  "workflowId": "existing-or-new-id",
  "stepIndex": 0,
  "phase": "intro",
  "title": "Qualify intro: Alice wants to meet Bob",
  "workflowMetadata": {
    "label": "Alice (Acme Corp)",
    "oneLiner": "Pre-seed climate tech, via Bob"
  }
}
```

- `phase` goes on every step — it's how the UI groups steps within a workflow
- `workflowMetadata` is optional after the first step — only provide it to update the workflow's label or oneLiner
- Reuse the same `workflowId` as the relationship progresses through phases

## Not everything needs a workflow

Simple one-off actions (reply to a message, save a note) should be standalone steps — no `phase`, no `workflowId`. Phases are for multi-step sequences with human decision points.

---

## Intro

Someone asks you for a warm introduction.

**Steps:**

| # | Title pattern | Type | What happens |
|---|---------------|------|-------------|
| 0 | Qualify intro: [requester] → [target] | `approval_needed` | Present who's asking, who they want to meet, and why. User decides yes/no. |
| 1 | Send opt-in to [target] | `approval_needed` | Draft a double-opt-in message to the target. User approves the message. |
| 2 | Connect [requester] and [target] | `task` | Create a Telegram group with both parties and send the intro message. |

**Qualifying step description should include:**
- Who is asking (name, company if relevant, one line of context)
- Who they want to meet
- Why (what's the ask?)
- Your recommendation

**Double opt-in message should be:** Short, respectful, explain who wants to meet and why, easy to decline.

**If rejected at Qualify:** Workflow ends. Optionally create a standalone step to send a polite decline.
**If target declines:** User rejects step 1. Workflow ends.

---

## Deal

A pitch or deal comes through — someone sends a deck, a founder is intro'd, a deal is forwarded in a group chat.

**Steps:**

| # | Title pattern | Type | What happens |
|---|---------------|------|-------------|
| 0 | Capture: [company/founder] | `task` | Extract what we know: company name, what they do, who referred them, any links. Save as a deal if enough info. |
| 1 | Next step: [company/founder] | `approval_needed` | Present the summary. User decides: take a call, pass, or need more info. |

**Capture step should extract:** Company name and one-liner (even if vague), founder name(s), who referred / where it came from, any links.

Most pre-seed companies are stealth — don't try to research what isn't there. Just capture what was shared.

**Next Step suggestedAction should offer:** "Schedule a call" (→ add meeting phase steps), "Pass" (optionally draft a polite pass), or "Need more info" (draft a message asking questions).

---

## Meeting

Schedule and debrief a call.

**Steps:**

| # | Title pattern | Type | What happens |
|---|---------------|------|-------------|
| 0 | Schedule call with [person] | `approval_needed` | Draft a scheduling message. User approves before it's sent. |
| 1 | Debrief: [person] | `approval_needed` | After the call: prompt for notes and next steps. User records outcome. |

**Schedule step:** Draft a short message with scheduling link or proposed times. Use `agentCommand.tool: "telegram_send"`.

**Debrief step:** Remind the user who the call was with. Use `agentCommand.prompt` — the agent captures the user's notes and may create a deal, draft a follow-up, etc.

---

## Follow-up

Nudge someone, close a loop, or check in.

**Steps:**

| # | Title pattern | Type | What happens |
|---|---------------|------|-------------|
| 0 | Draft follow-up to [person] | `approval_needed` | Draft the message with context. User reviews and approves. |
| 1 | Send follow-up to [person] | `task` | Send the approved message. |

**Draft step:** Include backstory in `description` so the user remembers the context. Use `agentCommand.tool: "telegram_send"` with the drafted message.

---

## Growing a workflow

When a workflow transitions to a new phase, add steps to the same `workflowId` with the next `stepIndex` values and the new `phase`. Update `workflowMetadata.oneLiner` if the context has evolved:

```
// Workflow started as intro, now scheduling a meeting
create_action_items({
  actions: [{
    workflowId: "existing-workflow-id",
    stepIndex: 3,
    phase: "meeting",
    type: "approval_needed",
    title: "Schedule call with Alice",
    agentCommand: { tool: "telegram_send", args: { ... } },
    workflowMetadata: {
      oneLiner: "Pre-seed climate tech — intro made, scheduling call"
    }
  }]
})
```
