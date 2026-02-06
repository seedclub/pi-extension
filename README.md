# Seed Network Extension for Pi

Deal sourcing, research, signal tracking, and Twitter/X integration for [Seed Network](https://seed.network) — built as a [pi](https://github.com/badlogic/pi-mono) extension.

## Installation

```bash
# From git
pi install https://github.com/seedclub/pi-extension

# From npm (once published)
pi install npm:@seedclub/pi-extension

# Quick test without installing
pi -e ./src/index.ts
```

## Configuration

| Variable | Description |
|----------|-------------|
| `SEED_NETWORK_TOKEN` | API token from /admin/api-tokens (optional if using browser auth) |
| `SEED_NETWORK_API` | API base URL (default: https://beta.seedclub.com) |

## Commands

| Command | Description |
|---------|-------------|
| `/seed-connect <token>` | Connect with an API token |
| `/seed-logout` | Disconnect from Seed Network |
| `/seed-status` | Check connection status |

## Prompt Templates

| Template | Description |
|----------|-------------|
| `/source` | Research and create a deal submission |
| `/enrich` | Add information to an existing deal |
| `/activity` | View your contributions |
| `/tend` | Check signals for events and updates |
| `/connect` | Connect your account |
| `/import-bookmarks` | Import Twitter/X bookmarks as signals |
| `/import-follows` | Import Twitter/X following as signals |
| `/twitter-check` | Verify Twitter/X authentication |
| `/twitter-news` | Get trending Twitter/X news |

## Tools

### Deals
`create_deal`, `update_deal`, `get_deal`, `list_deals`, `search_deals`

### Companies
`create_company`, `update_company`, `get_company`, `list_companies`, `search_companies`

### Signals
`create_signal`, `batch_create_signals`, `get_signal`, `list_signals`, `search_signals`, `delete_signal`, `add_signal_relation`

### Research
`save_research`, `get_research`, `query_research`, `link_research`

### Enrichments
`add_enrichment`, `get_enrichments`, `cancel_enrichment`

### Events
`create_event`, `batch_create_events`, `list_events`, `get_signals_to_tend`, `mark_signal_tended`, `batch_mark_signals_tended`

### Twitter/X
`twitter_check`, `twitter_whoami`, `twitter_following`, `twitter_followers`, `twitter_bookmarks`, `twitter_news`, `twitter_search`, `twitter_likes`, `twitter_read`

### Utility
`get_current_user`, `sync_status`, `seed_auth_status`

## Skills

The extension includes a **Deal Sourcing** skill with reference documentation for deal structure and research patterns. This is automatically available when the extension is installed.

## Authentication

The extension supports three authentication methods (in priority order):

1. **Environment variable**: Set `SEED_NETWORK_TOKEN` 
2. **Stored token**: Use `/seed-connect <token>` (saved to `~/.config/seed-network/token`)
3. **Browser auth**: Automatically triggered when making API calls without a token — opens a browser window to sign in

Twitter/X tools read cookies from Safari, Chrome, or Firefox automatically — no API keys needed.

## Development

```bash
# Clone and install dependencies
cd seed-network-pi
npm install

# Test with pi
pi -e ./src/index.ts
```

## License

UNLICENSED
