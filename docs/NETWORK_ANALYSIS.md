# Network Following Analysis

Discover emerging profiles by analyzing who your Seed Network signals are following on Twitter/X.

## Overview

This feature identifies people getting attention from your network by finding **overlapping follows** - profiles that multiple signals have recently followed.

**Use cases:**
- 🔍 Discover emerging builders/founders before they're well-known
- 🎯 Identify potential deal sources
- 📊 Track network attention trends
- 🤝 Find connectors in your ecosystem

## How It Works

### Phase 1: Heuristic Approach (Current)

Since Twitter's API doesn't expose "follow date", we use a heuristic:

1. **Get signals**: Fetch all Seed Network signals with Twitter handles
2. **Sample recent follows**: For each signal, get their first 50-100 following (assumed recent)
3. **Find overlaps**: Identify profiles followed by 2+ signals
4. **Rank results**: Sort by overlap count and follower count

**Assumptions:**
- Recent follows appear near the top of Twitter's following list
- This gives us "recent-ish" follows, not exact "last week"
- Good enough for discovery, not perfect for time-based analysis

### Phase 2: Snapshot-Based (Future)

For true time-based analysis:

1. **Daily snapshots**: Capture following lists daily
2. **Compare snapshots**: New follows = current - previous
3. **Time-based queries**: "Who was followed in the last 7 days?"
4. **Trend analysis**: Track velocity and patterns over time

## Usage

### Via Pi Extension

```bash
# Quick analysis (test mode - 10 signals)
/network-analysis

# This calls analyze_network_follows with defaults
```

### Direct Tool Call

```typescript
{
  "tool": "analyze_network_follows",
  "params": {
    "minOverlap": 2,        // Profiles followed by 2+ signals
    "sampleSize": 100,      // Check 100 recent follows per signal
    "delayMs": 1500,        // 1.5s delay between API calls
    "signalLimit": 10       // Optional: limit to 10 signals (for testing)
  }
}
```

### Standalone Test Script

```bash
node test-network-analysis.js
```

Edit the `MOCK_SIGNALS` array in the script to test with specific Twitter handles.

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `minOverlap` | number | 2 | Minimum signals that must follow a profile |
| `sampleSize` | number | 50 | How many follows to check per signal (10-200) |
| `delayMs` | number | 1500 | Delay between API calls (ms) to avoid rate limiting |
| `signalLimit` | number | none | Limit number of signals to analyze (for testing) |

### Parameter Guidelines

**minOverlap:**
- `2` = Broad discovery (more results, some noise)
- `3` = Balanced (good signal-to-noise ratio)
- `4+` = High confidence (fewer results, very relevant)

**sampleSize:**
- `50` = Quick scan (very recent follows only)
- `100` = Recommended (good balance)
- `200` = Comprehensive (but slower, may hit rate limits)

**delayMs:**
- `1000` = Aggressive (risk of rate limiting)
- `1500` = Recommended (safe default)
- `2000+` = Conservative (very safe, but slow)

## Response Format

```json
{
  "emergingProfiles": [
    {
      "userId": "123456789",
      "username": "newfounder",
      "name": "Alice Builder",
      "description": "Building something cool...",
      "followersCount": 5000,
      "followedBy": ["signal1", "signal2", "signal3"],
      "overlapCount": 3,
      "profileUrl": "https://x.com/newfounder",
      "profileImageUrl": "https://pbs.twimg.com/..."
    }
  ],
  "stats": {
    "signalsAnalyzed": 50,
    "signalsWithTwitter": 45,
    "totalProfilesChecked": 4500,
    "uniqueProfiles": 3200,
    "overlapsFound": 25,
    "processingTimeMs": 68000
  },
  "errors": ["@signal123: Failed to fetch following"]
}
```

## Performance

**Example: 50 signals, 100 follows each**

- Total API calls: ~50 (one per signal)
- Profiles analyzed: ~5,000
- Processing time: ~75 seconds (with 1.5s delays)
- Rate limiting: Safe (within Twitter's web API limits)

**Optimization tips:**
- Use `signalLimit` for quick tests
- Lower `sampleSize` for faster results
- Increase `delayMs` if hitting rate limits

## Interpreting Results

### Good Signals

Profiles worth investigating typically have:
- ✅ **High overlap** (3+ signals following)
- ✅ **Relevant bio** (building, founding, creating)
- ✅ **Reasonable followers** (not too low, not too high)
- ✅ **Recent activity** (tweeting regularly)

### False Positives

Watch out for:
- ❌ Mega-influencers (everyone follows them)
- ❌ News accounts / aggregators
- ❌ Bot accounts
- ❌ Inactive profiles

### Best Practices

1. **Start small**: Use `signalLimit: 10` to test
2. **Iterate**: Adjust `minOverlap` based on results
3. **Investigate**: Click through to profiles, read bios
4. **Take action**: Add to signals, reach out, research
5. **Run regularly**: Weekly or monthly scans

## Rate Limiting

**Twitter's limits** (via web API):
- ~300 requests per 15 minutes per user
- Our default delay (1.5s) = ~40 requests/minute = safe

**If rate limited:**
- Increase `delayMs` to 2000-3000ms
- Reduce `sampleSize` to 50
- Use `signalLimit` to analyze fewer signals
- Wait 15 minutes and retry

**Signs of rate limiting:**
- HTTP 429 errors
- Empty responses
- Sudden failures mid-analysis

## Roadmap

### ✅ Phase 1: Heuristic Analysis (Current)
- Analyze recent follows
- Find overlaps
- Basic discovery

### 🚧 Phase 2: Snapshot Storage (Next)
- Database schema for snapshots
- Daily capture job
- True time-based queries

### 🔮 Phase 3: Advanced Analytics (Future)
- Trend analysis (velocity, momentum)
- Network graphs (who follows whom)
- Predictive signals (likely to blow up)
- Automated recommendations

## Examples

### Example 1: Quick Discovery

```json
{
  "minOverlap": 2,
  "sampleSize": 50,
  "signalLimit": 10
}
```

Result: 5-10 emerging profiles in ~15 seconds

### Example 2: Full Network Scan

```json
{
  "minOverlap": 3,
  "sampleSize": 100
}
```

Result: 10-20 high-confidence profiles in ~2 minutes

### Example 3: Deep Dive

```json
{
  "minOverlap": 2,
  "sampleSize": 200
}
```

Result: 30-50 profiles in ~5 minutes (comprehensive)

## Troubleshooting

**"No signals with Twitter usernames found"**
- Check that signals have `twitterUsername` or `metadata.twitter` set
- Verify signals exist in the database

**"Failed to get Twitter cookies"**
- Log in to x.com in Safari, Chrome, or Firefox
- Make sure you're logged in to the right account
- Try different browsers (Safari → Chrome → Firefox)

**"Rate limiting detected"**
- Increase `delayMs` to 2000+
- Reduce `sampleSize` to 50
- Use `signalLimit` to analyze fewer signals
- Wait 15 minutes

**"Empty results / no overlaps"**
- Lower `minOverlap` to 2
- Increase `sampleSize` to 100-200
- Check if signals actually follow overlapping people

## Contributing

To extend this feature:

1. **Add snapshot storage** (Phase 2)
   - Create migration: `migrations/XXX_add_follow_snapshots.sql`
   - Add capture job: `src/jobs/capture-follows.ts`
   - Update tool to use historical data

2. **Add UI/visualization**
   - Network graph of follows
   - Trend charts
   - Dashboard widget

3. **Improve heuristics**
   - Exclude mega-influencers automatically
   - Weight by recency (position in list)
   - Filter by account age, activity

## Questions?

See:
- `/tmp/network-analysis-plan.md` - Full implementation plan
- `src/tools/twitter-network.ts` - Tool implementation
- `test-network-analysis.js` - Standalone test script
- `prompts/network-analysis.md` - Pi prompt template
