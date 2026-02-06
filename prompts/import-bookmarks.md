# Import Twitter/X Bookmarks

Import your Twitter/X bookmarks as signals or research in Seed Network.

## Workflow

1. **Verify Twitter credentials**: Use `twitter_check` to confirm you're logged in
2. **Fetch bookmarks**: Use `twitter_bookmarks` to get your saved tweets
3. **Review with user**: Present the bookmarks and ask which ones to import
4. **Create signals**: For accounts worth tracking, use `batch_create_signals` with type `twitter_account`
5. **Save research**: For tweets with useful information, use `save_research` to capture the content
6. **Check for duplicates**: Use `list_signals` to avoid creating duplicate signals

Ask the user how they want to categorize their bookmarks and what tags to apply.
