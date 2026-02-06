import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

// --- Handlers ---

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
    name: "create_signal",
    label: "Create Signal",
    description: "Create a new signal in Seed Network. Signals track entities worth watching: Twitter accounts, blogs, topics, people, etc.",
    parameters: SignalSchema,
    execute: wrapExecute(createSignal),
  });

  pi.registerTool({
    name: "batch_create_signals",
    label: "Batch Create Signals",
    description: "Create multiple signals at once. Useful for importing lists of accounts, topics, etc.",
    parameters: Type.Object({
      signals: Type.Array(SignalSchema, { description: "Array of signals to create" }),
    }),
    execute: wrapExecute(batchCreateSignals),
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
