import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { api, NotConnectedError } from "../api-client";

const actionItemTypes = [
  "intro_request",
  "follow_up",
  "response_needed",
  "approval_needed",
  "task",
  "custom",
] as const;

function notConnectedResult() {
  return {
    content: [{ type: "text" as const, text: "Not connected to Seed Network. Run /seed-connect." }],
    isError: true,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function jsonResult(data: any) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// --- Renderers ---

function renderCreateCall(args: any, theme: any): Text {
  const isBatch = !!args.actions;
  const count = isBatch ? args.actions.length : 1;
  let text = theme.fg("toolTitle", theme.bold("create_action_items"));
  text += theme.fg("dim", ` (${count} item${count !== 1 ? "s" : ""})`);
  return new Text(text, 0, 0);
}

function renderCreateResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) {
    return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
  }

  const actions = details?.actions || (details?.action ? [details.action] : []);
  const batchId = details?.batchId;

  let text = theme.fg("success", `✓ Created ${actions.length} action item${actions.length !== 1 ? "s" : ""}`);
  if (batchId) text += theme.fg("dim", ` (batch: ${batchId.slice(0, 12)}…)`);

  if (expanded) {
    for (const a of actions) {
      const typeLabel = a.type.replace(/_/g, " ");
      text += "\n  " + theme.fg("accent", typeLabel) + " " + a.title;
    }
  } else if (actions.length > 0) {
    const preview = actions.slice(0, 3).map((a: any) => a.title).join("; ");
    text += theme.fg("dim", ` — ${preview}`);
  }

  return new Text(text, 0, 0);
}

function renderPollCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("poll_action_responses"));
  if (args.batchId) text += theme.fg("dim", ` batch: ${args.batchId.slice(0, 12)}…`);
  return new Text(text, 0, 0);
}

function renderPollResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) {
    return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
  }

  const actions = details?.actions || [];
  if (actions.length === 0) {
    return new Text(theme.fg("dim", "No responses yet"), 0, 0);
  }

  const approved = actions.filter((a: any) => a.status === "approved").length;
  const rejected = actions.filter((a: any) => a.status === "rejected").length;
  const custom = actions.filter((a: any) => a.status === "custom_response").length;

  let text = theme.fg("success", `✓ ${actions.length} response${actions.length !== 1 ? "s" : ""}: `);
  const parts = [];
  if (approved) parts.push(theme.fg("success", `${approved} approved`));
  if (rejected) parts.push(theme.fg("error", `${rejected} rejected`));
  if (custom) parts.push(theme.fg("warning", `${custom} custom`));
  text += parts.join(", ");

  if (expanded) {
    for (const a of actions) {
      const statusIcon =
        a.status === "approved" ? "✓" : a.status === "rejected" ? "✗" : "✎";
      const statusColor =
        a.status === "approved" ? "success" : a.status === "rejected" ? "error" : "warning";
      text += "\n  " + theme.fg(statusColor, statusIcon) + " " + a.title;
      if (a.userResponse) {
        text += "\n    " + theme.fg("dim", `Response: ${a.userResponse}`);
      }
    }
  }

  return new Text(text, 0, 0);
}

// --- Tool Registration ---

export function registerActionTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "create_action_items",
    label: "Create Action Items",
    description:
      "Create action items that surface in the Seed Network webapp for the user to approve, reject, or customize. " +
      "Use after telegram digests, signal tending, or any workflow that produces actionable items. " +
      "Accepts a single action or a batch. Each action has a type, title, optional description, " +
      "suggested action, source context, and an agent command to execute when approved.",
    parameters: Type.Object({
      actions: Type.Array(
        Type.Object({
          type: StringEnum(actionItemTypes, {
            description:
              "Action type: intro_request, follow_up, response_needed, approval_needed, task, custom",
          }),
          title: Type.String({
            description: "Short summary shown in card, e.g. 'Alice asked for intro to Bob'",
          }),
          description: Type.Optional(
            Type.String({ description: "Additional context" })
          ),
          suggestedAction: Type.Optional(
            Type.String({
              description: "What the agent proposes to do when approved",
            })
          ),
          sourceContext: Type.Optional(
            Type.Object({
              platform: Type.Optional(Type.String()),
              chatName: Type.Optional(Type.String()),
              messageIds: Type.Optional(Type.Array(Type.Number())),
              people: Type.Optional(Type.Array(Type.String())),
              urls: Type.Optional(Type.Array(Type.String())),
            })
          ),
          agentCommand: Type.Optional(
            Type.Object({
              tool: Type.Optional(
                Type.String({ description: "Tool to call when approved" })
              ),
              args: Type.Optional(
                Type.Record(Type.String(), Type.Unknown(), {
                  description: "Tool arguments",
                })
              ),
              prompt: Type.Optional(
                Type.String({
                  description: "Freeform prompt for the agent to execute",
                })
              ),
            })
          ),
        }),
        { description: "Array of action items to create (max 50)" }
      ),
    }),
    renderCall: renderCreateCall,
    renderResult: renderCreateResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        if (params.actions.length === 1) {
          const result = await api.post("/actions", params.actions[0]);
          return jsonResult(result);
        }
        const result = await api.post("/actions", { actions: params.actions });
        return jsonResult(result);
      } catch (e) {
        if (e instanceof NotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "poll_action_responses",
    label: "Poll Action Responses",
    description:
      "Check for user responses to previously created action items. " +
      "Returns items that have been approved, rejected, or given custom responses " +
      "but not yet acknowledged by the agent. After processing responses, " +
      "acknowledge them so they don't appear again.",
    parameters: Type.Object({
      batchId: Type.Optional(
        Type.String({ description: "Filter by batch ID" })
      ),
      acknowledge: Type.Optional(
        Type.Boolean({
          description:
            "Auto-acknowledge all returned responses (default: true)",
          default: true,
        })
      ),
    }),
    renderCall: renderPollCall,
    renderResult: renderPollResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        // Fetch unacknowledged responses
        const queryParams: Record<string, string> = {
          unacknowledged: "true",
        };
        if (params.batchId) queryParams.batchId = params.batchId;

        const result = await api.get<{ actions: any[] }>("/actions", queryParams);

        // Auto-acknowledge if requested (default: true)
        if (params.acknowledge !== false && result.actions.length > 0) {
          const ids = result.actions.map((a) => a.id);
          await api.patch("/actions", { ids });
        }

        return jsonResult(result);
      } catch (e) {
        if (e instanceof NotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });
}
