/**
 * Browser-based OAuth authentication for Seed Network
 *
 * Flow:
 * 1. Check for existing token in ~/.config/seed-network/token
 * 2. If no token, start local callback server and open browser
 * 3. User logs in and authorizes at webapp
 * 4. Webapp redirects to localhost callback with token
 * 5. Token is stored securely for future use
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, unlink, chmod } from "node:fs/promises";

const CONFIG_DIR = join(homedir(), ".config", "seed-network");
const TOKEN_FILE = join(CONFIG_DIR, "token");
const CALLBACK_TIMEOUT_MS = 300000; // 5 minutes
const DEFAULT_API_BASE = "https://beta.seedclub.com";

export class AuthRequiredError extends Error {
  constructor(public authUrl: string, public port: number) {
    super(`Authentication required. Please visit: ${authUrl}`);
    this.name = "AuthRequiredError";
  }
}

let pendingAuthServer: ReturnType<typeof createServer> | null = null;
let pendingAuthPromise: Promise<AuthResult> | null = null;

export interface StoredToken {
  token: string;
  email: string;
  createdAt: string;
  apiBase: string;
}

export interface AuthResult {
  token: string;
  email: string;
  apiBase: string;
}

export function getApiBase(): string {
  return process.env.SEED_NETWORK_API || DEFAULT_API_BASE;
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
  const stored: StoredToken = {
    token,
    email,
    createdAt: new Date().toISOString(),
    apiBase,
  };
  await writeFile(TOKEN_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
  try { await chmod(TOKEN_FILE, 0o600); } catch {}
}

export async function clearStoredToken(): Promise<boolean> {
  try { await unlink(TOKEN_FILE); return true; } catch { return false; }
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not find available port"));
      }
    });
    server.on("error", reject);
  });
}

export async function authenticate(): Promise<AuthResult> {
  if (pendingAuthPromise) {
    const token = await getToken();
    if (token) {
      if (pendingAuthServer) { pendingAuthServer.close(); pendingAuthServer = null; }
      pendingAuthPromise = null;
      const stored = await getStoredToken();
      return { token, email: stored?.email || "unknown", apiBase: stored?.apiBase || getApiBase() };
    }
  }

  const apiBase = getApiBase();
  const port = await findAvailablePort();
  const state = randomBytes(16).toString("hex");
  const authUrl = `${apiBase}/auth/cli/authorize?port=${port}&state=${state}`;

  pendingAuthPromise = new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (pendingAuthServer) { pendingAuthServer.close(); pendingAuthServer = null; }
      pendingAuthPromise = null;
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Authentication timed out. Please try again."));
    }, CALLBACK_TIMEOUT_MS);

    pendingAuthServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") { res.writeHead(404); res.end("Not found"); return; }

      const receivedState = url.searchParams.get("state");
      const token = url.searchParams.get("token");
      const email = url.searchParams.get("email");
      const error = url.searchParams.get("error");

      if (receivedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Invalid state parameter</h1>");
        return;
      }

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Authentication Failed</h1><p>${error}</p>`);
        cleanup();
        reject(new Error(error));
        return;
      }

      if (!token || !token.startsWith("sn_")) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Invalid token received</h1>");
        cleanup();
        reject(new Error("Invalid token received"));
        return;
      }

      try {
        await storeToken(token, email || "unknown", apiBase);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h1>✓ Authentication Successful</h1><p>Signed in as ${email || "user"}. You can close this window.</p>`);
        cleanup();
        resolve({ token, email: email || "unknown", apiBase });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<h1>Failed to store token</h1>");
        cleanup();
        reject(err);
      }
    });

    pendingAuthServer.listen(port, "127.0.0.1");
    pendingAuthServer.on("error", (err) => { cleanup(); reject(err); });
  });

  throw new AuthRequiredError(authUrl, port);
}

export async function ensureAuthenticated(): Promise<AuthResult> {
  const existingToken = await getToken();
  if (existingToken) {
    const stored = await getStoredToken();
    return { token: existingToken, email: stored?.email || "unknown", apiBase: stored?.apiBase || getApiBase() };
  }
  return authenticate();
}
