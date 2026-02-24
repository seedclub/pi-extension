# Import Twitter/X Bookmarks

Import your Twitter/X bookmarks as signals or research in Seed Network.

## Workflow

1. **Verify Twitter credentials**: Use `twitter_bookmarks` with a small count to confirm you're connected
2. **Sync bookmarks**: Use `twitter_bookmarks_sync` to fetch and cache bookmarks in the database
3. **Review cached bookmarks**: Use `twitter_bookmarks_list` to browse what was synced
4. **Review with user**: Present the bookmarks and ask which ones to import
5. **Create signals**: For accounts worth tracking, use `batch_create_signals` with type `twitter_account`
6. **Save research**: For tweets with useful information, use `save_research` to capture the content
7. **Check for duplicates**: Use `list_signals` to avoid creating duplicate signals

Ask the user how they want to categorize their bookmarks and what tags to apply.
