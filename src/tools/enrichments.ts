import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

// --- Handlers ---

export async function addEnrichment(args: {
  companyId?: string;
  dealId?: string;
  fields: Array<{ fieldName: string; newValue: string; confidence?: string; source?: string }>;
  supportingResearch?: { sourceUrls?: string[]; notes?: string };
}) {
  try {
    const response = await api.post<any>("/enrichments", args);
    return {
      id: response.enrichment.id,
      companyId: response.enrichment.companyId,
      dealId: response.enrichment.dealId,
      targetType: response.enrichment.targetType,
      status: response.enrichment.status,
      prNumber: response.enrichment.prNumber,
      prUrl: response.enrichment.prUrl,
      createdAt: response.enrichment.createdAt,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function getEnrichments(args: {
  companyId?: string;
  dealId?: string;
  status?: string;
  limit?: number;
}) {
  try {
    const response = await api.get<any>("/enrichments", args);
    return { enrichments: response.enrichments, total: response.total };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function cancelEnrichment(args: { enrichmentId: string }) {
  try {
    const response = await api.delete<any>("/enrichments", { id: args.enrichmentId });
    return { success: response.success, cancelled: response.cancelled };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

// --- Registration ---

export function registerEnrichmentTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "add_enrichment",
    label: "Add Enrichment",
    description: "Submit an enrichment to an existing company or deal. Creates a GitHub PR for curator review.",
    parameters: Type.Object({
      companyId: Type.Optional(Type.String({ description: "ID of the company to enrich (use this OR dealId)" })),
      dealId: Type.Optional(Type.String({ description: "ID of the deal to enrich (use this OR companyId)" })),
      fields: Type.Array(
        Type.Object({
          fieldName: Type.String({ description: "Name of field to update" }),
          newValue: Type.String({ description: "New value for the field" }),
          confidence: Type.Optional(Type.String({ description: "Confidence level (high, medium, low)" })),
          source: Type.Optional(Type.String({ description: "Source of this information" })),
        }),
        { description: "Fields to update" }
      ),
      supportingResearch: Type.Optional(
        Type.Object({
          sourceUrls: Type.Optional(Type.Array(Type.String())),
          notes: Type.Optional(Type.String()),
        })
      ),
    }),
    execute: wrapExecute(addEnrichment),
  });

  pi.registerTool({
    name: "get_enrichments",
    label: "Get Enrichments",
    description: "Get enrichment history, optionally filtered by company, deal, or status.",
    parameters: Type.Object({
      companyId: Type.Optional(Type.String({ description: "Filter by company ID" })),
      dealId: Type.Optional(Type.String({ description: "Filter by deal ID" })),
      status: Type.Optional(Type.String({ description: "Filter by status (pending, approved, rejected)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(getEnrichments),
  });

  pi.registerTool({
    name: "cancel_enrichment",
    label: "Cancel Enrichment",
    description: "Cancel a pending enrichment request.",
    parameters: Type.Object({
      enrichmentId: Type.String({ description: "ID of the enrichment to cancel" }),
    }),
    execute: wrapExecute(cancelEnrichment),
  });
}
