import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

// --- Handlers ---

export async function saveResearch(args: {
  type: string;
  title: string;
  content: Record<string, unknown>;
  sourceUrls?: string[];
  companyId?: string;
  dealId?: string;
}) {
  try {
    const response = await api.post<any>("/research", args);
    return {
      id: response.research.id,
      type: response.research.type,
      title: response.research.title,
      companyId: response.research.companyId,
      dealId: response.research.dealId,
      createdAt: response.research.createdAt,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function getResearch(args: { researchId: string }) {
  try {
    const response = await api.get<any>("/research", { id: args.researchId });
    return response.research;
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function queryResearch(args: {
  topic?: string;
  type?: string;
  companyId?: string;
  dealId?: string;
  limit?: number;
}) {
  try {
    const response = await api.get<any>("/research", args);
    return { research: response.research, total: response.total };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function linkResearch(args: { researchId: string; companyId?: string; dealId?: string }) {
  try {
    const response = await api.patch<any>("/research", args);
    return {
      success: response.success,
      researchId: response.researchId,
      linkedToCompany: response.linkedToCompany,
      linkedToDeal: response.linkedToDeal,
      linkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

// --- Registration ---

export function registerResearchTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "save_research",
    label: "Save Research",
    description: "Save a research artifact. Can be company profile, market analysis, founder background, etc.",
    parameters: Type.Object({
      type: Type.String({ description: "Research type (company_profile, market_analysis, founder_background, competitive_analysis)" }),
      title: Type.String({ description: "Title of the research artifact" }),
      content: Type.Record(Type.String(), Type.Unknown(), { description: "Research content as structured JSON" }),
      sourceUrls: Type.Optional(Type.Array(Type.String(), { description: "Source URLs for provenance" })),
      companyId: Type.Optional(Type.String({ description: "ID of company to link research to" })),
      dealId: Type.Optional(Type.String({ description: "ID of deal to link research to" })),
    }),
    execute: wrapExecute(saveResearch),
  });

  pi.registerTool({
    name: "get_research",
    label: "Get Research",
    description: "Get a specific research artifact by ID.",
    parameters: Type.Object({
      researchId: Type.String({ description: "Research ID" }),
    }),
    execute: wrapExecute(getResearch),
  });

  pi.registerTool({
    name: "query_research",
    label: "Query Research",
    description: "Search research artifacts by topic, type, or associated company/deal.",
    parameters: Type.Object({
      topic: Type.Optional(Type.String({ description: "Search topic" })),
      type: Type.Optional(Type.String({ description: "Research type filter" })),
      companyId: Type.Optional(Type.String({ description: "Filter by associated company" })),
      dealId: Type.Optional(Type.String({ description: "Filter by associated deal" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(queryResearch),
  });

  pi.registerTool({
    name: "link_research",
    label: "Link Research",
    description: "Associate a research artifact with a company or deal.",
    parameters: Type.Object({
      researchId: Type.String({ description: "Research ID to link" }),
      companyId: Type.Optional(Type.String({ description: "Company ID to link to" })),
      dealId: Type.Optional(Type.String({ description: "Deal ID to link to" })),
    }),
    execute: wrapExecute(linkResearch),
  });
}
