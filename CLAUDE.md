# CLAUDE.md

## Important: Editing the Pi Extension

**Never edit the installed copy** at `~/.pi/agent/git/github.com/seedclub/pi-extension/`. That directory is managed by pi's package installer and changes there will be overwritten on updates.

**Always edit the local clone** at `~/Projects/pi-extension/`. This is the source of truth. After changes are committed and pushed here, they can be installed via `pi install`.

## Project Overview

This is the Seed Network pi extension. It provides:
- **Tools**: Deal management, company tracking, signals, events, research, enrichments, Twitter integration
- **Commands (instant, no LLM)**:
  - `/add` — Create signals instantly from @handles, URLs, names
  - `/import` — Bulk import signals (opens editor for pasting)
  - `/signals` — List/search signals without LLM roundtrip
  - `/seed-dev` — Toggle between production and local dev API
  - `/seed-connect` — Authenticate with Seed Network
- **Prompts (LLM-assisted)**: `/tend`, `/source`, `/enrich`, `/activity`, `/import-follows`, `/import-bookmarks`, `/twitter-check`, `/twitter-news`
- **Skills**: Deal sourcing workflow guidance

## Architecture

Commands in `src/commands/` bypass the LLM entirely — they parse input, call the API directly, and show clean notifications. This is the "magic" path.

Prompts in `prompts/` inject context for the LLM to process — use these for tasks that need reasoning (tending, sourcing, enrichment).

Tools in `src/tools/` are callable by the LLM and have custom rendering (`renderCall`/`renderResult`) for clean TUI output.

## Repository Structure

- `src/commands/` - Instant commands (no LLM needed)
- `src/tools/` - LLM-callable tools with custom rendering
- `src/` - API client, auth, Twitter client
- `prompts/` - Prompt templates for LLM-assisted slash commands
- `skills/` - Skill definitions with reference docs

## Development

Use `/seed-dev` to point the extension at your local dev server:
```
/seed-dev         # → http://localhost:3000
/seed-dev 3001    # → http://localhost:3001
/seed-dev off     # → back to production
```

## Related Repos

- **seed-network-ux-radar** (`~/Projects/seed-network-ux-radar`): The feature branch with branched Neon DB. Run `npm run dev` to start the local API.
- **seed-network** (`~/seed-network`): The main app (production). The pi extension calls the API defined there (`/api/mcp/*` routes).
