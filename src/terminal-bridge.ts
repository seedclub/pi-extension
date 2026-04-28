/**
 * Terminal bridge for pi.
 *
 * Connects this machine's local shell to a Seed Network terminal pane in the
 * browser. The browser displays a pair code, the user runs `/seed-terminal
 * <CODE>` here, pi spawns a PTY and tunnels it over an authenticated WebSocket
 * to the broker.
 *
 * Reconnect, heartbeat, and code-claim live here and are sized to this use case
 * (rather than reused from another bridge) — keeping coupling minimal.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { hostname, platform, userInfo, homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { execSync } from "node:child_process";
import { WebSocket } from "ws";
import { getToken, resolveApiBase } from "./auth";

// ---- Config storage ----

const CONFIG_DIR = join(homedir(), ".config", "seed-network");
const TERMINAL_FILE = join(CONFIG_DIR, "terminal.json");

interface TerminalConfig {
  sessionId: string;
  bridgeToken: string;
  wsUrl: string;
  brokerHttpUrl: string;
  fetchedAt: string;
}

async function loadTerminalConfig(): Promise<TerminalConfig | null> {
  try {
    const content = await readFile(TERMINAL_FILE, "utf-8");
    return JSON.parse(content) as TerminalConfig;
  } catch {
    return null;
  }
}

async function storeTerminalConfig(config: Omit<TerminalConfig, "fetchedAt">): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const data: TerminalConfig = { ...config, fetchedAt: new Date().toISOString() };
  await writeFile(TERMINAL_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    await chmod(TERMINAL_FILE, 0o600);
  } catch {
    // best-effort
  }
}

async function clearTerminalConfig(): Promise<boolean> {
  try {
    await unlink(TERMINAL_FILE);
    return true;
  } catch {
    return false;
  }
}

// ---- Constants ----

const DEFAULT_BROKER_HTTP = "http://localhost:8787";
const PROD_BROKER_HTTP = "https://seed-network-terminal-mvp-production.up.railway.app";
const PROD_API_HOSTS = new Set(["beta.seedclub.com", "www.seedclub.com", "seedclub.com"]);
const BACKOFF_BASE_MS = 200;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_JITTER = 0.3;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_DEAD_AFTER_MS = 60_000;
const WS_CLOSE_AUTH_INVALID = 4001;
const WS_CLOSE_AUTH_REVOKED = 4003;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function getBrokerHttpUrl(): Promise<{ url: string; source: string }> {
  if (process.env.SEED_BROKER_HTTP_URL) {
    return { url: process.env.SEED_BROKER_HTTP_URL, source: "SEED_BROKER_HTTP_URL" };
  }

  try {
    const apiBase = await resolveApiBase();
    const host = new URL(apiBase).hostname;
    if (isLoopbackHost(host)) {
      return { url: DEFAULT_BROKER_HTTP, source: `local api (${apiBase})` };
    }
    if (PROD_API_HOSTS.has(host)) {
      return { url: PROD_BROKER_HTTP, source: `seed api (${apiBase})` };
    }
  } catch {
    // fall through to localhost default below
  }

  return { url: DEFAULT_BROKER_HTTP, source: "default localhost fallback" };
}

let tmuxProbeResult: boolean | null = null;
function tmuxAvailable(): boolean {
  if (tmuxProbeResult !== null) return tmuxProbeResult;
  try {
    execSync("command -v tmux", { stdio: "ignore" });
    tmuxProbeResult = true;
  } catch {
    tmuxProbeResult = false;
  }
  return tmuxProbeResult;
}

function shouldUseTmux(): boolean {
  if (process.env.SEED_TERMINAL_USE_TMUX === "false") return false;
  return tmuxAvailable();
}

// Isolated tmux socket + skip user config. Otherwise the user's `~/.tmux.conf`
// may enable a status bar (often green) that repaints over the embedded pane.
function tmuxCommandArgs(sessionName: string): string[] {
  return [
    "-L",
    "seed",
    "-f",
    "/dev/null",
    "new-session",
    "-A",
    "-s",
    sessionName,
    ";",
    "set-option",
    "-g",
    "status",
    "off",
    ";",
    "set-option",
    "-g",
    "default-terminal",
    "xterm-256color",
  ];
}

function backoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  const jitter = base * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

// ---- Pair claim ----

interface ClaimSuccess {
  sessionId: string;
  bridgeToken: string;
  wsUrl: string;
}

async function claimPair(opts: {
  brokerHttpUrl: string;
  token: string;
  code: string;
}): Promise<ClaimSuccess | { error: string }> {
  let res: Response;
  try {
    res = await fetch(`${opts.brokerHttpUrl}/pair/claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: opts.code,
        hostname: hostname(),
        os: platform(),
        user: userInfo().username,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "TimeoutError") {
      return {
        error: `Timed out (15s) reaching broker at ${opts.brokerHttpUrl}. Set SEED_BROKER_HTTP_URL to the right host.`,
      };
    }
    return { error: `Network error reaching broker (${opts.brokerHttpUrl}): ${msg}` };
  }
  if (res.status === 401) return { error: "Unauthenticated. Check your Seed token (/seed-status)." };
  if (res.status === 403) {
    return {
      error:
        "Pair code owner mismatch. Was the code created by the same Seed account that's signed in here?",
    };
  }
  if (res.status === 409) return { error: "That pair code was already claimed." };
  if (res.status === 410) return { error: "Pair code expired or unknown." };
  if (!res.ok) return { error: `pair/claim failed with HTTP ${res.status}` };
  return (await res.json()) as ClaimSuccess;
}

// ---- The bridge ----

type BridgeStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

interface BridgeHandle {
  close: () => void;
  isConnected: () => boolean;
  sessionId: string;
}

interface CreateBridgeOptions {
  config: TerminalConfig;
  onStatusChange?: (status: BridgeStatus, message?: string) => void;
}

async function createBridge(opts: CreateBridgeOptions): Promise<BridgeHandle> {
  // Lazy-load node-pty so module load doesn't fail if the prebuild is missing.
  const ptyModule = await import("node-pty");
  const pty = ptyModule;

  let ws: WebSocket | null = null;
  let ptyProcess: ReturnType<typeof pty.spawn> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastPongAt = Date.now();
  let closingManually = false;
  const sessionCols = 80;
  const sessionRows = 24;

  function spawnPtyIfNeeded() {
    if (ptyProcess) return;
    const shell = process.env.SHELL || "/bin/bash";
    const useTmux = shouldUseTmux();
    let cmd: string;
    let args: string[];
    if (useTmux) {
      // Wrapping in tmux means closing pi (or /seed-terminal-stop) doesn't
      // kill the user's local shell — running processes survive, scrollback
      // survives, and the next `/seed-terminal` reattaches to the same tmux
      // session.
      cmd = "tmux";
      args = tmuxCommandArgs(`seed-${opts.config.sessionId}`);
    } else {
      cmd = shell;
      args = ["-l"];
    }
    try {
      ptyProcess = pty.spawn(cmd, args, {
        name: "xterm-256color",
        cols: sessionCols,
        rows: sessionRows,
        cwd: process.env.HOME || process.cwd(),
        env: cleanEnv(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fix =
        "On pi, the node-pty `spawn-helper` may need `chmod +x`. Run: " +
        "find ~/seed-network-pi/node_modules -path '*node-pty*/prebuilds/darwin-*/spawn-helper' -exec chmod +x {} +";
      opts.onStatusChange?.("error", `pty spawn failed: ${msg}. ${fix}`);
      closingManually = true;
      stopHeartbeat();
      if (ws) {
        try {
          ws.close(1011, "pty spawn failed");
        } catch {
          // ignore
        }
      }
      return;
    }
    ptyProcess.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });
    ptyProcess.onExit(({ exitCode }) => {
      ptyProcess = null;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "status",
            status: "disconnected",
            message: `local shell exited (${exitCode})`,
          }),
        );
      }
      // Shell exit ends the bridge; user can re-issue /seed-terminal to start fresh.
      closingManually = true;
      if (ws) ws.close(1000, "shell exited");
      stopHeartbeat();
      opts.onStatusChange?.("disconnected", `local shell exited (${exitCode})`);
    });
  }

  function killPty() {
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {
        // ignore
      }
      ptyProcess = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    lastPongAt = Date.now();
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPongAt > HEARTBEAT_DEAD_AFTER_MS) {
        ws.terminate();
        return;
      }
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer || closingManually) return;
    const delay = backoffMs(reconnectAttempt);
    reconnectAttempt += 1;
    opts.onStatusChange?.(
      "reconnecting",
      `attempt ${reconnectAttempt} in ${(delay / 1000).toFixed(1)}s`,
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (closingManually) return;
    const wsUrl = new URL(opts.config.wsUrl);
    wsUrl.searchParams.set("token", opts.config.bridgeToken);
    ws = new WebSocket(wsUrl.toString());

    ws.on("open", () => {
      reconnectAttempt = 0;
      lastPongAt = Date.now();
      opts.onStatusChange?.("connected");

      spawnPtyIfNeeded();

      ws!.send(
        JSON.stringify({
          type: "hello",
          bridge: {
            hostname: hostname(),
            os: platform(),
            user: userInfo().username,
            cwd: process.env.HOME || process.cwd(),
          },
        }),
      );
      ws!.send(
        JSON.stringify({
          type: "status",
          status: "connected",
          message: "local bridge ready",
        }),
      );

      startHeartbeat();
    });

    ws.on("pong", () => {
      lastPongAt = Date.now();
    });

    ws.on("message", (raw) => {
      let msg: { type?: string; data?: string; cols?: number; rows?: number };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "input" && typeof msg.data === "string") {
        spawnPtyIfNeeded();
        ptyProcess?.write(msg.data);
        return;
      }
      if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        spawnPtyIfNeeded();
        try {
          ptyProcess?.resize(msg.cols, msg.rows);
        } catch {
          // ignore resize errors on a dying pty
        }
      }
    });

    ws.on("close", (code: number) => {
      stopHeartbeat();
      if (closingManually) return;
      if (code === WS_CLOSE_AUTH_INVALID || code === WS_CLOSE_AUTH_REVOKED) {
        opts.onStatusChange?.(
          "error",
          `auth failed (code ${code}). Re-pair via /seed-terminal <CODE>.`,
        );
        killPty();
        return;
      }
      opts.onStatusChange?.("disconnected", `WebSocket closed (code ${code})`);
      scheduleReconnect();
    });

    ws.on("error", () => {
      // 'error' fires before 'close' on transport failures. Reconnect logic lives in 'close'.
    });
  }

  opts.onStatusChange?.("connecting");
  connect();

  return {
    close: () => {
      closingManually = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopHeartbeat();
      killPty();
      if (ws) {
        try {
          ws.close(1000, "manual close");
        } catch {
          // ignore
        }
      }
    },
    isConnected: () => ws?.readyState === WebSocket.OPEN,
    sessionId: opts.config.sessionId,
  };
}

// ---- Public registration ----

export function registerTerminal(pi: ExtensionAPI) {
  let active: BridgeHandle | null = null;

  function setStatus(
    ctx: ExtensionCommandContext | null,
    status: BridgeStatus,
    message?: string,
  ) {
    const text =
      status === "connected"
        ? "🖥 connected"
        : status === "reconnecting"
          ? `🖥 reconnecting${message ? ` (${message})` : ""}`
          : status === "connecting"
            ? "🖥 connecting…"
            : status === "error"
              ? `🖥 error${message ? `: ${message}` : ""}`
              : undefined;
    ctx?.ui.setStatus("terminal", text);
  }

  pi.registerCommand("seed-terminal", {
    description:
      "Bridge this machine's terminal to the Seed Network web app. With a code, claim a new pairing; without, reconnect the saved session.",
    handler: async (args, ctx) => {
      const arg = (args || "").trim();

      if (active?.isConnected()) {
        const restart = await ctx.ui.confirm(
          "Already connected",
          `Already connected to ${active.sessionId}. Disconnect and re-pair?`,
        );
        if (!restart) return;
        active.close();
        active = null;
      }

      const token = await getToken();
      if (!token) {
        ctx.ui.notify(
          "Run /seed-connect first (or set SEED_NETWORK_TOKEN).",
          "error",
        );
        return;
      }

      // No code: try saved config first, otherwise prompt for one.
      if (!arg) {
        const stored = await loadTerminalConfig();
        if (stored) {
          ctx.ui.notify(`Reconnecting to ${stored.sessionId}…`, "info");
          active = await createBridge({
            config: stored,
            onStatusChange: (status, message) => setStatus(ctx, status, message),
          });
          return;
        }
        const code = await ctx.ui.input(
          "Pairing code from browser:",
          "SEED-XXXX",
        );
        if (!code?.trim()) {
          ctx.ui.notify("Cancelled.", "info");
          return;
        }
        await claimAndStart(ctx, code.trim(), token);
        return;
      }

      await claimAndStart(ctx, arg, token);
    },
  });

  pi.registerCommand("seed-terminal-stop", {
    description: "Disconnect the local terminal bridge.",
    handler: async (_args, ctx) => {
      if (!active) {
        ctx.ui.notify("No active terminal bridge.", "info");
        return;
      }
      active.close();
      active = null;
      ctx.ui.setStatus("terminal", undefined);
      ctx.ui.notify("Terminal bridge disconnected.", "info");
    },
  });

  pi.registerCommand("seed-terminal-status", {
    description: "Show terminal bridge connection status.",
    handler: async (_args, ctx) => {
      const broker = await getBrokerHttpUrl();
      if (active?.isConnected()) {
        ctx.ui.notify(`🖥 Connected to ${active.sessionId} via ${broker.url}`, "info");
        return;
      }
      const stored = await loadTerminalConfig();
      if (stored) {
        ctx.ui.notify(
          `Saved session ${stored.sessionId}. Run /seed-terminal to reconnect, or /seed-terminal <CODE> to re-pair. New pair claims will use ${broker.url} (${broker.source}).`,
          "info",
        );
      } else {
        ctx.ui.notify(
          `No terminal bridge configured. Run /seed-terminal <CODE> to pair from the browser. Pair claims will use ${broker.url} (${broker.source}).`,
          "warning",
        );
      }
    },
  });

  pi.registerCommand("seed-terminal-forget", {
    description: "Clear the saved terminal session token.",
    handler: async (_args, ctx) => {
      if (active) {
        active.close();
        active = null;
      }
      const cleared = await clearTerminalConfig();
      ctx.ui.setStatus("terminal", undefined);
      ctx.ui.notify(
        cleared ? "Cleared saved terminal session." : "No saved terminal session.",
        "info",
      );
    },
  });

  pi.on("session_shutdown", async () => {
    if (active) {
      active.close();
      active = null;
    }
  });

  async function claimAndStart(
    ctx: ExtensionCommandContext,
    code: string,
    token: string,
  ): Promise<void> {
    const broker = await getBrokerHttpUrl();
    const brokerHttpUrl = broker.url;
    ctx.ui.notify(`Claiming pair code ${code} at ${brokerHttpUrl} (${broker.source})…`, "info");
    const claim = await claimPair({ brokerHttpUrl, token, code });
    if ("error" in claim) {
      ctx.ui.notify(claim.error, "error");
      return;
    }

    const config: TerminalConfig = {
      sessionId: claim.sessionId,
      bridgeToken: claim.bridgeToken,
      wsUrl: claim.wsUrl,
      brokerHttpUrl,
      fetchedAt: new Date().toISOString(),
    };
    await storeTerminalConfig({
      sessionId: claim.sessionId,
      bridgeToken: claim.bridgeToken,
      wsUrl: claim.wsUrl,
      brokerHttpUrl,
    });

    ctx.ui.notify(`✓ Paired ${claim.sessionId}`, "info");

    active = await createBridge({
      config,
      onStatusChange: (status, message) => setStatus(ctx, status, message),
    });
  }
}
