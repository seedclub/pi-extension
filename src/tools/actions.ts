import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { api, NotConnectedError } from "../api-client";
import { emitRelayEvent, clearInFlightSteps } from "../mirror";

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
      "suggested action, source context, and an agent command to execute when approved.\n\n" +
      "Multi-step workflows: steps sharing a workflowId are sequentially gated — " +
      "step N cannot be approved until step N-1 is completed. " +
      "If a step is rejected, all downstream steps are automatically archived. " +
      "Use idempotencyKey to safely retry creation without duplicates.",
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
          // Workflow chaining — use these to create multi-step sequential workflows.
          // The first step generates a workflowId; subsequent steps reuse it with incrementing stepIndex.
          // If workflowId is omitted, the server auto-generates one (every action belongs to a workflow).
          workflowId: Type.Optional(
            Type.String({
              description:
                "Workflow ID grouping multi-step actions. Generate one for step 0, reuse for subsequent steps.",
            })
          ),
          stepIndex: Type.Optional(
            Type.Number({
              description: "0-based step position in the workflow (0 = first step)",
            })
          ),
          idempotencyKey: Type.Optional(
            Type.String({
              description:
                "Unique key to prevent duplicate creation on retries. " +
                "If a step with this key already exists, the existing step is returned.",
            })
          ),
          // Phase label — groups steps within a workflow into named phases.
          // E.g., "intro", "meeting", "deal", "follow-up". Steps with the same
          // phase are visually grouped in the UI. A workflow can span multiple phases.
          phase: Type.Optional(
            Type.String({
              description: 'Phase label for this step: "intro", "meeting", "deal", "follow-up", etc.',
            })
          ),
          // Workflow metadata — set on the first step to define display metadata for the whole workflow.
          // Can be updated later by providing it on a subsequent step (e.g., to update the oneLiner).
          workflowMetadata: Type.Optional(
            Type.Object({
              label: Type.String({
                description: "Workflow label, typically the contact or company name (e.g., 'Alice (Acme Corp)')",
              }),
              oneLiner: Type.String({
                description: "Short context summary (e.g., 'Pre-seed climate tech, via Bob')",
              }),
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
        let result: any;
        if (params.actions.length === 1) {
          result = await api.post("/workflows", params.actions[0]);
        } else {
          result = await api.post("/workflows", { actions: params.actions });
        }

        // Emit relay event so the webapp can instantly refresh action items
        const createdActions = result.actions || (result.action ? [result.action] : []);
        if (createdActions.length > 0) {
          emitRelayEvent("actions_created", {
            count: createdActions.length,
            ids: createdActions.map((a: any) => a.id),
            batchId: result.batchId || null,
          });
        }

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
            "Auto-acknowledge all returned responses. Set to false (default) to acknowledge " +
            "after execution to avoid losing items if the agent crashes mid-execution.",
          default: false,
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

        const result = await api.get<{ actions: any[] }>("/workflows", queryParams);

        // Auto-acknowledge only if explicitly requested (default: false)
        if (params.acknowledge === true && result.actions.length > 0) {
          const ids = result.actions.map((a) => a.id);
          await api.patch("/workflows", { ids });
        }

        return jsonResult(result);
      } catch (e) {
        if (e instanceof NotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "acknowledge_actions",
    label: "Acknowledge Actions",
    description:
      "Mark action items as acknowledged after the agent has executed them. " +
      "Call this AFTER successfully executing approved actions to prevent them " +
      "from appearing again on the next poll. Pass the IDs of the items that " +
      "were successfully processed, along with execution results.\n\n" +
      "Each result should include:\n" +
      "- status: 'success' or 'error'\n" +
      "- summary: human-readable result (e.g., 'Message sent to Platform Discussion')\n" +
      "- data: tool-specific return data (e.g., { messageId: 20563 })\n" +
      "- error: error message if status is 'error'\n" +
      "- toolName: which tool was executed",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: "IDs of action items to acknowledge",
      }),
      results: Type.Optional(
        Type.Record(
          Type.String(),
          Type.Object({
            status: StringEnum(["success", "error"], {
              description: "Whether execution succeeded or failed",
            }),
            summary: Type.Optional(
              Type.String({ description: "Human-readable result summary" })
            ),
            data: Type.Optional(
              Type.Record(Type.String(), Type.Unknown(), {
                description: "Tool-specific return data",
              })
            ),
            error: Type.Optional(
              Type.String({ description: "Error message if failed" })
            ),
            toolName: Type.Optional(
              Type.String({ description: "Which tool was executed" })
            ),
          }),
          { description: "Map of action ID → execution result" }
        )
      ),
    }),
    renderCall: (args: any, theme: any) => {
      const count = args.ids?.length || 0;
      const hasResults = !!args.results;
      let text = theme.fg("toolTitle", theme.bold("acknowledge_actions"));
      text += theme.fg("dim", ` (${count} item${count !== 1 ? "s" : ""}${hasResults ? " with results" : ""})`);
      return new Text(text, 0, 0);
    },
    renderResult: (result: any, _opts: any, theme: any) => {
      const details = result.details;
      if (details?.error) {
        return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
      }

      const actions = details?.actions || [];
      const succeeded = actions.filter((a: any) => a.status === "completed").length;
      const failed = actions.filter((a: any) => a.status === "failed").length;

      let text = theme.fg("success", `✓ Acknowledged ${details?.acknowledged || 0} of ${details?.total || 0} items`);
      if (succeeded || failed) {
        const parts = [];
        if (succeeded) parts.push(theme.fg("success", `${succeeded} completed`));
        if (failed) parts.push(theme.fg("error", `${failed} failed`));
        text += theme.fg("dim", ` (${parts.join(", ")})`);
      }

      return new Text(text, 0, 0);
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        if (!params.ids.length) {
          return jsonResult({ acknowledged: 0, total: 0, message: "No IDs provided" });
        }

        const body: Record<string, unknown> = { ids: params.ids };
        if (params.results) {
          body.results = params.results;
        }

        const result = await api.patch<{
          acknowledged: number;
          total: number;
          actions: Array<{
            id: string;
            status: string;
            executionStatus: string | null;
            executionResult: Record<string, unknown> | null;
          }>;
        }>("/workflows", body);

        // Clear in-flight tracking for acknowledged steps
        clearInFlightSteps(params.ids);

        // Emit completion events through relay so webapp gets instant feedback
        if (result.actions) {
          for (const action of result.actions) {
            const execResult = params.results?.[action.id];
            emitRelayEvent(
              action.status === "failed" ? "action_failed" : "action_completed",
              {
                id: action.id,
                status: action.status,
                executionStatus: action.executionStatus,
                executionResult: action.executionResult,
                ...(execResult?.summary && { summary: execResult.summary }),
                ...(execResult?.error && { error: execResult.error }),
              }
            );
          }
        }

        return jsonResult(result);
      } catch (e) {
        if (e instanceof NotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });
}
