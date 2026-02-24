/**
 * Twitter Bookmarks tools — fetches bookmarks via bird library and syncs to Seed Network DB.
 *
 * Uses bird as a library (reverse-engineered X/Twitter GraphQL API) — no API cost.
 * Bookmarks are cached in the DB to avoid re-querying Twitter on every request.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { api, NotConnectedError } from "../api-client";
import { getTwitterClient, TwitterNotConnectedError, TwitterClientError } from "../twitter-client";
import { wrapExecute } from "../tool-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncPayload {
  tweetId: string;
  conversationId?: string;
  authorUsername: string;
  authorName: string;
  authorId?: string;
  tweetText: string;
  tweetUrl: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  media?: Array<{ type: string; url: string; altText?: string }>;
  quotedTweetId?: string;
  tweetCreatedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTweet(tweet: any): any {
  return {
    id: tweet.id,
    text: tweet.text,
    author: tweet.author,
    authorId: tweet.authorId,
    createdAt: tweet.createdAt,
    replyCount: tweet.replyCount,
    retweetCount: tweet.retweetCount,
    likeCount: tweet.likeCount,
    url: `https://x.com/${tweet.author.username}/status/${tweet.id}`,
    conversationId: tweet.conversationId,
    inReplyToStatusId: tweet.inReplyToStatusId,
    quotedTweet: tweet.quotedTweet ? formatTweet(tweet.quotedTweet) : undefined,
    media: tweet.media,
  };
}

/** Convert a tweet into our API sync payload. */
function tweetToPayload(tweet: any): SyncPayload {
  return {
    tweetId: tweet.id,
    conversationId: tweet.conversationId,
    authorUsername: tweet.author.username,
    authorName: tweet.author.name,
    authorId: tweet.authorId,
    tweetText: tweet.text,
    tweetUrl: `https://x.com/${tweet.author.username}/status/${tweet.id}`,
    likeCount: tweet.likeCount,
    retweetCount: tweet.retweetCount,
    replyCount: tweet.replyCount,
    media: tweet.media?.map((m: any) => ({ type: m.type, url: m.url, altText: m.altText })),
    quotedTweetId: tweet.quotedTweet?.id,
    tweetCreatedAt: tweet.createdAt,
  };
}

/** Sync bookmarks to the Seed Network API in batches of 200. */
async function syncToApi(bookmarks: SyncPayload[]): Promise<{ synced: number }> {
  let totalSynced = 0;
  const batchSize = 200;

  for (let i = 0; i < bookmarks.length; i += batchSize) {
    const batch = bookmarks.slice(i, i + batchSize);
    const result = await api.post<{ synced: number }>("/bookmarks", { bookmarks: batch });
    totalSynced += result.synced;
  }

  return { synced: totalSynced };
}

function noCredentialsError() {
  return {
    error: "Twitter credentials not found",
    instructions: [
      "Run /twitter-login to connect your account",
      "Or log in to x.com in Safari, Chrome, or Firefox",
    ],
  };
}

function apiError(error: unknown) {
  return { error: error instanceof Error ? error.message : String(error) };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function fetchBookmarks(args: { count?: number; all?: boolean; cursor?: string }) {
  try {
    const client = await getTwitterClient();

    if (args.all) {
      const result = await client.getAllBookmarks({ cursor: args.cursor });
      if (!result.success) return { error: result.error ?? "Failed to get bookmarks" };
      return {
        tweets: (result.tweets ?? []).map(formatTweet),
        count: result.tweets?.length ?? 0,
        nextCursor: result.nextCursor,
      };
    }

    const result = await client.getBookmarks(args.count ?? 20);
    if (!result.success) return { error: result.error ?? "Failed to get bookmarks" };
    return {
      tweets: (result.tweets ?? []).map(formatTweet),
      count: result.tweets?.length ?? 0,
      nextCursor: result.nextCursor,
    };
  } catch (error) {
    if (error instanceof TwitterNotConnectedError || (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS")) {
      return noCredentialsError();
    }
    return apiError(error);
  }
}

async function syncBookmarks(args: { count?: number; all?: boolean }) {
  // Step 1: Fetch from Twitter
  const client = await getTwitterClient();

  let tweets: any[];
  if (args.all) {
    const result = await client.getAllBookmarks({});
    if (!result.success) throw new Error(result.error ?? "Failed to get bookmarks");
    tweets = result.tweets ?? [];
  } else {
    const result = await client.getBookmarks(args.count ?? 50);
    if (!result.success) throw new Error(result.error ?? "Failed to get bookmarks");
    tweets = result.tweets ?? [];
  }

  if (tweets.length === 0) {
    return { fetched: 0, synced: 0, message: "No bookmarks found on Twitter." };
  }

  // Step 2: Sync to DB
  const payloads = tweets.map(tweetToPayload);
  const syncResult = await syncToApi(payloads);

  return {
    fetched: tweets.length,
    synced: syncResult.synced,
    sample: payloads.slice(0, 10),
    message: `Fetched ${tweets.length} bookmarks from Twitter and synced ${syncResult.synced} to the database.`,
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderSyncCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("twitter_bookmarks_sync"));
  if (args.count) text += theme.fg("dim", ` (count: ${args.count})`);
  if (args.all) text += theme.fg("dim", " --all");
  return new Text(text, 0, 0);
}

function renderSyncResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) {
    return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
  }
  let text = theme.fg("success", `✓ Synced ${details?.synced ?? 0} bookmarks`);
  if (details?.fetched !== undefined) {
    text += theme.fg("dim", ` (${details.fetched} fetched from Twitter)`);
  }
  if (expanded && details?.sample) {
    for (const bm of details.sample.slice(0, 5)) {
      text += "\n  " + theme.fg("accent", `@${bm.authorUsername}`) + theme.fg("dim", ": ") + bm.tweetText.slice(0, 100);
    }
    if (details.sample.length > 5) {
      text += theme.fg("dim", `\n  +${details.sample.length - 5} more`);
    }
  }
  return new Text(text, 0, 0);
}

function renderFetchCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("twitter_bookmarks"));
  if (args.count) text += theme.fg("dim", ` (count: ${args.count})`);
  if (args.all) text += theme.fg("dim", " --all");
  return new Text(text, 0, 0);
}

function renderFetchResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) {
    return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
  }
  const tweets = details?.tweets || [];
  let text = theme.fg("success", `✓ ${tweets.length} bookmarks`);
  if (expanded) {
    for (const t of tweets.slice(0, 8)) {
      const date = t.createdAt
        ? new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
      text += "\n  " + theme.fg("accent", `@${t.author?.username}`) + theme.fg("dim", ` ${date}`) + "\n    " + (t.text || "").slice(0, 120);
    }
    if (tweets.length > 8) text += theme.fg("dim", `\n  +${tweets.length - 8} more`);
  } else if (tweets.length > 0) {
    const preview = tweets.slice(0, 3).map((t: any) => `@${t.author?.username}`).join(", ");
    text += theme.fg("dim", ` — ${preview}${tweets.length > 3 ? ` +${tweets.length - 3} more` : ""}`);
  }
  return new Text(text, 0, 0);
}

function renderListCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("twitter_bookmarks_list"));
  if (args.author) text += " " + theme.fg("accent", `@${args.author}`);
  if (args.limit) text += theme.fg("dim", ` (limit: ${args.limit})`);
  return new Text(text, 0, 0);
}

function renderListResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) {
    return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
  }
  const bookmarks = details?.bookmarks || [];
  const total = details?.total ?? bookmarks.length;
  let text = theme.fg("success", `✓ ${total} bookmarks cached`);
  if (expanded) {
    for (const bm of bookmarks.slice(0, 10)) {
      const date = bm.tweetCreatedAt
        ? new Date(bm.tweetCreatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
      text += "\n  " + theme.fg("accent", `@${bm.authorUsername}`) + theme.fg("dim", ` ${date}`) + "\n    " + (bm.tweetText || "").slice(0, 120);
    }
    if (bookmarks.length > 10) text += theme.fg("dim", `\n  +${bookmarks.length - 10} more`);
  } else if (bookmarks.length > 0) {
    const preview = bookmarks.slice(0, 3).map((b: any) => `@${b.authorUsername}`).join(", ");
    text += theme.fg("dim", ` — ${preview}${bookmarks.length > 3 ? ` +${bookmarks.length - 3} more` : ""}`);
  }
  return new Text(text, 0, 0);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTwitterBookmarkTools(pi: ExtensionAPI) {

  // ─── Fetch: get bookmarks directly from Twitter ────────────────────

  pi.registerTool({
    name: "twitter_bookmarks",
    label: "Twitter Bookmarks",
    description:
      "Get the authenticated user's bookmarked tweets from Twitter/X. " +
      "Returns tweets directly from Twitter without caching. " +
      "Use twitter_bookmarks_sync to persist bookmarks to the database.",
    parameters: Type.Object({
      count: Type.Optional(Type.Number({
        description: "Number of bookmarks to fetch (default: 20).",
      })),
      all: Type.Optional(Type.Boolean({
        description: "Fetch ALL bookmarks (paginated). May take a while.",
      })),
      cursor: Type.Optional(Type.String({
        description: "Pagination cursor from a previous request.",
      })),
    }),
    renderer: {
      renderCall: renderFetchCall,
      renderResult: renderFetchResult,
    },
    execute: wrapExecute(fetchBookmarks),
  });

  // ─── Sync: fetch from Twitter → store in DB ────────────────────────

  pi.registerTool({
    name: "twitter_bookmarks_sync",
    label: "Sync Twitter Bookmarks",
    description:
      "Fetch bookmarks from Twitter/X and sync them to the Seed Network database. " +
      "Run this to populate or refresh your cached bookmarks.",
    parameters: Type.Object({
      count: Type.Optional(Type.Number({
        description: "Number of bookmarks to fetch (default: 50). Ignored if 'all' is true.",
        minimum: 1,
        maximum: 1000,
      })),
      all: Type.Optional(Type.Boolean({
        description: "Fetch ALL bookmarks (paginated). May take a while if you have many.",
      })),
    }),
    renderer: {
      renderCall: renderSyncCall,
      renderResult: renderSyncResult,
    },
    execute: async (_toolCallId, params) => {
      try {
        const result = await syncBookmarks(params);
        return {
          content: [{ type: "text" as const, text: result.message }],
          details: result,
        };
      } catch (error) {
        if (error instanceof TwitterNotConnectedError || (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS")) {
          return {
            content: [{ type: "text" as const, text: "Not connected to Twitter/X. Run /twitter-login to authenticate." }],
            details: noCredentialsError(),
            isError: true,
          };
        }
        if (error instanceof NotConnectedError) {
          return {
            content: [{ type: "text" as const, text: "Not connected to Seed Network. Run /seed-connect to authenticate." }],
            details: { error: "Not connected", code: "NOT_CONNECTED" },
            isError: true,
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });

  // ─── List: read cached bookmarks from DB ───────────────────────────

  pi.registerTool({
    name: "twitter_bookmarks_list",
    label: "List Cached Bookmarks",
    description:
      "List cached Twitter bookmarks from the Seed Network database. " +
      "Use twitter_bookmarks_sync first to populate. Filter by author or paginate through results.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({
        description: "Max bookmarks to return (default: 50, max: 200).",
        minimum: 1,
        maximum: 200,
      })),
      offset: Type.Optional(Type.Number({
        description: "Pagination offset (default: 0).",
        minimum: 0,
      })),
      author: Type.Optional(Type.String({
        description: "Filter by author username (without @).",
      })),
    }),
    renderer: {
      renderCall: renderListCall,
      renderResult: renderListResult,
    },
    execute: async (_toolCallId, params) => {
      try {
        const queryParams: Record<string, string | number> = {};
        if (params.limit) queryParams.limit = params.limit;
        if (params.offset) queryParams.offset = params.offset;
        if (params.author) queryParams.author = params.author;

        const result = await api.get<{
          bookmarks: any[];
          total: number;
          limit: number;
          offset: number;
        }>("/bookmarks", queryParams);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        if (error instanceof NotConnectedError) {
          return {
            content: [{ type: "text" as const, text: "Not connected to Seed Network. Run /seed-connect to authenticate." }],
            details: { error: "Not connected", code: "NOT_CONNECTED" },
            isError: true,
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });
}
