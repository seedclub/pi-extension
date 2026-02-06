# Signal Tending Workflow

Check your followed signals for newsworthy events and updates.

## What Tending Does

1. Identifies signals that haven't been checked recently
2. Researches each signal for recent activity (last few days)
3. Creates events for newsworthy occurrences
4. Marks signals as tended to track when they were last checked

## Event Types to Look For

**Structured Events** (concrete, factual):
- `fundraising_announced` - Funding rounds, investments
- `acquisition` - M&A activity
- `product_launch` - New products, features, services
- `key_hire` - Notable hires (C-suite, key roles)
- `partnership` - Strategic partnerships
- `media_coverage` - Major press coverage
- `regulatory_filing` - SEC filings, regulatory news

**Semi-Structured Events** (signals and trends):
- `social_activity` - Notable tweets, viral moments
- `sentiment_change` - Shifts in public perception
- `market_signal` - Market trends, sector shifts
- `endorsement` - Notable praise or recommendation

**Flexible Events** (insights and observations):
- `insight` - Interesting observations, analysis
- `custom` - Anything that doesn't fit above

## Workflow

### Step 1: Get Signals to Tend

If the user specified a signal type or name:
- Use `list_signals` to find matching signals

Otherwise:
- Use `get_signals_to_tend` to get signals due for checking

### Step 2: Research Each Signal

For each signal, research recent activity based on signal type. Check the signal's `metadata` for hints — especially `feedUrl` and `handle`.

#### Twitter accounts

- Use `twitter_search` for recent tweets from/mentioning the account
- Use `twitter_read` for specific tweets
- Look for: announcements, fundraising, product launches, notable takes, viral moments

#### Blogs / Newsletters

- Check `metadata.feedUrl`. If present, run:
  ```bash
  scripts/fetch-feed.js <feedUrl> --limit 10
  ```
- Scan the returned items for posts published since the signal was last tended
- Create events for posts relevant to the network's interests (startups, investing, tech, crypto, DAOs)
- Skip routine/low-signal content (weekly roundups with no substance, minor updates)
- Use type `media_coverage` for news/analysis, `insight` for opinion/thought pieces
- If no feedUrl: web search `site:{domain}` for recent content

#### GitHub profiles

- Check `metadata.feedUrl` (typically `https://github.com/{user}.atom`). If present, run:
  ```bash
  scripts/fetch-feed.js <feedUrl> --limit 10
  ```
- Filter aggressively — most GitHub activity is noise (routine pushes, minor commits)
- Only event-worthy: new public repos, projects gaining significant traction, major releases
- Use type `product_launch` for new repos/releases

#### Subreddits

- Check `metadata.feedUrl` (typically `https://reddit.com/r/{sub}/.rss`). If present, run:
  ```bash
  scripts/fetch-feed.js <feedUrl> --limit 15
  ```
- Focus on posts relevant to the network's thesis — startup launches, funding announcements, industry trends, notable discussions
- Skip generic advice posts, simple questions, low-engagement content
- Use type `market_signal` for trend discussions, `media_coverage` for news shared there

#### Podcasts

- Check `metadata.feedUrl`. If present, run:
  ```bash
  scripts/fetch-feed.js <feedUrl> --limit 5
  ```
- Create events for new episodes, especially when the guest or topic is relevant to the network
- Use type `media_coverage`
- Set higher `importance` if the guest is someone tracked in the signal graph

#### Companies

- No feed typically — use web search for recent news, funding announcements, product launches, press coverage
- If the company has a Twitter handle in metadata, also check Twitter
- If they have a blog with a feedUrl, check the feed too

#### People

- Check Twitter if they have a handle
- Web search for career moves, speaking engagements, thought leadership, new projects
- Use type `key_hire` for job changes, `insight` for notable public statements

#### Topics / Custom

- Web search for recent developments, trending discussions
- Look for major shifts, new entrants, regulatory changes, notable publications

### Step 3: Create Events

For each noteworthy finding:
- Choose the appropriate event type
- Write a clear, concise title (not just the feed item title — add context if needed)
- Add a summary with context (why this matters to the network)
- Include the source URL
- Set importance (0-100): 90+ must know, 70-89 notable, 50-69 interesting, <50 minor
- For feed-sourced events, use dedupe key: `feed:{signalId}:{item.guid || item.link}`
- For other events: `{signalId}:{eventType}:{identifier}`

**Be editorial, not exhaustive.** A feed might have 10 new items but only 1-2 are worth creating events for. The goal is signal, not noise.

### Step 4: Mark Signals Tended

After processing each signal, call `mark_signal_tended`. If tending failed for a signal (e.g., feed was unreachable), pass the error message.

### Step 5: Summary

Report: how many signals tended, events created, highlights, failures.
