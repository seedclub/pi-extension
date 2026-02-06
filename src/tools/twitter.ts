import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { getTwitterClient, checkTwitterCredentials, TwitterClientError } from "../twitter-client";
import { wrapExecute } from "../tool-utils";

// --- Helpers ---

function noCredentialsError() {
  return {
    error: "Twitter credentials not found",
    instructions: ["Open x.com in Safari, Chrome, or Firefox", "Log in to your Twitter/X account", "Return here and retry"],
  };
}

function apiError(error: unknown) {
  return { error: error instanceof Error ? error.message : String(error) };
}

function formatUser(user: any) {
  return {
    id: user.id, username: user.username, name: user.name,
    description: user.description, followersCount: user.followersCount,
    followingCount: user.followingCount, isBlueVerified: user.isBlueVerified,
    profileImageUrl: user.profileImageUrl?.replace("_normal", "_400x400"),
    profileUrl: `https://x.com/${user.username}`,
  };
}

function formatTweet(tweet: any): any {
  return {
    id: tweet.id, text: tweet.text, author: tweet.author, authorId: tweet.authorId,
    createdAt: tweet.createdAt, replyCount: tweet.replyCount, retweetCount: tweet.retweetCount,
    likeCount: tweet.likeCount, url: `https://x.com/${tweet.author.username}/status/${tweet.id}`,
    conversationId: tweet.conversationId, inReplyToStatusId: tweet.inReplyToStatusId,
    quotedTweet: tweet.quotedTweet ? formatTweet(tweet.quotedTweet) : undefined,
    media: tweet.media,
  };
}

function formatNewsItem(item: any) {
  return {
    id: item.id, headline: item.headline, category: item.category,
    timeAgo: item.timeAgo, postCount: item.postCount, description: item.description,
    url: item.url, tweets: item.tweets?.map(formatTweet),
  };
}

// --- Handlers ---

async function twitterCheck() {
  try {
    const result = await checkTwitterCredentials();
    if (!result.valid) {
      return {
        authenticated: false, source: result.source, warnings: result.warnings,
        instructions: ["Open x.com in Safari, Chrome, or Firefox", "Log in to your Twitter/X account", "Return here and retry"],
      };
    }
    return { authenticated: true, source: result.source, user: result.user, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  } catch (error) { return apiError(error); }
}

async function twitterWhoami() {
  try {
    const client = await getTwitterClient();
    const result = await client.getCurrentUser();
    if (!result.success || !result.user) return { error: result.error ?? "Failed to get current user" };
    return { id: result.user.id, username: result.user.username, name: result.user.name, profileUrl: `https://x.com/${result.user.username}` };
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

async function twitterFollowing(args: { username?: string; userId?: string; count?: number; all?: boolean; cursor?: string }) {
  try {
    const client = await getTwitterClient();
    let targetUserId = args.userId;
    if (!targetUserId) {
      if (args.username) {
        const lookup = await client.getUserIdByUsername(args.username);
        if (!lookup.success || !lookup.userId) return { error: lookup.error ?? `User @${args.username} not found` };
        targetUserId = lookup.userId;
      } else {
        const current = await client.getCurrentUser();
        if (!current.success || !current.user) return { error: current.error ?? "Failed to get current user" };
        targetUserId = current.user.id;
      }
    }
    const allUsers: any[] = [];
    let cursor = args.cursor;
    const pageSize = args.count ?? (args.all ? 200 : 50);
    do {
      const result = await client.getFollowing(targetUserId, pageSize, cursor);
      if (!result.success) {
        if (allUsers.length > 0) return { users: allUsers.map(formatUser), count: allUsers.length, partial: true, error: result.error };
        return { error: result.error ?? "Failed to get following list" };
      }
      if (result.users) allUsers.push(...result.users);
      cursor = result.nextCursor;
      if (!args.all) return { users: allUsers.map(formatUser), count: allUsers.length, nextCursor: cursor };
    } while (cursor);
    return { users: allUsers.map(formatUser), count: allUsers.length };
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

async function twitterFollowers(args: { username?: string; userId?: string; count?: number; cursor?: string }) {
  try {
    const client = await getTwitterClient();
    let targetUserId = args.userId;
    if (!targetUserId) {
      if (args.username) {
        const lookup = await client.getUserIdByUsername(args.username);
        if (!lookup.success || !lookup.userId) return { error: lookup.error ?? `User @${args.username} not found` };
        targetUserId = lookup.userId;
      } else {
        const current = await client.getCurrentUser();
        if (!current.success || !current.user) return { error: current.error ?? "Failed to get current user" };
        targetUserId = current.user.id;
      }
    }
    const result = await client.getFollowers(targetUserId, args.count ?? 50, args.cursor);
    if (!result.success) return { error: result.error ?? "Failed to get followers list" };
    return { users: (result.users ?? []).map(formatUser), count: result.users?.length ?? 0, nextCursor: result.nextCursor };
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

async function twitterBookmarks(args: { count?: number; all?: boolean; cursor?: string }) {
  try {
    const client = await getTwitterClient();
    if (args.all) {
      const result = await client.getAllBookmarks({ cursor: args.cursor });
      if (!result.success) return { error: result.error ?? "Failed to get bookmarks" };
      return { tweets: (result.tweets ?? []).map(formatTweet), count: result.tweets?.length ?? 0, nextCursor: result.nextCursor };
    }
    const result = await client.getBookmarks(args.count ?? 20);
    if (!result.success) return { error: result.error ?? "Failed to get bookmarks" };
    return { tweets: (result.tweets ?? []).map(formatTweet), count: result.tweets?.length ?? 0, nextCursor: result.nextCursor };
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

async function twitterNews(args: { count?: number; tab?: string; tabs?: string[]; withTweets?: boolean }) {
  try {
    const client = await getTwitterClient();
    const validTabs = ["forYou", "news", "sports", "entertainment"];
    let tabs: any[] | undefined;
    if (args.tab && validTabs.includes(args.tab)) tabs = [args.tab];
    else if (args.tabs) tabs = args.tabs.filter((t) => validTabs.includes(t));
    const result = await client.getNews(args.count ?? 10, { tabs, withTweets: args.withTweets });
    if (!result.success) return { error: result.error ?? "Failed to get news" };
    return { items: result.items.map(formatNewsItem), count: result.items.length };
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

async function twitterSearch(args: { query: string; count?: number; cursor?: string }) {
  try {
    const client = await getTwitterClient();
    const result = await client.search(args.query, args.count ?? 20);
    if (!result.success) return { error: result.error ?? "Search failed" };
    return { tweets: (result.tweets ?? []).map(formatTweet), count: result.tweets?.length ?? 0, query: args.query, nextCursor: result.nextCursor };
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

async function twitterLikes(args: { count?: number; all?: boolean; cursor?: string }) {
  try {
    const client = await getTwitterClient();
    if (args.all) {
      const result = await client.getAllLikes({ cursor: args.cursor });
      if (!result.success) return { error: result.error ?? "Failed to get likes" };
      return { tweets: (result.tweets ?? []).map(formatTweet), count: result.tweets?.length ?? 0, nextCursor: result.nextCursor };
    }
    const result = await client.getLikes(args.count ?? 20);
    if (!result.success) return { error: result.error ?? "Failed to get likes" };
    return { tweets: (result.tweets ?? []).map(formatTweet), count: result.tweets?.length ?? 0, nextCursor: result.nextCursor };
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

async function twitterRead(args: { tweetId?: string; url?: string; includeReplies?: boolean; includeThread?: boolean }) {
  try {
    const client = await getTwitterClient();
    let tweetId = args.tweetId;
    if (!tweetId && args.url) {
      const match = args.url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
      if (match) tweetId = match[1];
      else return { error: "Invalid tweet URL format" };
    }
    if (!tweetId) return { error: "Either tweetId or url is required" };
    const result = await client.getTweet(tweetId);
    if (!result.success || !result.tweet) return { error: result.error ?? "Tweet not found" };
    const response: any = { tweet: formatTweet(result.tweet) };
    if (args.includeReplies) {
      const repliesResult = await client.getReplies(tweetId);
      if (repliesResult.success && repliesResult.tweets) response.replies = repliesResult.tweets.map(formatTweet);
    }
    if (args.includeThread) {
      const threadResult = await client.getThread(tweetId);
      if (threadResult.success && threadResult.tweets) response.thread = threadResult.tweets.map(formatTweet);
    }
    return response;
  } catch (error) {
    if (error instanceof TwitterClientError && error.code === "NO_CREDENTIALS") return noCredentialsError();
    return apiError(error);
  }
}

// --- Registration ---

export function registerTwitterTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "twitter_check",
    label: "Twitter Check",
    description: "Verify Twitter/X credentials and show the logged-in user. Reads cookies from Safari, Chrome, or Firefox.",
    parameters: Type.Object({}),
    execute: wrapExecute(twitterCheck),
  });

  pi.registerTool({
    name: "twitter_whoami",
    label: "Twitter Who Am I",
    description: "Get the current Twitter/X user's info (id, username, name).",
    parameters: Type.Object({}),
    execute: wrapExecute(twitterWhoami),
  });

  pi.registerTool({
    name: "twitter_following",
    label: "Twitter Following",
    description: "Get the list of accounts a user follows on Twitter/X. Defaults to the authenticated user.",
    parameters: Type.Object({
      username: Type.Optional(Type.String({ description: "Username to look up (without @). Defaults to current user." })),
      userId: Type.Optional(Type.String({ description: "User ID to look up (alternative to username)" })),
      count: Type.Optional(Type.Number({ description: "Number of users to fetch (default: 50)" })),
      all: Type.Optional(Type.Boolean({ description: "Fetch all following (paginate until complete)" })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from previous request" })),
    }),
    execute: wrapExecute(twitterFollowing),
  });

  pi.registerTool({
    name: "twitter_followers",
    label: "Twitter Followers",
    description: "Get the list of accounts that follow a user on Twitter/X. Defaults to the authenticated user.",
    parameters: Type.Object({
      username: Type.Optional(Type.String({ description: "Username to look up (without @)." })),
      userId: Type.Optional(Type.String({ description: "User ID to look up" })),
      count: Type.Optional(Type.Number({ description: "Number of users to fetch (default: 50)" })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor" })),
    }),
    execute: wrapExecute(twitterFollowers),
  });

  pi.registerTool({
    name: "twitter_bookmarks",
    label: "Twitter Bookmarks",
    description: "Get the authenticated user's bookmarked tweets on Twitter/X.",
    parameters: Type.Object({
      count: Type.Optional(Type.Number({ description: "Number of bookmarks to fetch (default: 20)" })),
      all: Type.Optional(Type.Boolean({ description: "Fetch all bookmarks (paginate until complete)" })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor" })),
    }),
    execute: wrapExecute(twitterBookmarks),
  });

  pi.registerTool({
    name: "twitter_news",
    label: "Twitter News",
    description: "Get trending news and topics from Twitter/X Explore page.",
    parameters: Type.Object({
      count: Type.Optional(Type.Number({ description: "Number of news items to fetch (default: 10)" })),
      tab: Type.Optional(StringEnum(["forYou", "news", "sports", "entertainment"] as const)),
      tabs: Type.Optional(Type.Array(Type.String(), { description: "Multiple tabs to fetch from" })),
      withTweets: Type.Optional(Type.Boolean({ description: "Include related tweets for each news item" })),
    }),
    execute: wrapExecute(twitterNews),
  });

  pi.registerTool({
    name: "twitter_search",
    label: "Twitter Search",
    description: "Search for tweets on Twitter/X by query.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ description: "Number of tweets to fetch (default: 20)" })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor" })),
    }),
    execute: wrapExecute(twitterSearch),
  });

  pi.registerTool({
    name: "twitter_likes",
    label: "Twitter Likes",
    description: "Get the authenticated user's liked tweets on Twitter/X.",
    parameters: Type.Object({
      count: Type.Optional(Type.Number({ description: "Number of likes to fetch (default: 20)" })),
      all: Type.Optional(Type.Boolean({ description: "Fetch all likes (paginate until complete)" })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor" })),
    }),
    execute: wrapExecute(twitterLikes),
  });

  pi.registerTool({
    name: "twitter_read",
    label: "Twitter Read",
    description: "Read a specific tweet by ID or URL. Optionally fetch replies or full thread.",
    parameters: Type.Object({
      tweetId: Type.Optional(Type.String({ description: "Tweet ID to read" })),
      url: Type.Optional(Type.String({ description: "Tweet URL (alternative to tweetId)" })),
      includeReplies: Type.Optional(Type.Boolean({ description: "Include replies to the tweet" })),
      includeThread: Type.Optional(Type.Boolean({ description: "Include the full conversation thread" })),
    }),
    execute: wrapExecute(twitterRead),
  });
}
