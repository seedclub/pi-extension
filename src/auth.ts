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
const MIRROR_FILE = join(CONFIG_DIR, "mirror");
const TELEGRAM_APP_FILE = join(CONFIG_DIR, "telegram", "app.json");
const DEFAULT_API_BASE = "https://beta.seedclub.com";
const LOCAL_API_BASE = "http://localhost:3000";

/** Cache the localhost probe so we only check once per session */
let localhostProbeResult: boolean | null = null;

async function isLocalhostRunning(): Promise<boolean> {
  if (localhostProbeResult !== null) return localhostProbeResult;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`${LOCAL_API_BASE}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    localhostProbeResult = res.ok;
  } catch {
    localhostProbeResult = false;
  }
  return localhostProbeResult;
}

/** Reset the cached probe (e.g. if the user starts/stops the dev server) */
export function resetLocalhostProbe(): void {
  localhostProbeResult = null;
}

export interface StoredToken {
  token: string;
  email: string;
  createdAt: string;
  apiBase: string;
}

export function getApiBase(): string {
  return process.env.SEED_NETWORK_API || DEFAULT_API_BASE;
}

/**
 * Resolve the API base to use.
 * Priority: SEED_NETWORK_API env > localhost:3000 (if running) > stored token apiBase > default.
 */
export async function resolveApiBase(): Promise<string> {
  if (process.env.SEED_NETWORK_API) return process.env.SEED_NETWORK_API;
  if (await isLocalhostRunning()) return LOCAL_API_BASE;
  const stored = await getStoredToken();
  return stored?.apiBase || DEFAULT_API_BASE;
}

export async function getStoredToken(): Promise<StoredToken | null> {
  try {
    const content = await readFile(TOKEN_FILE, "utf-8");
    const stored = JSON.parse(content) as StoredToken;
    if (!stored.token || !stored.token.startsWith("sn_")) return null;
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

// --- Mirror / relay config ---

export interface MirrorConfig {
  relayUrl: string;
  token: string;
  session: string;
  fetchedAt: string;
}

export async function getMirrorConfig(): Promise<MirrorConfig | null> {
  // Env vars take priority (for CI, custom setups)
  if (process.env.PI_MIRROR_URL && process.env.PI_MIRROR_TOKEN) {
    return {
      relayUrl: process.env.PI_MIRROR_URL,
      token: process.env.PI_MIRROR_TOKEN,
      session: process.env.PI_MIRROR_SESSION || "default",
      fetchedAt: "env",
    };
  }

  try {
    const content = await readFile(MIRROR_FILE, "utf-8");
    return JSON.parse(content) as MirrorConfig;
  } catch {
    return null;
  }
}

export async function storeMirrorConfig(config: Omit<MirrorConfig, "fetchedAt">): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const data: MirrorConfig = { ...config, fetchedAt: new Date().toISOString() };
  await writeFile(MIRROR_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { await chmod(MIRROR_FILE, 0o600); } catch {}
}

export async function clearMirrorConfig(): Promise<boolean> {
  try { await unlink(MIRROR_FILE); return true; } catch { return false; }
}

/**
 * Fetch relay config from the Seed Network API.
 * Only works for curators — returns null for regular users.
 */
export async function fetchMirrorConfig(apiToken: string, apiBase: string): Promise<Omit<MirrorConfig, "fetchedAt"> | null> {
  try {
    const res = await fetch(`${apiBase}/api/relay/config`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.relayUrl || !data.token) return null;
    return { relayUrl: data.relayUrl, token: data.token, session: data.session || "default" };
  } catch {
    return null;
  }
}

// --- Telegram app config ---
// Stores the shared Telegram application credentials (api_id + api_hash).
// These identify the Seed Network app to Telegram's MTProto API.
// Fetched once from /api/telegram/config during /seed-connect.

export interface TelegramAppConfig {
  apiId: number;
  apiHash: string;
  fetchedAt: string;
}

export async function getTelegramAppConfig(): Promise<TelegramAppConfig | null> {
  // Env vars take priority — useful for local dev before /seed-connect
  if (process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH) {
    return {
      apiId: parseInt(process.env.TELEGRAM_API_ID, 10),
      apiHash: process.env.TELEGRAM_API_HASH,
      fetchedAt: "env",
    };
  }
  try {
    const content = await readFile(TELEGRAM_APP_FILE, "utf-8");
    return JSON.parse(content) as TelegramAppConfig;
  } catch {
    return null;
  }
}

export async function storeTelegramAppConfig(apiId: number, apiHash: string): Promise<void> {
  const dir = join(CONFIG_DIR, "telegram");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const data: TelegramAppConfig = { apiId, apiHash, fetchedAt: new Date().toISOString() };
  await writeFile(TELEGRAM_APP_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { await chmod(TELEGRAM_APP_FILE, 0o600); } catch {}
}

export async function clearTelegramAppConfig(): Promise<boolean> {
  try { await unlink(TELEGRAM_APP_FILE); return true; } catch { return false; }
}

/**
 * Fetch Telegram app credentials from the Seed Network API.
 * Works for any authenticated user (not curator-restricted).
 * Returns null if the server hasn't configured TELEGRAM_API_ID/HASH.
 */
export async function fetchTelegramAppConfig(apiToken: string, apiBase: string): Promise<{ apiId: number; apiHash: string } | null> {
  try {
    const res = await fetch(`${apiBase}/api/telegram/config`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.apiId || !data.apiHash) return null;
    return { apiId: data.apiId, apiHash: data.apiHash };
  } catch {
    return null;
  }
}
