import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

// --- Handlers ---

export async function createEvent(args: {
  signalId: string;
  type: string;
  title: string;
  summary?: string;
  relatedSignalIds?: string[];
  sourceUrl?: string;
  sourceUrls?: string[];
  metadata?: Record<string, unknown>;
  confidence?: number;
  importance?: number;
  dedupeKey?: string;
  occurredAt?: string;
  source?: string;
}) {
  try {
    const response = await api.post<any>("/events", { ...args, source: args.source || "agent" });
    return {
      id: response.event.id,
      signalId: response.event.signalId,
      type: response.event.type,
      title: response.event.title,
      duplicate: response.duplicate || false,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function batchCreateEvents(args: {
  events: Array<{
    signalId: string;
    type: string;
    title: string;
    summary?: string;
    relatedSignalIds?: string[];
    sourceUrl?: string;
    sourceUrls?: string[];
    metadata?: Record<string, unknown>;
    confidence?: number;
    importance?: number;
    dedupeKey?: string;
    occurredAt?: string;
    source?: string;
  }>;
}) {
  try {
    const response = await api.post<any>("/events", {
      events: args.events.map((e) => ({ ...e, source: e.source || "agent" })),
    });
    return {
      created: response.created.map((e: any) => ({ id: e.id, signalId: e.signalId, type: e.type, title: e.title })),
      duplicatesSkipped: response.duplicates.length,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function listEvents(args: {
  signalId?: string;
  signalIds?: string[];
  type?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}) {
  try {
    const params: Record<string, string | number | undefined> = {
      limit: args.limit,
      cursor: args.cursor,
    };
    if (args.signalId) params.signalId = args.signalId;
    else if (args.signalIds?.length) params.signalIds = args.signalIds.join(",");
    if (args.type) params.type = args.type;
    if (args.since) params.since = args.since;
    if (args.until) params.until = args.until;

    const response = await api.get<any>("/events", params);
    return {
      events: response.events.map((e: any) => ({
        id: e.id, signalId: e.signalId, type: e.type, title: e.title,
        summary: e.summary, sourceUrl: e.sourceUrl, importance: e.importance,
        createdAt: e.createdAt, signalName: e.signal?.name, signalType: e.signal?.type,
      })),
      nextCursor: response.nextCursor,
      hasMore: response.hasMore,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function getSignalsToTend(args: { limit?: number; priority?: number }) {
  try {
    const response = await api.get<any>("/signals/tend", args);
    return {
      signals: response.signals.map((s: any) => ({
        id: s.id, name: s.name, type: s.type, slug: s.slug,
        externalUrl: s.externalUrl, metadata: s.metadata,
        lastTendedAt: s.tendingStatus?.lastTendedAt,
        priority: s.tendingStatus?.priority,
      })),
      total: response.total,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function markSignalTended(args: { signalId: string; error?: string }) {
  try {
    const response = await api.post<any>("/signals/tend", args);
    return {
      success: response.success,
      signalId: args.signalId,
      lastTendedAt: response.tendingStatus?.lastTendedAt,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function batchMarkSignalsTended(args: {
  signals: Array<{ signalId: string; error?: string }>;
}) {
  try {
    const response = await api.post<any>("/signals/tend", { signals: args.signals });
    return {
      results: response.results.map((r: any) => ({ signalId: r.signalId, success: r.success, error: r.error })),
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

// --- Registration ---

const EventTypeEnum = StringEnum([
  "fundraising_announced", "acquisition", "product_launch", "key_hire",
  "partnership", "media_coverage", "regulatory_filing",
  "social_activity", "sentiment_change", "market_signal", "endorsement",
  "insight", "custom",
] as const);

const EventSchema = Type.Object({
  signalId: Type.String({ description: "ID of the signal this event is about" }),
  type: EventTypeEnum,
  title: Type.String({ description: "Event title (max 500 chars)" }),
  summary: Type.Optional(Type.String({ description: "Detailed summary (max 2000 chars)" })),
  relatedSignalIds: Type.Optional(Type.Array(Type.String(), { description: "Related signal IDs" })),
  sourceUrl: Type.Optional(Type.String({ description: "Primary source URL" })),
  sourceUrls: Type.Optional(Type.Array(Type.String(), { description: "Additional source URLs" })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Type-specific metadata" })),
  confidence: Type.Optional(Type.Number({ description: "Confidence score 0.0-1.0" })),
  importance: Type.Optional(Type.Integer({ description: "Importance score 0-100" })),
  dedupeKey: Type.Optional(Type.String({ description: "Unique key for deduplication" })),
  occurredAt: Type.Optional(Type.String({ description: "When the event occurred (ISO 8601)" })),
});

export function registerEventTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "create_event",
    label: "Create Event",
    description: "Create a single event for a signal. Events track occurrences like fundraising, product launches, key hires, etc.",
    parameters: EventSchema,
    execute: wrapExecute(createEvent),
  });

  pi.registerTool({
    name: "batch_create_events",
    label: "Batch Create Events",
    description: "Create multiple events at once (up to 50). Useful for bulk event creation.",
    parameters: Type.Object({
      events: Type.Array(EventSchema, { description: "Array of events to create (max 50)" }),
    }),
    execute: wrapExecute(batchCreateEvents),
  });

  pi.registerTool({
    name: "list_events",
    label: "List Events",
    description: "Query events by signal, type, or date range.",
    parameters: Type.Object({
      signalId: Type.Optional(Type.String({ description: "Filter by specific signal ID" })),
      signalIds: Type.Optional(Type.Array(Type.String(), { description: "Filter by multiple signal IDs" })),
      type: Type.Optional(Type.String({ description: "Filter by event type" })),
      since: Type.Optional(Type.String({ description: "Only events after this date (ISO 8601)" })),
      until: Type.Optional(Type.String({ description: "Only events before this date (ISO 8601)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 50, max 100)" })),
      cursor: Type.Optional(Type.String({ description: "Cursor for pagination" })),
    }),
    execute: wrapExecute(listEvents),
  });

  pi.registerTool({
    name: "get_signals_to_tend",
    label: "Get Signals to Tend",
    description: "Get signals that are due for tending (haven't been checked recently). Use before running the tend workflow.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max signals to return (default 20, max 100)" })),
      priority: Type.Optional(Type.Number({ description: "Minimum priority threshold (0-100)" })),
    }),
    execute: wrapExecute(getSignalsToTend),
  });

  pi.registerTool({
    name: "mark_signal_tended",
    label: "Mark Signal Tended",
    description: "Mark a signal as tended after processing. Call this after checking a signal for events.",
    parameters: Type.Object({
      signalId: Type.String({ description: "ID of the signal that was tended" }),
      error: Type.Optional(Type.String({ description: "Error message if tending failed" })),
    }),
    execute: wrapExecute(markSignalTended),
  });

  pi.registerTool({
    name: "batch_mark_signals_tended",
    label: "Batch Mark Signals Tended",
    description: "Mark multiple signals as tended at once.",
    parameters: Type.Object({
      signals: Type.Array(
        Type.Object({
          signalId: Type.String({ description: "Signal ID" }),
          error: Type.Optional(Type.String({ description: "Error message if failed" })),
        }),
        { description: "Array of signals to mark as tended" }
      ),
    }),
    execute: wrapExecute(batchMarkSignalsTended),
  });
}
