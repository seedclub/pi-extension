/**
 * Twitter/X client helpers for the pi extension.
 *
 * Handles session storage and credential resolution for the bird CLI.
 * Cookies are stored locally in ~/.config/seed-network/twitter/session.json
 * and passed to bird via --auth-token / --ct0 flags.
 *
 * Auth flow:
 *   1. Try stored session (fastest)
 *   2. Try browser cookie extraction via bird's resolveCredentials
 *   3. Fall back to manual token entry via /twitter-login
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

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
  username: string;       // verified @handle
  name: string;           // display name
  userId: string;         // numeric Twitter user ID
  source: string;         // how credentials were obtained ("Safari", "manual", etc.)
  authenticatedAt: string; // ISO 8601
}

export class TwitterNotConnectedError extends Error {
  constructor() {
    super("Not connected to Twitter/X. Run /twitter-login to authenticate.");
    this.name = "TwitterNotConnectedError";
  }
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
}

export async function clearTwitterSession(): Promise<boolean> {
  try { await unlink(SESSION_PATH); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Credential resolution for bird CLI
// ---------------------------------------------------------------------------

/**
 * Get bird CLI auth flags from the stored session.
 * Returns the flags to prepend to any bird command, or throws if not connected.
 */
export async function getBirdAuthFlags(): Promise<string[]> {
  const session = await loadTwitterSession();
  if (!session) throw new TwitterNotConnectedError();
  return ["--auth-token", session.authToken, "--ct0", session.ct0];
}

/**
 * Try to extract Twitter cookies from browsers using bird's resolveCredentials.
 * This is the zero-friction path: if the user is logged into x.com in any browser,
 * we can grab their cookies automatically.
 *
 * Uses bird CLI's `whoami --json` to both test cookies and get the username.
 */
export async function tryBrowserExtraction(
  exec: (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<{ code: number; stdout: string; stderr: string }>,
): Promise<{ session: TwitterSession; warnings: string[] } | null> {
  // bird whoami --json will try all browsers and return the current user if cookies work
  const result = await exec("bird", ["whoami", "--json", "--plain"], { timeout: 30_000 });

  if (result.code !== 0) {
    return null;
  }

  try {
    const stdout = result.stdout.trim();
    const lines = stdout.split("\n").filter(l => l.trim());
    // Find the JSON line (bird may output warnings on stderr, but JSON on stdout)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const data = JSON.parse(lines[i]);
        if (data.username) {
          // whoami succeeded — now we need to get the actual cookies that worked.
          // bird doesn't expose the raw cookies in whoami output, so we extract them ourselves.
          const { resolveCredentials } = await import("@connormartin/bird");
          const { cookies, warnings } = await resolveCredentials({});

          if (!cookies.authToken || !cookies.ct0) return null;

          const session: TwitterSession = {
            authToken: cookies.authToken,
            ct0: cookies.ct0,
            username: data.username,
            name: data.name || data.username,
            userId: data.id || "",
            source: cookies.source || "browser",
            authenticatedAt: new Date().toISOString(),
          };

          return { session, warnings };
        }
      } catch { continue; }
    }
  } catch {}

  return null;
}

/**
 * Verify that a set of cookies are valid by calling bird whoami.
 */
export async function verifyCredentials(
  exec: (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<{ code: number; stdout: string; stderr: string }>,
  authToken: string,
  ct0: string,
): Promise<{ username: string; name: string; userId: string } | null> {
  const result = await exec(
    "bird",
    ["whoami", "--json", "--plain", "--auth-token", authToken, "--ct0", ct0],
    { timeout: 15_000 },
  );

  if (result.code !== 0) return null;

  try {
    const lines = result.stdout.trim().split("\n").filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const data = JSON.parse(lines[i]);
        if (data.username) {
          return { username: data.username, name: data.name || data.username, userId: data.id || "" };
        }
      } catch { continue; }
    }
  } catch {}

  return null;
}
