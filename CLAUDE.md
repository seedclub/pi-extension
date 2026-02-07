# CLAUDE.md

## Important: Editing the Pi Extension

**Never edit the installed copy** at `~/.pi/agent/git/github.com/seedclub/pi-extension/`. That directory is managed by pi's package installer and changes there will be overwritten on updates.

**Always edit the local clone** at `~/seed-network-pi/`. This is the source of truth. After changes are committed and pushed here, they can be installed via `pi install`.

## Project Overview

This is the Seed Network pi extension. It provides:
- **Tools**: Deal management, company tracking, signals, events, research, enrichments, Twitter integration
- **Prompts**: `/tend`, `/source`, `/enrich`, `/add`, `/activity`, `/import-follows`, `/import-bookmarks`, `/twitter-check`, `/twitter-news`
- **Skills**: Deal sourcing workflow guidance

## Repository Structure

- `src/` - Extension source code (tools, API client, auth, Twitter client)
- `prompts/` - Prompt templates for slash commands
- `skills/` - Skill definitions with reference docs

## Related Repos

- **seed-network** (`~/seed-network`): The main app with API routes, database, and frontend. The pi extension calls the API defined there (`/api/mcp/*` routes).
