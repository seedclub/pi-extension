# Telegram Search

The user wants to find something in their Telegram messages.

Use `telegram_search` with their query. If results are sparse, try alternative phrasings or search specific chats with the `chat` parameter.

Present results grouped by chat, with enough context to understand each message. If a message is part of a conversation, use `telegram_read` with `offsetId` to fetch surrounding messages for context.
