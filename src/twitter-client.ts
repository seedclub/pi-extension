/**
 * Singleton wrapper for the bird TwitterClient.
 * Provides lazy initialization with credential resolution from browser cookies.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  TwitterClient,
  resolveCredentials,
  type TwitterCookies,
  type CookieSource,
} from "@connormartin/bird";

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

let cachedClient: TwitterClient | null = null;
let cachedCookies: TwitterCookies | null = null;

export function clearTwitterClient(): void {
  cachedClient = null;
  cachedCookies = null;
}

async function resolveTwitterCredentials(): Promise<{
  cookies: TwitterCookies;
  warnings: string[];
}> {
  const allWarnings: string[] = [];
  const firefoxProfile = process.env.FIREFOX_PROFILE;

  const safariResult = await resolveCredentials({ cookieSource: ["safari"] as CookieSource[] });
  allWarnings.push(...safariResult.warnings);
  if (safariResult.cookies.authToken && safariResult.cookies.ct0) {
    return { cookies: safariResult.cookies, warnings: allWarnings };
  }

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

export async function getTwitterClient(): Promise<TwitterClient> {
  if (cachedClient) return cachedClient;

  const { cookies, warnings } = await resolveTwitterCredentials();
  if (!cookies.authToken || !cookies.ct0) {
    const error = new TwitterClientError(
      "Twitter credentials not found. Please log in to x.com in Safari, Chrome, or Firefox.",
      "NO_CREDENTIALS"
    );
    throw error;
  }

  cachedCookies = cookies;
  cachedClient = new TwitterClient({ cookies });
  return cachedClient;
}

export async function checkTwitterCredentials(): Promise<CredentialCheckResult> {
  const { cookies, warnings } = await resolveTwitterCredentials();

  if (!cookies.authToken || !cookies.ct0) {
    return {
      valid: false,
      warnings: [...warnings, "No valid Twitter credentials found. Please log in to x.com in Safari, Chrome, or Firefox."],
    };
  }

  try {
    const client = new TwitterClient({ cookies });
    const result = await client.getCurrentUser();

    if (!result.success || !result.user) {
      return { valid: false, source: cookies.source ?? undefined, warnings: [...warnings, result.error ?? "Failed to verify credentials"] };
    }

    cachedCookies = cookies;
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
