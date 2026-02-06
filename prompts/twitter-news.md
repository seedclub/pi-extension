# Twitter/X Trending News

Get trending news and topics from Twitter/X Explore page.

## Workflow

1. **Verify credentials**: Use `twitter_check` first
2. **Fetch news**: Use `twitter_news` to get trending topics. Use `withTweets: true` for richer context
3. **Present findings**: Summarize the top trending items with relevant tweets
4. **Save notable items**: If the user wants to track anything, use `save_research` to capture it as research

You can filter by tab: `forYou`, `news`, `sports`, `entertainment`.
