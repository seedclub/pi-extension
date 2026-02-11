---
name: network-analysis
description: Discover who's getting attention from your network by analyzing Twitter follows
---

# Network Following Analysis

You are analyzing Twitter following patterns to discover the TOP profiles most-followed by Seed Network signals.

## Your Task

1. **Call the analysis tool:**
   - Use `analyze_network_follows` with `useSampleNetwork: true` to scan the sample network (~95 signals from `src/sample-network.js`)
   - **Default parameters:** Scan 20 recent follows per signal, return TOP 10 most-followed
   - **Example:** 95 signals × 20 follows = ~1,900 profiles scanned → Top 10 returned
   - This uses curated Seed Network members instead of live API data

2. **Interpret the results:**
   - **Top Profiles**: Ranked by "overlap count" (how many signals follow them)
   - Higher overlap = more network attention = potentially interesting
   - Look for:
     - Builders/founders in relevant spaces (crypto, AI, communities)
     - High-quality profiles with interesting work
     - People outside existing network (new discovery opportunities)
     - Recently active accounts (not dormant)

3. **Present findings clearly:**
   ```
   🔍 Network Following Analysis - Top 10 Most-Followed Profiles
   
   1. @username — Name
      📊 Followed by 8 signals: @signal1, @signal2, @signal3, ...
      👥 12,500 followers
      💬 Building XYZ...
      🔗 https://x.com/username
   
   2. @another — Another Name
      📊 Followed by 6 signals: @signalA, @signalB, ...
      👥 5,234 followers
      💬 Founder of ABC...
      🔗 https://x.com/another
   
   ...
   
   📊 Stats:
   - Scanned: 95 sample network signals
   - Profiles analyzed: ~1,900
   - Unique profiles: ~1,200
   - Top 10 returned
   - Processing time: 2.5m
   ```

4. **Provide actionable recommendations:**
   - Highlight top 3-5 profiles worth investigating
   - Explain WHY they're interesting:
     - What they're building
     - Why multiple signals follow them
     - Potential fit with network
   - Suggest next actions:
     - "Add as signal" if very relevant
     - "Research further" to learn more
     - "Reach out" if high-priority

## Parameters

**Default Configuration:**
```json
{
  "useSampleNetwork": true,
  "topN": 10,
  "sampleSize": 20
}
```

This uses the curated Seed Network signals from `src/sample-network.js` (~95 members). Scans ~20 recent follows per signal and returns top 10 most-followed profiles.

## Important Notes

- This analyzes **recent** follows (not exact "last week" - Twitter API limitation)
- Results show who signals are **currently** following (top of their following list)
- Assumes recent follows appear first in Twitter's API response
- For true time-based analysis ("followed in last 7 days"), need Phase 2 (historical snapshots)

## How to Use

Simply call `analyze_network_follows` with the default configuration to discover who's getting the most attention from the Seed Network. The tool will scan ~95 curated signals, analyze ~1,900 profiles, and return the top 10 most-followed.

## Output Interpretation

**Good signals (worth investigating):**
- ✅ Followed by 3+ network signals
- ✅ Relevant bio (building, founding, creating)
- ✅ Reasonable followers (1K-50K sweet spot)
- ✅ Recent tweets (active on platform)

Be concise but insightful. Focus on actionable findings that help discover emerging builders and founders.
