/**
 * Pi Session Mirror — connects outbound to a WebSocket relay server,
 * streaming all session events in real-time.
 *
 * The relay runs on Railway/Fly/etc. Browsers connect to the same relay
 * to receive the events. Full bidirectional WebSocket, zero polling.
 *
 * Configuration is loaded from ~/.config/seed-network/mirror (written by /seed-connect)
 * or from environment variables as a fallback:
 *   PI_MIRROR_URL     - Relay WebSocket URL
 *   PI_MIRROR_TOKEN   - Auth token (scoped bridge HMAC token)
 *   PI_MIRROR_SESSION - Session grouping key (default: "default")
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WebSocket } from "ws";
import { getMirrorConfig } from "./auth";

interface MirrorEvent {
  type: string;
  timestamp: number;
  sessionId?: string;
  payload: Record<string, unknown>;
}

// --- Reconnect backoff ---

const BASE_DELAY = 1000;
const MAX_DELAY = 30_000;
const JITTER = 0.3;

function backoffDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY);
  const jitter = delay * JITTER * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

// --- Heartbeat ---

const HEARTBEAT_INTERVAL = 30_000; // Check every 30s (matches relay ping interval)

// Shared emitter — set by registerMirror, used by tools to push events
let sharedEmit: ((type: string, payload: Record<string, unknown>) => void) | null = null;

/**
 * Emit an event through the relay bridge (e.g., action_completed).
 * No-op if mirror is not connected or not registered yet.
 */
export function emitRelayEvent(type: string, payload: Record<string, unknown>) {
  sharedEmit?.(type, payload);
}

// Shared clear function — set by registerMirror, used to clear in-flight after acknowledgement
let sharedClearInFlight: ((ids: string[]) => void) | null = null;

/**
 * Clear in-flight tracking for the given step IDs (called after acknowledge_actions succeeds).
 */
export function clearInFlightSteps(ids: string[]) {
  sharedClearInFlight?.(ids);
}

export function registerMirror(pi: ExtensionAPI) {
  let relayUrl = "";
  let token = "";
  let mirrorSession = "default";

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempt = 0;
  let sessionId: string | undefined;
  let connected = false;
  let queue: MirrorEvent[] = [];
  let alive = false;
  let piCtx: any = null;

  // Track in-flight step IDs to prevent duplicate execution.
  // A step is added when we inject the followUp message, and removed
  // when it's acknowledged via acknowledge_actions or after a timeout.
  const inFlightSteps = new Set<string>();
  const IN_FLIGHT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  function markInFlight(stepId: string) {
    inFlightSteps.add(stepId);
    setTimeout(() => inFlightSteps.delete(stepId), IN_FLIGHT_TTL_MS);
  }

  // --- Handle incoming messages from relay (e.g., approved actions) ---

  function handleRelayMessage(raw: string) {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "execute_action") {
        handleApprovedAction(msg.payload);
      } else if (msg.type === "user_prompt") {
        handleUserPrompt(msg.payload);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  function handleApprovedAction(action: {
    id: string;
    title: string;
    type: string;
    agentCommand?: {
      tool?: string;
      args?: Record<string, unknown>;
      prompt?: string;
    };
    userResponse?: string;
  }) {
    if (!action.agentCommand) return;

    // Dedup: skip if this step is already in-flight (e.g., replay after reconnect
    // while the agent is already executing it from a prior push or poll)
    if (inFlightSteps.has(action.id)) return;
    markInFlight(action.id);

    const { tool, args, prompt } = action.agentCommand;

    const ackInstructions =
      `After execution, acknowledge the action by calling acknowledge_actions with id "${action.id}" and include a result:\n` +
      `- results: { "${action.id}": { status: "success", summary: "<what happened>", toolName: "${tool || "agent"}" } }\n` +
      `- If it failed: { "${action.id}": { status: "error", error: "<what went wrong>", toolName: "${tool || "agent"}" } }`;

    let message: string;
    if (prompt) {
      message = `[Approved Action "${action.title}" (${action.id})]\n\n${prompt}\n\nThis action was pre-approved by the user. Execute it directly without asking for additional confirmation. When calling tools that normally require confirmation (like telegram_send), pass confirmed: true to skip the confirmation dialog.\n\n${ackInstructions}`;
    } else if (tool && args) {
      // Inject confirmed: true for tools that have interactive confirmation dialogs.
      // The user already approved this action in the webapp — skip the pi-side prompt.
      const CONFIRMABLE_TOOLS = ["telegram_send", "telegram_create_group", "telegram_leave_chat"];
      const execArgs = CONFIRMABLE_TOOLS.includes(tool) ? { ...args, confirmed: true } : args;
      message = `[Approved Action "${action.title}" (${action.id})]\n\nThe user approved this action. Execute it now by calling the \`${tool}\` tool with these arguments:\n${JSON.stringify(execArgs, null, 2)}\n\nThis was pre-approved — do not ask for confirmation.\n\n${ackInstructions}`;
    } else {
      return;
    }

    if (action.userResponse) {
      message += `\n\nUser's note: "${action.userResponse}"`;
    }

    pi.sendUserMessage(message, { deliverAs: "followUp" });
  }

  function handleUserPrompt(payload: { text?: string }) {
    if (!payload.text?.trim()) return;
    pi.sendUserMessage(payload.text.trim(), { deliverAs: "followUp" });
  }

  // --- Connection management ---

  function updateStatus() {
    if (piCtx?.hasUI) {
      piCtx.ui.setStatus("mirror", connected ? "🪞 mirror" : undefined);
    }
  }

  function buildUrl() {
    const params = new URLSearchParams({
      role: "bridge",
      session: mirrorSession,
    });
    if (token) params.set("token", token);
    return `${relayUrl}?${params}`;
  }

  async function loadConfig(): Promise<boolean> {
    const config = await getMirrorConfig();
    if (!config) return false;

    relayUrl = config.relayUrl;
    token = config.token;
    mirrorSession = config.session;
    return true;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (!alive) {
        // No pong since last check — connection is dead
        ws.terminate();
        return;
      }

      // Reset and ping
      alive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function connect() {
    try {
      const hasConfig = await loadConfig();
      if (!hasConfig) {
        // No config — silently skip (user hasn't run /seed-connect or isn't a curator)
        return;
      }

      ws = new WebSocket(buildUrl());

      ws.on("open", () => {
        connected = true;
        alive = true;
        reconnectAttempt = 0;
        updateStatus();
        startHeartbeat();

        // Flush queued events
        for (const msg of queue) {
          doSend(msg);
        }
        queue = [];
      });

      ws.on("message", (data) => {
        handleRelayMessage(typeof data === "string" ? data : data.toString());
      });

      ws.on("pong", () => {
        alive = true;
      });

      ws.on("close", () => {
        connected = false;
        ws = null;
        stopHeartbeat();
        updateStatus();
        scheduleReconnect();
      });

      ws.on("error", () => {
        connected = false;
        // error event prevents unhandled exception; close event handles reconnect
      });
    } catch {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = backoffDelay(reconnectAttempt++);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
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

  // Expose emit and clearInFlight to other modules
  sharedEmit = emit;
  sharedClearInFlight = (ids: string[]) => {
    for (const id of ids) inFlightSteps.delete(id);
  };

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopHeartbeat();
    if (ws) {
      ws.close();
      ws = null;
    }
    connected = false;
    reconnectAttempt = 0;
  }

  /** Disconnect, re-read config, and reconnect. Called after /seed-connect. */
  function reconnect() {
    disconnect();
    connect();
  }

  // Listen for reconnect signal from /seed-connect via pi event bus
  pi.events.on("seed:mirror:reconnect", reconnect);

  // --- Pi event hooks ---

  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId?.() ?? undefined;
    piCtx = ctx;

    const entries = ctx.sessionManager.getEntries();
    let messageCount = 0;
    for (const entry of entries) {
      if (entry.type === "message") messageCount++;
    }

    emit("session_start", {
      sessionFile: ctx.sessionManager.getSessionFile?.() ?? null,
      messageCount,
      cwd: ctx.cwd,
    });

    updateStatus();
  });

  pi.on("session_shutdown", async () => {
    emit("session_shutdown", {});
    await new Promise((r) => setTimeout(r, 200));
    disconnect();
  });

  pi.on("session_switch", async (event) => {
    // Re-stash context on session switch
    piCtx = null; // Will be set again on next session_start
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
