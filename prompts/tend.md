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

For each signal, research recent activity based on signal type:

**Twitter accounts**: Use `twitter_read` to fetch recent tweets. Look for announcements, threads, notable takes. Use `twitter_search` for mentions.

**Companies**: Check Twitter if they have a handle, search for funding news, product launches, press coverage.

**People**: Check Twitter, search for career moves, speaking engagements, thought leadership.

**Topics/Custom**: Search for recent developments, trending discussions.

### Step 3: Create Events

For each noteworthy finding:
- Choose the appropriate event type
- Write a clear, concise title
- Add a summary with context
- Include the source URL
- Set importance (0-100): 90+ must know, 70-89 notable, 50-69 interesting, <50 minor
- Create a dedupe key: `{signalId}:{eventType}:{identifier}`

### Step 4: Mark Signals Tended

After processing each signal, call `mark_signal_tended`.

### Step 5: Summary

Report: how many signals tended, events created, highlights, failures.
