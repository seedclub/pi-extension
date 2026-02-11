# Telegram Monitor

Scan recent Telegram activity for deal-relevant signals.

1. Use `telegram_unread` to find active chats
2. Read recent messages from deal-related groups using `telegram_read`
3. Look for:
   - Companies or founders being discussed
   - Fundraising mentions or deal flow
   - Intro requests
   - Market or category signals
   - Hiring activity at portfolio companies
4. For anything interesting, check if a signal already exists in Seed Network using `search_signals`
5. Create signal events for noteworthy activity using `create_event`
6. Summarize findings with links to source messages
