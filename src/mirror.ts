/**
 * Pi Session Mirror — connects outbound to a WebSocket relay server,
 * streaming all session events in real-time.
 *
 * The relay runs on Railway. Browsers connect to the same relay
 * to receive the events. Full bidirectional WebSocket, zero polling.
 *
 * Config resolution:
 *   1. Relay URL: PI_MIRROR_URL env var, or hardcoded default
 *   2. Auth token: PI_MIRROR_TOKEN env var, or Seed Network stored token
 *   3. Session key: PI_MIRROR_SESSION env var, or "default"
 *
 * For end users, no env vars needed — the relay URL is a known constant
 * and the auth token comes from /seed-connect credentials.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WebSocket } from "ws";
import { getToken } from "./auth";
import { getCurrentUser } from "./tools/utility";

const DEFAULT_RELAY_URL = "wss://websocket-relay-production-a818.up.railway.app";

interface MirrorEvent {
  type: string;
  timestamp: number;
  sessionId?: string;
  payload: Record<string, unknown>;
}

export async function registerMirror(pi: ExtensionAPI) {
  const relayUrl = process.env.PI_MIRROR_URL || DEFAULT_RELAY_URL;
  const token = process.env.PI_MIRROR_TOKEN || (await getToken()) || "";

  // Use seed network user ID as session key so each user gets their own channel.
  // Falls back to PI_MIRROR_SESSION env var or "default" for local dev.
  let mirrorSession = process.env.PI_MIRROR_SESSION || "default";
  if (!process.env.PI_MIRROR_SESSION) {
    try {
      const user = await getCurrentUser();
      if ("id" in user && user.id) {
        mirrorSession = user.id;
      }
    } catch {
      // Not connected to seed network — use default
    }
  }



  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionId: string | undefined;
  let connected = false;
  let queue: MirrorEvent[] = [];
  let alive = false;

  // --- Connection management ---

  function buildUrl() {
    const params = new URLSearchParams({
      role: "bridge",
      session: mirrorSession,
    });
    if (token) params.set("token", token);
    return `${relayUrl}?${params}`;
  }

  function connect() {
    try {
      ws = new WebSocket(buildUrl());

      ws.on("open", () => {
        connected = true;
        alive = true;

        // Flush queued events
        for (const msg of queue) {
          doSend(msg);
        }
        queue = [];
      });

      ws.on("pong", () => {
        alive = true;
      });

      ws.on("close", () => {
        connected = false;
        ws = null;
        scheduleReconnect();
      });

      ws.on("error", () => {
        connected = false;
      });
    } catch {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function doSend(event: MirrorEvent) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  function emit(type: string, payload: Record<string, unknown> = {}) {
    const event: MirrorEvent = {
      type,
      timestamp: Date.now(),
      sessionId,
      payload,
    };

    if (connected && ws?.readyState === WebSocket.OPEN) {
      doSend(event);
    } else {
      // Queue up to 200 events while disconnected
      if (queue.length < 200) {
        queue.push(event);
      }
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    connected = false;
  }

  // --- Pi event hooks ---

  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId?.() ?? undefined;

    const entries = ctx.sessionManager.getEntries();
    const messages: unknown[] = [];
    for (const entry of entries) {
      if (entry.type === "message") {
        messages.push(entry.message);
      }
    }

    emit("session_start", {
      sessionFile: ctx.sessionManager.getSessionFile?.() ?? null,
      messageCount: messages.length,
      messages: messages as unknown as Record<string, unknown>,
      cwd: ctx.cwd,
    });

    if (ctx.hasUI) {
      ctx.ui.setStatus("mirror", connected ? "🪞 mirror" : "🪞 mirror (connecting...)");
    }
  });

  pi.on("session_shutdown", async () => {
    emit("session_shutdown", {});
    // Give a moment for the final event to send
    await new Promise((r) => setTimeout(r, 200));
    disconnect();
  });

  pi.on("session_switch", async (event) => {
    emit("session_switch", {
      reason: event.reason,
      previousSessionFile: event.previousSessionFile,
    });
  });

  pi.on("session_compact", async (event) => {
    emit("session_compact", { fromExtension: event.fromExtension });
  });

  pi.on("agent_start", async () => {
    emit("agent_start", {});
  });

  pi.on("agent_end", async (event) => {
    emit("agent_end", {
      messages: event.messages as unknown as Record<string, unknown>,
    });
  });

  pi.on("turn_start", async (event) => {
    emit("turn_start", { turnIndex: event.turnIndex });
  });

  pi.on("turn_end", async (event) => {
    emit("turn_end", {
      turnIndex: event.turnIndex,
      message: event.message as unknown as Record<string, unknown>,
      toolResults: event.toolResults as unknown as Record<string, unknown>,
    });
  });

  pi.on("input", async (event) => {
    emit("input", {
      text: event.text,
      source: event.source,
      hasImages: !!(event.images && event.images.length > 0),
    });
    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event) => {
    emit("before_agent_start", {
      prompt: event.prompt,
      hasImages: !!(event.images && event.images.length > 0),
    });
  });

  pi.on("tool_call", async (event) => {
    emit("tool_call", {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input as Record<string, unknown>,
    });
  });

  pi.on("tool_result", async (event) => {
    emit("tool_result", {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      content: event.content as unknown as Record<string, unknown>,
      details: event.details as unknown as Record<string, unknown>,
      isError: event.isError,
    });
  });

  pi.on("context", async (event) => {
    emit("context", { messageCount: event.messages.length });
  });

  pi.on("model_select", async (event) => {
    emit("model_select", {
      model: event.model
        ? { id: event.model.id, name: event.model.name, provider: event.model.provider }
        : null,
      previousModel: event.previousModel
        ? { id: event.previousModel.id, name: event.previousModel.name, provider: event.previousModel.provider }
        : null,
      source: event.source,
    });
  });

  // --- Start ---
  connect();
}
