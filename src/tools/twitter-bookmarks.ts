/**
 * Twitter Bookmarks tool — fetches bookmarks via bird CLI and syncs to Seed Network DB.
 *
 * Uses the bird CLI (reverse-engineered X/Twitter GraphQL API) so there's no API cost.
 * Bookmarks are cached in the DB to avoid re-querying Twitter on every request.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { api, ApiError, NotConnectedError } from "../api-client";
import { getBirdAuthFlags, TwitterNotConnectedError } from "../twitter-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BirdTweet {
  id: string;
  text: string;
  author: { username: string; name: string };
  authorId?: string;
  createdAt?: string;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
  conversationId?: string;
  inReplyToStatusId?: string;
  quotedTweet?: BirdTweet;
  media?: Array<{ type: string; url: string; altText?: string }>;
}

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

/** Convert a bird TweetData object into our sync payload shape. */
function tweetToPayload(tweet: BirdTweet): SyncPayload {
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
    media: tweet.media?.map((m) => ({ type: m.type, url: m.url, altText: m.altText })),
    quotedTweetId: tweet.quotedTweet?.id,
    tweetCreatedAt: tweet.createdAt,
  };
}

/** Run bird CLI and parse JSON output. Uses stored session credentials. */
async function runBird(
  exec: (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<{ code: number; stdout: string; stderr: string }>,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ tweets: BirdTweet[]; nextCursor?: string }> {
  // Get auth flags from stored session
  const authFlags = await getBirdAuthFlags();
  const result = await exec("bird", [...authFlags, ...args, "--json", "--plain"], { timeout: timeoutMs });

  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    if (stderr.includes("Missing required credentials") || stderr.includes("Missing auth_token")) {
      throw new TwitterNotConnectedError();
    }
    throw new Error(`bird CLI failed (exit ${result.code}): ${stderr || result.stdout}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) return { tweets: [] };

  try {
    const parsed = JSON.parse(stdout);
    // bird outputs { tweets: [...], nextCursor?: string } or just an array
    if (Array.isArray(parsed)) {
      return { tweets: parsed };
    }
    return {
      tweets: parsed.tweets || [],
      nextCursor: parsed.nextCursor,
    };
  } catch {
    throw new Error(`Failed to parse bird output as JSON: ${stdout.slice(0, 200)}`);
  }
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
  let text = theme.fg("success", `✓ ${total} bookmarks`);
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
  const exec = (cmd: string, args: string[], opts?: { timeout?: number }) =>
    pi.exec(cmd, args, opts);

  // ─── Sync: fetch from Twitter → store in DB ────────────────────────

  pi.registerTool({
    name: "twitter_bookmarks_sync",
    label: "Sync Twitter Bookmarks",
    description:
      "Fetch bookmarks from Twitter/X via the bird CLI and sync them to the Seed Network database. " +
      "Uses browser cookies (no API key needed). Run this to populate or refresh your cached bookmarks.",
    parameters: Type.Object({
      count: Type.Optional(Type.Number({
        description: "Number of bookmarks to fetch (default: 50). Ignored if 'all' is true.",
        minimum: 1,
        maximum: 1000,
      })),
      all: Type.Optional(Type.Boolean({
        description: "Fetch ALL bookmarks (paginated). May take a while if you have many.",
      })),
      folderId: Type.Optional(Type.String({
        description: "Bookmark folder/collection ID or URL to sync a specific folder.",
      })),
    }),
    renderer: {
      renderCall: renderSyncCall,
      renderResult: renderSyncResult,
    },
    execute: async (_toolCallId, params, _signal) => {
      try {
        // Build bird CLI args
        const args: string[] = ["bookmarks"];
        if (params.all) {
          args.push("--all");
        } else {
          args.push("--count", String(params.count || 50));
        }
        if (params.folderId) {
          args.push("--folder-id", params.folderId);
        }

        // Fetch from Twitter
        const timeoutMs = params.all ? 300_000 : 60_000;
        const { tweets } = await runBird(exec, args, timeoutMs);

        if (tweets.length === 0) {
          return {
            content: [{ type: "text", text: "No bookmarks found on Twitter." }],
            details: { fetched: 0, synced: 0 },
          };
        }

        // Transform and sync to DB
        const payloads = tweets.map(tweetToPayload);
        const syncResult = await syncToApi(payloads);

        const summary = {
          fetched: tweets.length,
          synced: syncResult.synced,
          sample: payloads.slice(0, 10),
        };

        return {
          content: [{
            type: "text",
            text: `Fetched ${tweets.length} bookmarks from Twitter and synced ${syncResult.synced} to the database.`,
          }],
          details: summary,
        };
      } catch (error) {
        if (error instanceof TwitterNotConnectedError) {
          return {
            content: [{ type: "text", text: "Not connected to Twitter/X. Run /twitter-login to authenticate." }],
            details: { error: "Not connected to Twitter", code: "TWITTER_NOT_CONNECTED" },
            isError: true,
          };
        }
        if (error instanceof NotConnectedError) {
          return {
            content: [{ type: "text", text: "Not connected to Seed Network. Run /seed-connect to authenticate." }],
            details: { error: "Not connected", code: "NOT_CONNECTED" },
            isError: true,
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });

  // ─── List: read cached bookmarks from DB ───────────────────────────

  pi.registerTool({
    name: "twitter_bookmarks_list",
    label: "List Twitter Bookmarks",
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
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
          details: result,
        };
      } catch (error) {
        if (error instanceof NotConnectedError) {
          return {
            content: [{ type: "text", text: "Not connected to Seed Network. Run /seed-connect to authenticate." }],
            details: { error: "Not connected", code: "NOT_CONNECTED" },
            isError: true,
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });
}
