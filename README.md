# Seed Network Extension for Pi

Deal sourcing, research, signal tracking, and Twitter/X integration for [Seed Network](https://seed.network).

## Quick Start

```bash
pi install git@github.com:seedclub/pi-extension
```

Then in pi:

```
/seed-connect
/add @naval, @paulg, Stripe, AI safety
/tend
```

That's it. `/seed-connect` opens your browser to sign in. `/add` takes anything — handles, names, URLs, topics. Or pass a token directly: `/seed-connect sn_abc123`

## Commands

| Command | Description |
|---------|-------------|
| `/seed-connect [token]` | Connect (opens browser, or pass token directly) |
| `/seed-logout` | Disconnect |
| `/seed-status` | Check connection |

## Workflows (Prompt Templates)

| Template | Description |
|----------|-------------|
| `/add <anything>` | Track something — Twitter handle, company, person, topic, URL |
| `/tend` | Check signals for events and updates |
| `/source <company>` | Research and create a deal submission |
| `/enrich <deal>` | Add information to an existing deal |
| `/activity` | View your contributions |
| `/import-bookmarks` | Import Twitter/X bookmarks as signals |
| `/import-follows` | Import Twitter/X following as signals |
| `/twitter-check` | Verify Twitter/X authentication |
| `/twitter-news` | Get trending Twitter/X news |

## Tools

**Deals**: `create_deal`, `update_deal`, `get_deal`, `list_deals`, `search_deals`

**Companies**: `create_company`, `update_company`, `get_company`, `list_companies`, `search_companies`

**Signals**: `create_signal`, `batch_create_signals`, `get_signal`, `list_signals`, `search_signals`, `delete_signal`, `add_signal_relation`

**Research**: `save_research`, `get_research`, `query_research`, `link_research`

**Enrichments**: `add_enrichment`, `get_enrichments`, `cancel_enrichment`

**Events**: `create_event`, `batch_create_events`, `list_events`, `get_signals_to_tend`, `mark_signal_tended`, `batch_mark_signals_tended`

**Twitter/X**: `twitter_check`, `twitter_whoami`, `twitter_following`, `twitter_followers`, `twitter_bookmarks`, `twitter_news`, `twitter_search`, `twitter_likes`, `twitter_read`

**Utility**: `get_current_user`

## Configuration

| Variable | Description |
|----------|-------------|
| `SEED_NETWORK_TOKEN` | API token (alternative to `/seed-connect`) |
| `SEED_NETWORK_API` | API base URL (default: https://beta.seedclub.com) |

Twitter/X tools read cookies from Safari, Chrome, or Firefox automatically — no API keys needed.

## License

UNLICENSED
