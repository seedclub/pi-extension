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
 *   PI_MIRROR_TOKEN   - Auth token (should match relay's PI_MIRROR_TOKEN)
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

export function registerMirror(pi: ExtensionAPI) {
  let relayUrl = "";
  let token = "";
  let mirrorSession = "default";

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionId: string | undefined;
  let connected = false;
  let queue: MirrorEvent[] = [];
  let alive = false;
  let piCtx: any = null; // Stash context for status updates

  // --- Handle incoming messages from relay (e.g., approved actions) ---

  function handleRelayMessage(raw: string) {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "execute_action") {
        handleApprovedAction(msg.payload);
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

    const { tool, args, prompt } = action.agentCommand;

    let message: string;
    if (prompt) {
      message = `[Approved Action "${action.title}" (${action.id})]\n\n${prompt}\n\nThis action was pre-approved by the user. Execute it directly without asking for additional confirmation. When calling tools that normally require confirmation (like telegram_send), pass confirmed: true to skip the confirmation dialog. After execution, acknowledge the action by calling acknowledge_actions with id "${action.id}".`;
    } else if (tool && args) {
      // Format args, injecting confirmed: true for tools that support it
      const execArgs = tool === "telegram_send" ? { ...args, confirmed: true } : args;
      message = `[Approved Action "${action.title}" (${action.id})]\n\nThe user approved this action. Execute it now by calling the \`${tool}\` tool with these arguments:\n${JSON.stringify(execArgs, null, 2)}\n\nThis was pre-approved — do not ask for confirmation. After execution, acknowledge the action by calling acknowledge_actions with id "${action.id}".`;
    } else {
      return;
    }

    if (action.userResponse) {
      message += `\n\nUser's note: "${action.userResponse}"`;
    }

    pi.sendUserMessage(message, { deliverAs: "followUp" });
  }

  // --- Connection management ---

  function updateStatus() {
    if (piCtx?.hasUI) {
      piCtx.ui.setStatus("mirror", connected ? "🪞 mirror" : "🪞 mirror (connecting...)");
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
        updateStatus();

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
    piCtx = ctx; // Stash for status updates on connect/disconnect

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

    updateStatus();
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

  // --- Public API for reconnecting after config changes ---

  /** Disconnect, re-read config, and reconnect. Called after /seed-connect. */
  function reconnect() {
    disconnect();
    connect();
  }

  // Expose on the pi instance so /seed-connect can trigger it
  (pi as any)._mirrorReconnect = reconnect;

  // --- Start ---
  connect();
}
