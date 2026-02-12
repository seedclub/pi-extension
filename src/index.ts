/**
 * Seed Network extension for pi
 *
 * Install: pi install git@github.com:seedclub/pi-extension
 * Connect: /seed-connect
 * Go:      /tend, /source, /enrich, etc.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { registerDealTools } from "./tools/deals";
import { registerCompanyTools } from "./tools/companies";
import { registerSignalTools } from "./tools/signals";
import { registerResearchTools } from "./tools/research";
import { registerEnrichmentTools } from "./tools/enrichments";
import { registerEventTools } from "./tools/events";
import { registerTwitterTools } from "./tools/twitter";
import { registerTelegramTools } from "./tools/telegram";
import { registerUtilityTools } from "./tools/utility";
import { registerActionTools } from "./tools/actions";
import { getCurrentUser } from "./tools/utility";
import { getStoredToken, storeToken, getApiBase } from "./auth";
import { setCachedToken, clearCredentials } from "./api-client";
import { telegramSessionExists, loadTelegramSession, getScriptPath, getTelegramDir, SESSION_PATH as TELEGRAM_SESSION_PATH } from "./telegram-client";
import { unlink } from "node:fs/promises";
import { registerMirror } from "./mirror";

export default function (pi: ExtensionAPI) {
  // --- Register all tools ---
  registerDealTools(pi);
  registerCompanyTools(pi);
  registerSignalTools(pi);
  registerResearchTools(pi);
  registerEnrichmentTools(pi);
  registerEventTools(pi);
  registerTwitterTools(pi);
  registerTelegramTools(pi);
  registerUtilityTools(pi);
  registerActionTools(pi);

  // --- Session mirror (streams events to web app) ---
  registerMirror(pi);

  // --- Commands ---

  pi.registerCommand("seed-connect", {
    description: "Connect to Seed Network (opens browser, or pass a token directly)",
    handler: async (args, ctx) => {
      const token = args?.trim();

      // Direct token path: /seed-connect sn_abc123
      if (token) {
        if (!token.startsWith("sn_")) {
          ctx.ui.notify("Invalid token. Seed Network tokens start with sn_", "error");
          return;
        }
        await verifyAndStore(token, ctx);
        return;
      }

      // Browser auth path: /seed-connect
      const apiBase = getApiBase();
      const port = await findAvailablePort();
      const state = randomBytes(16).toString("hex");
      const authUrl = `${apiBase}/auth/cli/authorize?port=${port}&state=${state}`;

      ctx.ui.notify(`Opening browser to sign in...`, "info");

      // Open the URL in the default browser
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      pi.exec(openCmd, [authUrl]).catch(() => {
        // If open fails, the URL is still shown in the notification below
      });

      try {
        const result = await waitForCallback(port, state, apiBase);
        await verifyAndStore(result.token, ctx, result.email);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Authentication failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("seed-logout", {
    description: "Disconnect from Seed Network",
    handler: async (_args, ctx) => {
      await clearCredentials();
      ctx.ui.setStatus("seed", undefined);
      ctx.ui.notify("Logged out of Seed Network", "info");
    },
  });

  pi.registerCommand("seed-status", {
    description: "Check Seed Network connection status",
    handler: async (_args, ctx) => {
      const stored = await getStoredToken();
      if (stored) {
        ctx.ui.notify(`Connected as ${stored.email} (${stored.apiBase})`, "info");
      } else if (process.env.SEED_NETWORK_TOKEN) {
        ctx.ui.notify("Connected via SEED_NETWORK_TOKEN env var", "info");
      } else {
        ctx.ui.notify("Not connected. Run /seed-connect", "warning");
      }
    },
  });

  // --- Telegram Commands ---

  pi.registerCommand("telegram-login", {
    description: "Connect to Telegram (interactive auth flow)",
    handler: async (_args, ctx) => {
      // Check if already connected
      if (telegramSessionExists()) {
        const session = await loadTelegramSession();
        if (session) {
          const keep = await ctx.ui.confirm(
            "Already Connected",
            `You're already connected to Telegram (${session.phone}). Re-authenticate?`
          );
          if (!keep) return;
        }
      }

      const phone = await ctx.ui.input("Phone number:", "+1234567890");
      if (!phone) { ctx.ui.notify("Cancelled", "info"); return; }

      // login.py reads API credentials from TELEGRAM_API_ID / TELEGRAM_API_HASH env vars,
      // or prompts interactively. Get credentials at https://my.telegram.org/apps
      const cwd = getTelegramDir();

      ctx.ui.notify(
        `Complete login in your terminal:\n\n  cd ${cwd} && TELEGRAM_API_ID=<your_id> TELEGRAM_API_HASH=<your_hash> uv run scripts/login.py --phone ${phone.trim()}\n\nGet API credentials at https://my.telegram.org/apps\nThen run /reload here to pick up the session.`,
        "info"
      );
    },
  });

  pi.registerCommand("telegram-logout", {
    description: "Disconnect from Telegram",
    handler: async (_args, ctx) => {
      try {
        await unlink(TELEGRAM_SESSION_PATH);
        ctx.ui.setStatus("telegram", undefined);
        ctx.ui.notify("Logged out of Telegram", "info");
      } catch {
        ctx.ui.notify("No Telegram session found", "info");
      }
    },
  });

  pi.registerCommand("telegram-status", {
    description: "Check Telegram connection status",
    handler: async (_args, ctx) => {
      const session = await loadTelegramSession();
      if (session) {
        const phone = session.phone.replace(/(\d{3})\d+(\d{3})/, "$1***$2");
        ctx.ui.notify(`📱 Connected as ${phone} (since ${session.authenticatedAt?.split("T")[0] || "unknown"})`, "info");
      } else {
        ctx.ui.notify("Not connected to Telegram. Run /telegram-login", "warning");
      }
    },
  });

  // --- Show connection status on session start ---

  pi.on("session_start", async (_event, ctx) => {
    const stored = await getStoredToken();
    if (stored) {
      ctx.ui.setStatus("seed", `🌱 ${stored.email}`);
    } else if (process.env.SEED_NETWORK_TOKEN) {
      ctx.ui.setStatus("seed", "🌱 Connected (env)");
    }

    // Telegram status
    if (telegramSessionExists()) {
      const session = await loadTelegramSession();
      if (session) {
        const phone = session.phone.replace(/(\d{3})\d+(\d{3})/, "$1***$2");
        ctx.ui.setStatus("telegram", `📱 ${phone}`);
      }
    }
  });

  // --- Helpers (scoped to this extension) ---

  async function verifyAndStore(token: string, ctx: any, emailHint?: string) {
    const apiBase = getApiBase();
    await storeToken(token, emailHint || "pending", apiBase);
    setCachedToken(token, apiBase);

    const result = await getCurrentUser();
    if ("error" in result) {
      await clearCredentials();
      ctx.ui.notify(`Token verification failed: ${result.error}`, "error");
      return;
    }

    await storeToken(token, result.email, apiBase);
    ctx.ui.notify(`✓ Connected as ${result.email}`, "success");
    ctx.ui.setStatus("seed", `🌱 ${result.email}`);
  }
}

// --- Browser auth helpers ---

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not find available port"));
      }
    });
    server.on("error", reject);
  });
}

function waitForCallback(
  port: number,
  state: string,
  apiBase: string
): Promise<{ token: string; email: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for sign-in (5 minutes). Try again."));
    }, 300_000);

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const done = (status: number, body: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
        clearTimeout(timeout);
        server.close();
      };

      if (url.searchParams.get("state") !== state) {
        done(400, "<h1>Invalid state parameter</h1>");
        reject(new Error("Invalid state parameter"));
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        done(400, `<h1>Authentication Failed</h1><p>${error}</p>`);
        reject(new Error(error));
        return;
      }

      const token = url.searchParams.get("token");
      if (!token || !token.startsWith("sn_")) {
        done(400, "<h1>Invalid token</h1>");
        reject(new Error("Invalid token received"));
        return;
      }

      const email = url.searchParams.get("email") || "unknown";
      done(200, `<h1>✓ Connected</h1><p>Signed in as ${email}. You can close this tab.</p>`);
      resolve({ token, email });
    });

    server.listen(port, "127.0.0.1");
    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
