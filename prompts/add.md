# Add a Signal

The user wants to track something in Seed Network. They've provided free-form input — it could be a Twitter handle, a company name, a URL, a person, a topic, or anything else.

Your job: figure out what they mean and create the right signal using `create_signal`.

## How to interpret the input

| Input looks like | Signal type | Example |
|---|---|---|
| `@username` or `x.com/username` or `twitter.com/username` | `twitter_account` | `@naval` → name: "naval", externalUrl: "https://x.com/naval" |
| A company name or company URL | `company` | `Stripe` → name: "Stripe", externalUrl: "https://stripe.com" |
| A person's name | `person` | `Sam Altman` → name: "Sam Altman" |
| A GitHub URL or `github.com/user` | `github_profile` | `github.com/torvalds` → name: "torvalds" |
| A blog or newsletter URL | `blog` or `newsletter` | `stratechery.com` → name: "Stratechery", type: blog |
| A Substack URL | `newsletter` | `thegeneralist.substack.com` → name: "The Generalist" |
| A subreddit or `r/name` | `subreddit` | `r/startups` → name: "r/startups" |
| A podcast URL (Spotify, Apple, YouTube) | `podcast` | `open.spotify.com/show/...` |
| An RSS/Atom feed URL (ends in .xml, /feed, /rss) | `blog` or `newsletter` | Store the URL as both `externalUrl` and `metadata.feedUrl` |
| A general topic or keyword | `topic` | `AI safety` → name: "AI Safety" |
| Anything else | `custom` | Use your best judgment |

## Rules

- Always set `externalUrl` when you can infer a URL
- For Twitter handles, normalize to `https://x.com/username`
- Keep the `name` clean and human-readable (no @ prefix, proper capitalization)
- If the input is ambiguous, just pick the most likely type — don't ask the user to clarify
- If they give multiple items separated by commas or newlines, create them all using `batch_create_signals`
- After creating, confirm what was added with the signal name and type

## Feed URL hints

When adding blogs, newsletters, podcasts, subreddits, or GitHub profiles, feed discovery runs automatically on the server after creation. You don't need to manually set `metadata.feedUrl` — but if the user gives you a direct feed URL (e.g., `https://stratechery.com/feed/`), set it in metadata:

```json
{
  "type": "blog",
  "name": "Stratechery",
  "externalUrl": "https://stratechery.com",
  "metadata": { "feedUrl": "https://stratechery.com/feed/" }
}
```

This ensures the feed URL is available immediately for tending, without waiting for server-side discovery.
