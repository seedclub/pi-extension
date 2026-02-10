/**
 * Token storage for Seed Network.
 *
 * Priority: SEED_NETWORK_TOKEN env var > stored token file.
 * Use /seed-connect <token> to store a token.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, unlink, chmod } from "node:fs/promises";

const CONFIG_DIR = join(homedir(), ".config", "seed-network");
const TOKEN_FILE = join(CONFIG_DIR, "token");
const DEFAULT_API_BASE = "https://beta.seedclub.com";

export interface StoredToken {
  token: string;
  email: string;
  createdAt: string;
  apiBase: string;
}

/**
 * API base priority:
 * 1. SEED_NETWORK_API env var (set by /seed-dev at runtime)
 * 2. apiBase saved in token file (persists across restarts — set when you authenticated)
 * 3. Production default
 */
let _cachedApiBase: string | null = null;

export function getApiBase(): string {
  if (process.env.SEED_NETWORK_API) return process.env.SEED_NETWORK_API;
  if (_cachedApiBase) return _cachedApiBase;
  return DEFAULT_API_BASE;
}

export function setCachedApiBase(apiBase: string): void {
  _cachedApiBase = apiBase;
}

export function clearCachedApiBase(): void {
  _cachedApiBase = null;
}

export async function getStoredToken(): Promise<StoredToken | null> {
  try {
    const content = await readFile(TOKEN_FILE, "utf-8");
    const stored = JSON.parse(content) as StoredToken;
    if (!stored.token || !stored.token.startsWith("sn_")) return null;
    // Hydrate the API base from the token file so restarts remember which server you're on
    if (stored.apiBase && !process.env.SEED_NETWORK_API) {
      _cachedApiBase = stored.apiBase;
    }
    return stored;
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  if (process.env.SEED_NETWORK_TOKEN) return process.env.SEED_NETWORK_TOKEN;
  const stored = await getStoredToken();
  return stored?.token ?? null;
}

export async function storeToken(token: string, email: string, apiBase: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(TOKEN_FILE, JSON.stringify({ token, email, createdAt: new Date().toISOString(), apiBase }, null, 2), { mode: 0o600 });
  try { await chmod(TOKEN_FILE, 0o600); } catch {}
}

export async function clearStoredToken(): Promise<boolean> {
  try { await unlink(TOKEN_FILE); return true; } catch { return false; }
}
