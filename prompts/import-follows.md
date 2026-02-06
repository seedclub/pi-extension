# Import Twitter/X Following

Import your Twitter/X following list as signals in Seed Network.

## Workflow

1. **Verify Twitter credentials**: Use `twitter_check` to confirm you're logged in
2. **Fetch following list**: Use `twitter_following` to get accounts you follow
3. **Check existing signals**: Use `list_signals` with type `twitter_account` to see what's already tracked
4. **Filter and categorize**: Present the list and ask the user which accounts to import and how to tag them
5. **Create signals**: Use `batch_create_signals` to create signals for selected accounts with appropriate tags and metadata

Suggest categorization by industry, relevance (founder, investor, journalist, etc.), or custom tags.
