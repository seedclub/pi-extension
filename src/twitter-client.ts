/**
 * Twitter/X client for the pi extension.
 *
 * Uses bird as a library (not CLI) for direct GraphQL API access.
 * Credentials are resolved in priority order:
 *   1. Cached in-memory singleton (fastest, per pi session)
 *   2. Stored session file (~/.config/seed-network/twitter/session.json)
 *   3. Browser cookie extraction via bird's resolveCredentials (Safari → Chrome → Firefox)
 *   4. Manual entry via /twitter-login
 *
 * Modeled after the Telegram client pattern with persistent session storage.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { readFile, writeFile, mkdir, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import {
  TwitterClient,
  resolveCredentials,
  type TwitterCookies,
  type CookieSource,
} from "@connormartin/bird";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".config", "seed-network", "twitter");
export const SESSION_PATH = join(CONFIG_DIR, "session.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TwitterSession {
  authToken: string;
  ct0: string;
  username: string;        // verified @handle
  name: string;            // display name
  userId: string;          // numeric Twitter user ID
  source: string;          // how credentials were obtained ("Safari", "manual", etc.)
  authenticatedAt: string; // ISO 8601
}

export class TwitterNotConnectedError extends Error {
  constructor() {
    super("Twitter credentials not found. Run /twitter-login or log in to x.com in your browser.");
    this.name = "TwitterNotConnectedError";
  }
}

export class TwitterClientError extends Error {
  constructor(message: string, public code: "NO_CREDENTIALS" | "API_ERROR") {
    super(message);
    this.name = "TwitterClientError";
  }
}

export interface CredentialCheckResult {
  valid: boolean;
  source?: string;
  warnings: string[];
  user?: { id: string; username: string; name: string };
}

// ---------------------------------------------------------------------------
// Singleton cache (per pi session)
// ---------------------------------------------------------------------------

let cachedClient: TwitterClient | null = null;
let cachedSession: TwitterSession | null = null;

export function clearTwitterClient(): void {
  cachedClient = null;
  cachedSession = null;
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

export function twitterSessionExists(): boolean {
  return existsSync(SESSION_PATH);
}

export async function loadTwitterSession(): Promise<TwitterSession | null> {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const content = await readFile(SESSION_PATH, "utf-8");
    const data = JSON.parse(content);
    if (!data.authToken || !data.ct0 || !data.username) return null;
    return data as TwitterSession;
  } catch {
    return null;
  }
}

export async function storeTwitterSession(session: TwitterSession): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(SESSION_PATH, JSON.stringify(session, null, 2), { mode: 0o600 });
  try { await chmod(SESSION_PATH, 0o600); } catch {}
  // Update in-memory cache
  cachedSession = session;
  cachedClient = null; // Force re-creation with new cookies
}

export async function clearTwitterSession(): Promise<boolean> {
  clearTwitterClient();
  try { await unlink(SESSION_PATH); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Chrome multi-profile detection (macOS)
// ---------------------------------------------------------------------------

function detectChromeProfiles(): string[] {
  if (process.platform !== "darwin") return [];

  const chromeDirs = [
    join(process.env.HOME || "", "Library/Application Support/Google/Chrome"),
    join(process.env.HOME || "", "Library/Application Support/BraveSoftware/Brave-Browser"),
  ];

  const profiles: { name: string; mtimeMs: number }[] = [];

  for (const chromeDir of chromeDirs) {
    if (!existsSync(chromeDir)) continue;
    try {
      const defaultCookies = join(chromeDir, "Default", "Cookies");
      if (existsSync(defaultCookies)) {
        profiles.push({ name: "Default", mtimeMs: statSync(defaultCookies).mtimeMs });
      }
      const entries = readdirSync(chromeDir);
      for (const name of entries) {
        if (!name.startsWith("Profile ")) continue;
        const cookiesPath = join(chromeDir, name, "Cookies");
        if (existsSync(cookiesPath)) {
          profiles.push({ name, mtimeMs: statSync(cookiesPath).mtimeMs });
        }
      }
    } catch {}
  }

  profiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return profiles.map((p) => p.name);
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

/**
 * Resolve Twitter credentials from all available sources.
 * Priority: env vars → Safari → Chrome (multi-profile) → Firefox.
 */
async function resolveTwitterCredentials(): Promise<{
  cookies: TwitterCookies;
  warnings: string[];
}> {
  const allWarnings: string[] = [];
  const firefoxProfile = process.env.FIREFOX_PROFILE;

  // Try Safari first
  const safariResult = await resolveCredentials({ cookieSource: ["safari"] as CookieSource[] });
  allWarnings.push(...safariResult.warnings);
  if (safariResult.cookies.authToken && safariResult.cookies.ct0) {
    return { cookies: safariResult.cookies, warnings: allWarnings };
  }

  // Try Chrome with multi-profile support
  const explicitChromeProfile = process.env.CHROME_PROFILE;
  if (explicitChromeProfile) {
    const chromeResult = await resolveCredentials({
      cookieSource: ["chrome"] as CookieSource[],
      chromeProfile: explicitChromeProfile,
    });
    allWarnings.push(...chromeResult.warnings);
    if (chromeResult.cookies.authToken && chromeResult.cookies.ct0) {
      return { cookies: chromeResult.cookies, warnings: allWarnings };
    }
  } else {
    const profiles = detectChromeProfiles();
    for (const profile of profiles) {
      const chromeResult = await resolveCredentials({
        cookieSource: ["chrome"] as CookieSource[],
        chromeProfile: profile,
      });
      if (chromeResult.cookies.authToken && chromeResult.cookies.ct0) {
        return { cookies: chromeResult.cookies, warnings: allWarnings };
      }
    }
    if (profiles.length === 0) {
      allWarnings.push("No Chrome profiles found.");
    } else {
      allWarnings.push(`Tried ${profiles.length} Chrome profile(s), none had Twitter cookies.`);
    }
  }

  // Try Firefox
  const firefoxResult = await resolveCredentials({
    cookieSource: ["firefox"] as CookieSource[],
    firefoxProfile,
  });
  allWarnings.push(...firefoxResult.warnings);
  if (firefoxResult.cookies.authToken && firefoxResult.cookies.ct0) {
    return { cookies: firefoxResult.cookies, warnings: allWarnings };
  }

  return { cookies: firefoxResult.cookies, warnings: allWarnings };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a TwitterClient, resolving credentials in priority order:
 * 1. In-memory cache (same pi session)
 * 2. Stored session file
 * 3. Browser cookie extraction
 *
 * On success via browser extraction, credentials are persisted to the session file
 * so subsequent pi sessions don't need to re-extract.
 */
export async function getTwitterClient(): Promise<TwitterClient> {
  if (cachedClient) return cachedClient;

  // Try stored session first
  const stored = cachedSession || await loadTwitterSession();
  if (stored) {
    const cookies: TwitterCookies = {
      authToken: stored.authToken,
      ct0: stored.ct0,
      cookieHeader: `auth_token=${stored.authToken}; ct0=${stored.ct0}`,
      source: stored.source,
    };
    cachedClient = new TwitterClient({ cookies });
    cachedSession = stored;
    return cachedClient;
  }

  // Try browser extraction
  const { cookies, warnings } = await resolveTwitterCredentials();
  if (!cookies.authToken || !cookies.ct0) {
    throw new TwitterNotConnectedError();
  }

  // Create client and verify it works
  const client = new TwitterClient({ cookies });

  // Persist the extracted credentials so we don't need to re-extract next session
  try {
    const userResult = await client.getCurrentUser();
    if (userResult.success && userResult.user) {
      const session: TwitterSession = {
        authToken: cookies.authToken,
        ct0: cookies.ct0,
        username: userResult.user.username,
        name: userResult.user.name,
        userId: userResult.user.id,
        source: cookies.source || "browser",
        authenticatedAt: new Date().toISOString(),
      };
      await storeTwitterSession(session);
    }
  } catch {
    // Verification failed but cookies might still work for some endpoints — don't block
  }

  cachedClient = client;
  return client;
}

/**
 * Check Twitter credentials without caching.
 * Used by /twitter-login and twitter_check to verify connectivity.
 */
export async function checkTwitterCredentials(): Promise<CredentialCheckResult> {
  // If we already have a cached client, verify it still works
  if (cachedClient && cachedSession) {
    try {
      const result = await cachedClient.getCurrentUser();
      if (result.success && result.user) {
        return { valid: true, source: cachedSession.source, warnings: [], user: result.user };
      }
    } catch {}
    // Cached client failed — clear and try fresh
    clearTwitterClient();
  }

  // Try stored session
  const stored = await loadTwitterSession();
  if (stored) {
    try {
      const cookies: TwitterCookies = {
        authToken: stored.authToken,
        ct0: stored.ct0,
        cookieHeader: `auth_token=${stored.authToken}; ct0=${stored.ct0}`,
        source: stored.source,
      };
      const client = new TwitterClient({ cookies });
      const result = await client.getCurrentUser();
      if (result.success && result.user) {
        cachedClient = client;
        cachedSession = stored;
        return { valid: true, source: stored.source, warnings: [], user: result.user };
      }
    } catch {}
  }

  // Try browser extraction
  const { cookies, warnings } = await resolveTwitterCredentials();
  if (!cookies.authToken || !cookies.ct0) {
    return {
      valid: false,
      warnings: [...warnings, "No valid Twitter credentials found. Log in to x.com in your browser or run /twitter-login."],
    };
  }

  try {
    const client = new TwitterClient({ cookies });
    const result = await client.getCurrentUser();
    if (!result.success || !result.user) {
      return { valid: false, source: cookies.source ?? undefined, warnings: [...warnings, result.error ?? "Failed to verify credentials"] };
    }

    // Persist for next time
    const session: TwitterSession = {
      authToken: cookies.authToken,
      ct0: cookies.ct0,
      username: result.user.username,
      name: result.user.name,
      userId: result.user.id,
      source: cookies.source || "browser",
      authenticatedAt: new Date().toISOString(),
    };
    await storeTwitterSession(session);
    cachedClient = client;

    return { valid: true, source: cookies.source ?? undefined, warnings, user: result.user };
  } catch (error) {
    return {
      valid: false,
      source: cookies.source ?? undefined,
      warnings: [...warnings, `Credential verification failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * Verify manually-entered credentials. Returns user info or null.
 */
export async function verifyManualCredentials(
  authToken: string,
  ct0: string,
): Promise<{ username: string; name: string; userId: string } | null> {
  try {
    const cookies: TwitterCookies = {
      authToken,
      ct0,
      cookieHeader: `auth_token=${authToken}; ct0=${ct0}`,
      source: "manual",
    };
    const client = new TwitterClient({ cookies });
    const result = await client.getCurrentUser();
    if (!result.success || !result.user) return null;
    return { username: result.user.username, name: result.user.name, userId: result.user.id };
  } catch {
    return null;
  }
}
