import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

// --- Handlers ---

export async function createCompany(args: {
  name: string;
  tagline?: string;
  description?: string;
  website?: string;
  logoUrl?: string;
  industries?: string[];
  stage?: string;
  foundedYear?: number;
  teamSize?: number;
  founders?: Array<{ name: string; role?: string; bio?: string; linkedIn?: string; twitter?: string }>;
  location?: string;
  fundingHistory?: Array<{ round: string; amount?: number; date?: string; investors?: string[] }>;
  totalRaised?: number;
  linkedinUrl?: string;
  twitterUrl?: string;
  crunchbaseUrl?: string;
}) {
  try {
    const response = await api.post<any>("/companies", args);
    return {
      id: response.company.id,
      slug: response.company.slug,
      name: response.company.name,
      tagline: response.company.tagline,
      stage: response.company.stage,
      industries: response.company.industries,
      createdAt: response.company.createdAt,
      message: response.message,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function updateCompany(args: { companyId: string; fields: Record<string, unknown> }) {
  try {
    const response = await api.patch<any>("/companies", args);
    return { success: response.success, companyId: response.company.id, updated: response.updated, updatedAt: response.company.updatedAt };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function getCompany(args: { companyId?: string; slug?: string }) {
  try {
    const params: Record<string, string | undefined> = {};
    if (args.companyId) params.id = args.companyId;
    if (args.slug) params.slug = args.slug;
    const response = await api.get<any>("/companies", params);
    return { company: response.company, research: response.research || [], deals: response.deals || [] };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function listCompanies(args: { stage?: string; industry?: string; limit?: number }) {
  try {
    const response = await api.get<any>("/companies", args);
    return { companies: response.companies, total: response.total };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function searchCompanies(args: { query: string; limit?: number }) {
  try {
    const response = await api.get<any>("/companies", { search: args.query, limit: args.limit });
    return { companies: response.companies, total: response.total, query: args.query };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

// --- Registration ---

const FounderSchema = Type.Object({
  name: Type.String(),
  role: Type.Optional(Type.String()),
  bio: Type.Optional(Type.String()),
  linkedIn: Type.Optional(Type.String()),
  twitter: Type.Optional(Type.String()),
});

const FundingRoundSchema = Type.Object({
  round: Type.String(),
  amount: Type.Optional(Type.Number()),
  date: Type.Optional(Type.String()),
  investors: Type.Optional(Type.Array(Type.String())),
});

export function registerCompanyTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "create_company",
    label: "Create Company",
    description:
      "Create a new company in the Seed Network knowledge base. Companies are collaborative entities that anyone can contribute to via enrichments.",
    parameters: Type.Object({
      name: Type.String({ description: "Company name" }),
      tagline: Type.Optional(Type.String({ description: "One-line description" })),
      description: Type.Optional(Type.String({ description: "Longer description" })),
      website: Type.Optional(Type.String({ description: "Company website URL" })),
      logoUrl: Type.Optional(Type.String({ description: "URL to company logo" })),
      industries: Type.Optional(Type.Array(Type.String(), { description: "Industries (e.g., ['AI', 'Climate'])" })),
      stage: Type.Optional(Type.String({ description: "Funding stage (pre-seed, seed, series-a, etc.)" })),
      foundedYear: Type.Optional(Type.Number({ description: "Year company was founded" })),
      teamSize: Type.Optional(Type.Number({ description: "Number of employees" })),
      founders: Type.Optional(Type.Array(FounderSchema, { description: "Founder information" })),
      location: Type.Optional(Type.String({ description: "Company headquarters location" })),
      fundingHistory: Type.Optional(Type.Array(FundingRoundSchema, { description: "Historical funding rounds" })),
      totalRaised: Type.Optional(Type.Number({ description: "Total funding raised in USD" })),
      linkedinUrl: Type.Optional(Type.String({ description: "LinkedIn company page URL" })),
      twitterUrl: Type.Optional(Type.String({ description: "Twitter/X profile URL" })),
      crunchbaseUrl: Type.Optional(Type.String({ description: "Crunchbase profile URL" })),
    }),
    execute: wrapExecute(createCompany),
  });

  pi.registerTool({
    name: "update_company",
    label: "Update Company",
    description: "Update an existing company's fields. For curator review of changes, use add_enrichment instead.",
    parameters: Type.Object({
      companyId: Type.String({ description: "ID of the company to update" }),
      fields: Type.Record(Type.String(), Type.Unknown(), { description: "Fields to update" }),
    }),
    execute: wrapExecute(updateCompany),
  });

  pi.registerTool({
    name: "get_company",
    label: "Get Company",
    description: "Get a specific company by ID or slug. Returns full company details, associated research, and linked deals.",
    parameters: Type.Object({
      companyId: Type.Optional(Type.String({ description: "Company ID" })),
      slug: Type.Optional(Type.String({ description: "Company slug" })),
    }),
    execute: wrapExecute(getCompany),
  });

  pi.registerTool({
    name: "list_companies",
    label: "List Companies",
    description: "List companies with optional filters. Can filter by stage or industry.",
    parameters: Type.Object({
      stage: Type.Optional(Type.String({ description: "Filter by funding stage" })),
      industry: Type.Optional(Type.String({ description: "Filter by industry" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(listCompanies),
  });

  pi.registerTool({
    name: "search_companies",
    label: "Search Companies",
    description: "Full-text search across companies. Searches name, tagline, description, and slug.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
    }),
    execute: wrapExecute(searchCompanies),
  });
}
