import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

// --- Handler functions (same logic as MCP) ---

export async function createDeal(args: {
  name: string;
  website?: string;
  summary: string;
  stage?: string;
  sector?: string;
  valuation?: number;
  curatorBlurb?: string;
}) {
  try {
    const response = await api.post<any>("/deals", args);
    return {
      id: response.deal.id,
      slug: response.deal.slug,
      name: response.deal.name,
      summary: response.deal.summary,
      state: response.deal.state,
      createdAt: response.deal.createdAt,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function updateDeal(args: { dealId: string; fields: Record<string, unknown> }) {
  try {
    const response = await api.patch<any>("/deals", args);
    return {
      success: response.success,
      dealId: response.deal.id,
      updated: response.updated,
      updatedAt: response.deal.updatedAt,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function getDeal(args: { dealId?: string; slug?: string }) {
  try {
    const params: Record<string, string | undefined> = {};
    if (args.dealId) params.id = args.dealId;
    if (args.slug) params.slug = args.slug;
    const response = await api.get<any>("/deals", params);
    return { deal: response.deal, research: response.research || [] };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function listDeals(args: { stage?: string; sector?: string; limit?: number }) {
  try {
    const response = await api.get<any>("/deals", args);
    return { deals: response.deals, total: response.total };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function searchDeals(args: { query: string; limit?: number }) {
  try {
    const response = await api.get<any>("/deals", { search: args.query, limit: args.limit });
    return { deals: response.deals, total: response.total, query: args.query };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

// --- Tool registration ---

export function registerDealTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "create_deal",
    label: "Create Deal",
    description: "Create a new deal in Seed Network. Requires name and summary. Returns the created deal with ID and slug.",
    parameters: Type.Object({
      name: Type.String({ description: "Company name" }),
      website: Type.Optional(Type.String({ description: "Company website URL" })),
      summary: Type.String({ description: "One-line description of the company" }),
      stage: Type.Optional(Type.String({ description: "Funding stage (pre-seed, seed, etc.)" })),
      sector: Type.Optional(Type.String({ description: "Industry sector" })),
      valuation: Type.Optional(Type.Number({ description: "Company valuation in USD" })),
      curatorBlurb: Type.Optional(Type.String({ description: "Curator's notes about the deal" })),
    }),
    execute: wrapExecute(createDeal),
  });

  pi.registerTool({
    name: "update_deal",
    label: "Update Deal",
    description: "Update an existing deal's fields. Specify the deal ID and the fields to update.",
    parameters: Type.Object({
      dealId: Type.String({ description: "ID of the deal to update" }),
      fields: Type.Record(Type.String(), Type.Unknown(), {
        description: "Fields to update (e.g., summary, curatorBlurb, valuation, memoUrl, deckUrl, dataRoomUrl)",
      }),
    }),
    execute: wrapExecute(updateDeal),
  });

  pi.registerTool({
    name: "get_deal",
    label: "Get Deal",
    description: "Get a specific deal by ID or slug. Returns full deal details and associated research.",
    parameters: Type.Object({
      dealId: Type.Optional(Type.String({ description: "Deal ID" })),
      slug: Type.Optional(Type.String({ description: "Deal slug (URL-friendly name)" })),
    }),
    execute: wrapExecute(getDeal),
  });

  pi.registerTool({
    name: "list_deals",
    label: "List Deals",
    description: "List deals with optional filters. Can filter by stage or sector.",
    parameters: Type.Object({
      stage: Type.Optional(Type.String({ description: "Filter by funding stage" })),
      sector: Type.Optional(Type.String({ description: "Filter by sector" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(listDeals),
  });

  pi.registerTool({
    name: "search_deals",
    label: "Search Deals",
    description: "Full-text search across deals. Searches name, summary, and slug.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(searchDeals),
  });
}
