/**
 * Seed Network extension for pi
 *
 * Install: pi install git:git@github.com:seedclub/pi-extension
 * Connect: /seed-connect
 * Go:      /tend, /source, /enrich, etc.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { registerTelegramTools } from "./tools/telegram";
import { registerUtilityTools } from "./tools/utility";
import { registerWorkflowTools } from "./tools/workflows";
import { registerTwitterBookmarkTools } from "./tools/twitter-bookmarks";
import { getCurrentUser } from "./tools/utility";
import {
  getStoredToken,
  storeToken,
  getApiBase,
  fetchMirrorConfig,
  storeMirrorConfig,
  clearMirrorConfig,
  fetchTelegramAppConfig,
  storeTelegramAppConfig,
  clearTelegramAppConfig,
  getTelegramAppConfig,
} from "./auth";
import { setCachedToken, clearCredentials } from "./api-client";
import {
  telegramSessionExists,
  loadTelegramSession,
  runTelegramScript,
  SESSION_PATH as TELEGRAM_SESSION_PATH,
} from "./telegram-client";
import {
  twitterSessionExists,
  loadTwitterSession,
  clearTwitterSession,
  storeTwitterSession,
  clearTwitterClient,
  checkTwitterCredentials,
  verifyManualCredentials,
} from "./twitter-client";
import { unlink, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { registerMirror } from "./mirror";

export default function (pi: ExtensionAPI) {
  // --- Register all tools ---
  registerTelegramTools(pi);
  registerUtilityTools(pi);
  registerWorkflowTools(pi);
  registerTwitterBookmarkTools(pi);

  // --- Session mirror (streams events to web app) ---
  registerMirror(pi);

  // Wrap pi.exec for use with runTelegramScript
  const exec = (cmd: string, args: string[], opts?: { timeout?: number; cwd?: string; signal?: AbortSignal }) =>
    pi.exec(cmd, args, opts);

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
      pi.exec(openCmd, [authUrl]).catch(() => {});

      try {
        const result = await waitForCallback(port, state, apiBase);
        await verifyAndStore(result.token, ctx, result.email);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Authentication failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("seed-update", {
    description: "Pull the latest version of the Seed Network extension",
    handler: async (_args, ctx) => {
      const repoDir = join(__dirname, "..");
      ctx.ui.notify("Pulling latest extension...", "info");
      try {
        // Checkout main and pull explicitly to avoid issues with
        // detached HEAD or branches without upstream tracking
        await pi.exec("git", ["checkout", "main"], { cwd: repoDir });
        const result = await pi.exec("git", ["pull", "origin", "main"], { cwd: repoDir });
        if (result.code !== 0) {
          ctx.ui.notify(`git pull failed:\n${result.stderr || result.stdout}`, "error");
          return;
        }
        const summary = result.stdout.trim();
        if (summary === "Already up to date.") {
          ctx.ui.notify("Already up to date.", "info");
        } else {
          ctx.ui.notify(`Updated.\n\n${summary}\n\nRestart pi to load the new version.`, "success");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Update failed: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("seed-logout", {
    description: "Disconnect from Seed Network",
    handler: async (_args, ctx) => {
      await clearCredentials();
      await clearMirrorConfig();
      await clearTelegramAppConfig();
      await clearTwitterSession();
      ctx.ui.setStatus("seed", undefined);
      ctx.ui.setStatus("mirror", undefined);
      ctx.ui.setStatus("twitter", undefined);
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
    description: "Connect your Telegram account",
    handler: async (_args, ctx) => {
      // Check if already connected
      if (telegramSessionExists()) {
        const session = await loadTelegramSession();
        if (session) {
          const redo = await ctx.ui.confirm(
            "Already Connected",
            `Already connected as ${session.phone}. Re-authenticate?`
          );
          if (!redo) return;
        }
      }

      // Ensure we have app credentials before starting
      const appConfig = await getTelegramAppConfig();
      if (!appConfig) {
        ctx.ui.notify(
          "Telegram app credentials not configured. Run /seed-connect first, or set TELEGRAM_API_ID and TELEGRAM_API_HASH.",
          "error"
        );
        return;
      }

      // Step 1: get phone number
      const phone = await ctx.ui.input("Your Telegram phone number:", "+1234567890");
      if (!phone?.trim()) { ctx.ui.notify("Cancelled", "info"); return; }

      // Step 2: request OTP — this triggers Telegram to send a code to the user's app/SMS
      ctx.ui.notify("Sending verification code to your Telegram...", "info");
      let requestResult: any;
      try {
        requestResult = await runTelegramScript(exec, "login.py", ["request-code", "--phone", phone.trim()], { timeout: 20000 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Failed to send code: ${msg}`, "error");
        return;
      }

      if (requestResult?.error) {
        ctx.ui.notify(`Failed to send code: ${requestResult.error}`, "error");
        return;
      }

      // Step 3: collect OTP from user
      const code = await ctx.ui.input("Enter the code Telegram sent you:");
      if (!code?.trim()) { ctx.ui.notify("Cancelled", "info"); return; }

      // Step 4: sign in with OTP
      let signInResult: any;
      try {
        signInResult = await runTelegramScript(exec, "login.py", ["sign-in", "--code", code.trim()], { timeout: 20000 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Sign-in failed: ${msg}`, "error");
        return;
      }

      if (signInResult?.success) {
        ctx.ui.notify(`✓ Connected to Telegram as ${signInResult.name}`, "success");
        ctx.ui.setStatus("telegram", `📱 ${signInResult.phone}`);
        return;
      }

      // Step 5 (if needed): 2FA
      if (signInResult?.status === "2fa_required") {
        const password = await ctx.ui.input("Enter your Telegram 2FA password:");
        if (!password?.trim()) { ctx.ui.notify("Cancelled", "info"); return; }

        let twoFaResult: any;
        try {
          twoFaResult = await runTelegramScript(exec, "login.py", ["sign-in-2fa", "--password", password], { timeout: 20000 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`2FA failed: ${msg}`, "error");
          return;
        }

        ctx.ui.notify(`✓ Connected to Telegram as ${twoFaResult.name}`, "success");
        ctx.ui.setStatus("telegram", `📱 ${twoFaResult.phone}`);
        return;
      }

      ctx.ui.notify(`Sign-in failed: unexpected response from login script`, "error");
    },
  });

  pi.registerCommand("telegram-logout", {
    description: "Disconnect from Telegram",
    handler: async (_args, ctx) => {
      const telegramDir = dirname(TELEGRAM_SESSION_PATH);
      const pendingPath = join(telegramDir, "pending.json");
      const hadSession = telegramSessionExists();

      if (hadSession) {
        // Best-effort: revoke the session on Telegram's servers so it disappears
        // from the user's active sessions list in Telegram Settings > Devices.
        try {
          await runTelegramScript(exec, "logout.py", ["--revoke"], { timeout: 10000 });
        } catch {
          // Unreachable or already invalid — fine, we'll delete locally below.
        }
      }

      // Always clean up local files regardless of revocation outcome
      for (const p of [TELEGRAM_SESSION_PATH, pendingPath]) {
        try { await rm(p, { force: true }); } catch {}
      }

      ctx.ui.setStatus("telegram", undefined);
      ctx.ui.notify(hadSession ? "Logged out of Telegram" : "No Telegram session found", "info");
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

  // --- Twitter Commands ---

  pi.registerCommand("twitter-login", {
    description: "Connect your Twitter/X account for bookmark syncing",
    handler: async (_args, ctx) => {
      // Check if already connected
      if (twitterSessionExists()) {
        const session = await loadTwitterSession();
        if (session) {
          const redo = await ctx.ui.confirm(
            "Already Connected",
            `Already connected as @${session.username}. Re-authenticate?`
          );
          if (!redo) return;
        }
      }

      // Step 1: Try automatic browser cookie extraction
      ctx.ui.notify("Looking for Twitter/X cookies in your browsers...", "info");
      clearTwitterClient(); // Clear any stale cached client

      const check = await checkTwitterCredentials();
      if (check.valid && check.user) {
        // Session was already stored by checkTwitterCredentials
        ctx.ui.notify(
          `✓ Connected to Twitter/X as @${check.user.username} (via ${check.source || "browser"})`,
          "success"
        );
        ctx.ui.setStatus("twitter", `🐦 @${check.user.username}`);
        return;
      }

      // Step 2: Manual token entry
      if (check.warnings.length > 0) {
        ctx.ui.notify(check.warnings.join("\n"), "warning");
      }
      ctx.ui.notify(
        "To connect manually:\n" +
        "1. Open x.com in your browser and make sure you're logged in\n" +
        "2. Open DevTools (F12) → Application → Cookies → https://x.com\n" +
        "3. Copy the values of `auth_token` and `ct0`",
        "info"
      );

      const authToken = await ctx.ui.input("Paste your auth_token cookie value:");
      if (!authToken?.trim()) { ctx.ui.notify("Cancelled", "info"); return; }

      const ct0 = await ctx.ui.input("Paste your ct0 cookie value:");
      if (!ct0?.trim()) { ctx.ui.notify("Cancelled", "info"); return; }

      // Step 3: Verify the tokens work
      ctx.ui.notify("Verifying credentials...", "info");
      const user = await verifyManualCredentials(authToken.trim(), ct0.trim());

      if (!user) {
        ctx.ui.notify(
          "Verification failed — could not authenticate with those cookies.\n" +
          "Make sure you copied the full values and that you're logged into x.com.",
          "error"
        );
        return;
      }

      const session = {
        authToken: authToken.trim(),
        ct0: ct0.trim(),
        username: user.username,
        name: user.name,
        userId: user.userId,
        source: "manual",
        authenticatedAt: new Date().toISOString(),
      };

      await storeTwitterSession(session);
      ctx.ui.notify(`✓ Connected to Twitter/X as @${user.username}`, "success");
      ctx.ui.setStatus("twitter", `🐦 @${user.username}`);
    },
  });

  pi.registerCommand("twitter-logout", {
    description: "Disconnect from Twitter/X",
    handler: async (_args, ctx) => {
      const hadSession = twitterSessionExists();
      await clearTwitterSession();
      ctx.ui.setStatus("twitter", undefined);
      ctx.ui.notify(hadSession ? "Logged out of Twitter/X" : "No Twitter session found", "info");
    },
  });

  pi.registerCommand("twitter-status", {
    description: "Check Twitter/X connection status",
    handler: async (_args, ctx) => {
      const session = await loadTwitterSession();
      if (session) {
        ctx.ui.notify(
          `🐦 Connected as @${session.username} (via ${session.source}, since ${session.authenticatedAt?.split("T")[0] || "unknown"})`,
          "info"
        );
      } else {
        ctx.ui.notify("Not connected to Twitter/X. Run /twitter-login", "warning");
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

    if (telegramSessionExists()) {
      const session = await loadTelegramSession();
      if (session) {
        const phone = session.phone.replace(/(\d{3})\d+(\d{3})/, "$1***$2");
        ctx.ui.setStatus("telegram", `📱 ${phone}`);
      }
    }

    if (twitterSessionExists()) {
      const session = await loadTwitterSession();
      if (session) {
        ctx.ui.setStatus("twitter", `🐦 @${session.username}`);
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

    // Fetch and store relay config (only succeeds for curators)
    const mirrorConfig = await fetchMirrorConfig(token, apiBase);
    if (mirrorConfig) {
      await storeMirrorConfig(mirrorConfig);
      pi.events.emit("seed:mirror:reconnect");
      ctx.ui.notify("🪞 Mirror relay configured", "info");
    }

    // Fetch and store Telegram app credentials (succeeds for any authenticated user)
    const telegramAppConfig = await fetchTelegramAppConfig(token, apiBase);
    if (telegramAppConfig) {
      await storeTelegramAppConfig(telegramAppConfig.apiId, telegramAppConfig.apiHash);
    }
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
