import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

// --- Rendering helpers ---

const TYPE_EMOJI: Record<string, string> = {
  twitter_account: "🐦",
  company: "🏢",
  person: "👤",
  blog: "📝",
  github_profile: "🐙",
  topic: "💡",
  newsletter: "📬",
  podcast: "🎙️",
  subreddit: "📢",
  custom: "📌",
};

// --- Handlers ---

export async function importSignals(args: {
  input: string;
  defaultType?: string;
  tags?: string[];
}) {
  try {
    const response = await api.post<any>("/signals/import", args);
    return {
      created: response.created,
      skipped: response.skipped,
      total: response.total,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function createSignal(args: {
  type: string;
  name: string;
  description?: string;
  externalUrl?: string;
  imageUrl?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  try {
    const response = await api.post<any>("/signals", args);
    return {
      id: response.signal.id,
      type: response.signal.type,
      name: response.signal.name,
      slug: response.signal.slug,
      tags: response.signal.tags,
      createdAt: response.signal.createdAt,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function batchCreateSignals(args: {
  signals: Array<{
    type: string;
    name: string;
    description?: string;
    externalUrl?: string;
    imageUrl?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }>;
}) {
  try {
    const response = await api.post<any>("/signals", { signals: args.signals });
    return {
      signals: response.signals.map((s: any) => ({ id: s.id, type: s.type, name: s.name, slug: s.slug, tags: s.tags })),
      count: response.signals.length,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function getSignal(args: { signalId?: string; slug?: string }) {
  try {
    const params: Record<string, string | undefined> = {};
    if (args.signalId) params.id = args.signalId;
    if (args.slug) params.slug = args.slug;
    const response = await api.get<any>("/signals", params);
    return { signal: response.signal };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function listSignals(args: { type?: string; tag?: string; limit?: number }) {
  try {
    const response = await api.get<any>("/signals", args);
    return { signals: response.signals, total: response.total };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function searchSignals(args: { query: string; limit?: number }) {
  try {
    const response = await api.get<any>("/signals", { search: args.query, limit: args.limit });
    return { signals: response.signals, total: response.total, query: args.query };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function deleteSignal(args: { signalId: string }) {
  try {
    const response = await api.delete<any>("/signals", { id: args.signalId });
    return { success: response.success, message: response.message };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function addSignalRelation(args: {
  sourceSignalId: string;
  targetSignalId: string;
  relationType: string;
}) {
  try {
    const response = await api.post<any>("/signals/relations", args);
    return {
      relationId: response.relation.id,
      sourceSignalId: response.relation.sourceSignalId,
      targetSignalId: response.relation.targetSignalId,
      relationType: response.relation.relationType,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

// --- Registration ---

const SignalTypeEnum = StringEnum([
  "twitter_account", "company", "person", "blog", "github_profile",
  "topic", "newsletter", "podcast", "subreddit", "custom",
] as const);

const SignalSchema = Type.Object({
  type: SignalTypeEnum,
  name: Type.String({ description: "Display name" }),
  description: Type.Optional(Type.String({ description: "Short description" })),
  externalUrl: Type.Optional(Type.String({ description: "Link to the tracked entity" })),
  imageUrl: Type.Optional(Type.String({ description: "Avatar/logo URL" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Freeform tags for clustering" })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Type-specific flexible fields" })),
});

export function registerSignalTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "import_signals",
    label: "Import Signals",
    description: "Bulk import signals from raw text. Paste in Twitter/X URLs, @handles, GitHub URLs, or any mix — one per line or comma-separated. Parses, deduplicates, and creates all signals server-side in one fast operation. Returns only counts (created/skipped). Use this instead of batch_create_signals for large imports.",
    parameters: Type.Object({
      input: Type.String({ description: "Raw text containing URLs, @handles, or names to import — one per line or comma-separated" }),
      defaultType: Type.Optional(SignalTypeEnum),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Tags to apply to all imported signals" })),
    }),
    execute: wrapExecute(importSignals),
    renderCall(args: any, theme: any) {
      const lines = (args.input || "").split(/[\n,]+/).filter((l: string) => l.trim()).length;
      let text = theme.fg("toolTitle", theme.bold("import_signals "));
      text += theme.fg("muted", `${lines} items`);
      if (args.tags?.length) text += theme.fg("dim", ` [${args.tags.join(", ")}]`);
      return new Text(text, 0, 0);
    },
    renderResult(result: any, { expanded }: any, theme: any) {
      if (result.isError) return new Text(theme.fg("error", result.content?.[0]?.text || "Error"), 0, 0);
      const d = result.details || {};
      let text = theme.fg("success", `✓ ${d.created ?? 0} created`);
      if (d.skipped) text += theme.fg("dim", `, ${d.skipped} skipped`);
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "create_signal",
    label: "Create Signal",
    description: "Create a new signal in Seed Network. Signals track entities worth watching: Twitter accounts, blogs, topics, people, etc.",
    parameters: SignalSchema,
    execute: wrapExecute(createSignal),
    renderCall(args: any, theme: any) {
      const emoji = TYPE_EMOJI[args.type] || "📌";
      let text = theme.fg("toolTitle", theme.bold("create_signal "));
      text += `${emoji} ${theme.fg("accent", args.name)}`;
      text += theme.fg("dim", ` (${args.type})`);
      return new Text(text, 0, 0);
    },
    renderResult(result: any, _opts: any, theme: any) {
      if (result.isError) return new Text(theme.fg("error", result.content?.[0]?.text || "Error"), 0, 0);
      const d = result.details || {};
      const emoji = TYPE_EMOJI[d.type] || "📌";
      return new Text(theme.fg("success", `✓ ${emoji} ${d.name || "created"}`), 0, 0);
    },
  });

  pi.registerTool({
    name: "batch_create_signals",
    label: "Batch Create Signals",
    description: "Create multiple signals at once. Useful for importing lists of accounts, topics, etc.",
    parameters: Type.Object({
      signals: Type.Array(SignalSchema, { description: "Array of signals to create" }),
    }),
    execute: wrapExecute(batchCreateSignals),
    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("batch_create_signals "));
      text += theme.fg("muted", `${args.signals?.length || 0} signals`);
      return new Text(text, 0, 0);
    },
    renderResult(result: any, { expanded }: any, theme: any) {
      if (result.isError) return new Text(theme.fg("error", result.content?.[0]?.text || "Error"), 0, 0);
      const d = result.details || {};
      let text = theme.fg("success", `✓ ${d.count ?? 0} created`);
      if (expanded && d.signals?.length) {
        for (const s of d.signals) {
          const emoji = TYPE_EMOJI[s.type] || "📌";
          text += `\n  ${emoji} ${s.name}`;
        }
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "get_signal",
    label: "Get Signal",
    description: "Get a specific signal by ID or slug.",
    parameters: Type.Object({
      signalId: Type.Optional(Type.String({ description: "Signal ID" })),
      slug: Type.Optional(Type.String({ description: "Signal slug" })),
    }),
    execute: wrapExecute(getSignal),
  });

  pi.registerTool({
    name: "list_signals",
    label: "List Signals",
    description: "List signals with optional filters by type or tag.",
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: "Filter by signal type" })),
      tag: Type.Optional(Type.String({ description: "Filter by tag" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(listSignals),
    renderCall(args: any, theme: any) {
      let text = theme.fg("toolTitle", theme.bold("list_signals"));
      if (args.type) text += theme.fg("dim", ` type=${args.type}`);
      if (args.tag) text += theme.fg("dim", ` tag=${args.tag}`);
      return new Text(text, 0, 0);
    },
    renderResult(result: any, { expanded }: any, theme: any) {
      if (result.isError) return new Text(theme.fg("error", result.content?.[0]?.text || "Error"), 0, 0);
      const d = result.details || {};
      let text = theme.fg("muted", `${d.total ?? 0} signals`);
      if (d.signals?.length) {
        for (const s of d.signals.slice(0, expanded ? 50 : 10)) {
          const emoji = TYPE_EMOJI[s.type] || "📌";
          text += `\n  ${emoji} ${s.name}`;
          if (s.tags?.length) text += theme.fg("dim", ` [${s.tags.join(", ")}]`);
        }
        if (!expanded && d.signals.length > 10) {
          text += theme.fg("dim", `\n  ... and ${d.signals.length - 10} more`);
        }
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "search_signals",
    label: "Search Signals",
    description: "Full-text search across signals. Searches name, description, and slug.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(searchSignals),
    renderCall(args: any, theme: any) {
      return new Text(
        theme.fg("toolTitle", theme.bold("search_signals ")) + theme.fg("accent", `"${args.query}"`),
        0, 0
      );
    },
    renderResult(result: any, { expanded }: any, theme: any) {
      if (result.isError) return new Text(theme.fg("error", result.content?.[0]?.text || "Error"), 0, 0);
      const d = result.details || {};
      if (!d.signals?.length) return new Text(theme.fg("dim", `No results for "${d.query}"`), 0, 0);
      let text = theme.fg("muted", `${d.total} results for "${d.query}":`);
      for (const s of d.signals.slice(0, expanded ? 50 : 10)) {
        const emoji = TYPE_EMOJI[s.type] || "📌";
        text += `\n  ${emoji} ${s.name}`;
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "delete_signal",
    label: "Delete Signal",
    description: "Delete a signal by ID. Only the creator or a curator can delete.",
    parameters: Type.Object({
      signalId: Type.String({ description: "ID of the signal to delete" }),
    }),
    execute: wrapExecute(deleteSignal),
  });

  pi.registerTool({
    name: "add_signal_relation",
    label: "Add Signal Relation",
    description: "Create a relation between two signals (e.g., 'founded_by', 'works_at', 'covers_topic').",
    parameters: Type.Object({
      sourceSignalId: Type.String({ description: "Source signal ID" }),
      targetSignalId: Type.String({ description: "Target signal ID" }),
      relationType: Type.String({ description: "Relation type (e.g., 'founded_by', 'works_at', 'related_to')" }),
    }),
    execute: wrapExecute(addSignalRelation),
  });
}
