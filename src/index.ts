/**
 * Seed Network extension for pi
 *
 * Install: pi install git@github.com:seedclub/pi-extension
 * Start:   /seedclub
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { registerDealTools } from "./tools/deals";
import { registerCompanyTools } from "./tools/companies";
import { registerSignalTools } from "./tools/signals";
import { registerEnrichmentTools } from "./tools/enrichments";
import { registerUtilityTools } from "./tools/utility";
import { getCurrentUser } from "./tools/utility";
import { getStoredToken, storeToken, getApiBase } from "./auth";
import { setCachedToken, clearCredentials } from "./api-client";
import { registerAddCommand } from "./commands/add";
// /import merged into /add — single unified entry point
import { registerSignalsCommand } from "./commands/signals";
import { registerDevCommand } from "./commands/dev";
import { registerSeedclubCommand } from "./commands/seedclub";
import { registerSortCommand } from "./commands/sort";

export default function (pi: ExtensionAPI) {
  // --- Register all tools ---
  registerDealTools(pi);
  registerCompanyTools(pi);
  registerSignalTools(pi);
  registerEnrichmentTools(pi);
  registerUtilityTools(pi);

  // --- Shared handlers ---

  async function connect(args: string | undefined, ctx: any) {
    const token = args?.trim();

    // Direct token path
    if (token) {
      if (!token.startsWith("sn_")) {
        ctx.ui.notify("Invalid token. Seed Network tokens start with sn_", "error");
        return;
      }
      await verifyAndStore(token, ctx);
      return;
    }

    // Browser auth path
    const apiBase = getApiBase();
    const port = await findAvailablePort();
    const state = randomBytes(16).toString("hex");
    const authUrl = `${apiBase}/auth/cli/authorize?port=${port}&state=${state}`;

    ctx.ui.notify(`Opening browser to sign in...\n${authUrl}`, "info");

    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    pi.exec(openCmd, [authUrl]).catch(() => {
      ctx.ui.notify(`Couldn't open browser automatically. Visit:\n${authUrl}`, "warning");
    });

    try {
      const result = await waitForCallback(port, state, apiBase);
      await verifyAndStore(result.token, ctx, result.email);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Authentication failed: ${msg}`, "error");
    }
  }

  async function disconnect(ctx: any) {
    await clearCredentials();
    ctx.ui.setStatus("seed", undefined);
    ctx.ui.notify("Logged out of Seed Network", "info");
  }

  // --- Commands ---

  // The one command
  registerSeedclubCommand(pi, { connect, disconnect });

  // Quick-action shortcuts (still useful for power users)
  registerAddCommand(pi);
  registerSignalsCommand(pi);
  registerSortCommand(pi);
  registerDevCommand(pi);

  // --- Show connection status on session start ---

  pi.on("session_start", async (_event, ctx) => {
    const stored = await getStoredToken();
    if (stored) {
      const isDev = stored.apiBase?.includes("localhost") || stored.apiBase?.includes("127.0.0.1");
      ctx.ui.setStatus("seed", `🌱 ${stored.email}`);
      if (isDev) ctx.ui.setStatus("seed-api", `🔧 ${stored.apiBase}`);
    } else if (process.env.SEED_NETWORK_TOKEN) {
      ctx.ui.setStatus("seed", "🌱 Connected (env)");
    }
  });

  // --- Helpers ---

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
