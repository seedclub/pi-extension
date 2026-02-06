import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";
import { getStoredToken, getApiBase } from "../auth";

// --- Handlers ---

export async function getCurrentUser() {
  try {
    const response = await api.get<any>("/user");
    return {
      id: response.user.id,
      name: response.user.name,
      email: response.user.email,
      role: response.user.role,
      createdAt: response.user.createdAt,
      stats: response.stats,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, status: error.status };
    throw error;
  }
}

export async function getSyncStatus() {
  try {
    await api.get<any>("/user");
    return {
      status: "connected",
      lastCheckedAt: new Date().toISOString(),
      api: "connected",
      message: "Successfully connected to Seed Network API",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: "disconnected", lastCheckedAt: new Date().toISOString(), api: "disconnected", error: error.message };
    }
    return { status: "error", lastCheckedAt: new Date().toISOString(), api: "error", error: "Unknown error" };
  }
}

async function seedAuthStatus() {
  const stored = await getStoredToken();
  if (stored) {
    return { authenticated: true, email: stored.email, apiBase: stored.apiBase, tokenCreatedAt: stored.createdAt };
  } else if (process.env.SEED_NETWORK_TOKEN) {
    return { authenticated: true, source: "environment variable (SEED_NETWORK_TOKEN)" };
  }
  return {
    authenticated: false,
    message: "No stored credentials. Use /seed-connect with a token or call any API tool to trigger browser authentication.",
  };
}

// --- Registration ---

export function registerUtilityTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_current_user",
    label: "Get Current User",
    description: "Get information about the currently authenticated Seed Network user and their stats.",
    parameters: Type.Object({}),
    execute: wrapExecute(getCurrentUser),
  });

  pi.registerTool({
    name: "sync_status",
    label: "Sync Status",
    description: "Check Seed Network API connection status.",
    parameters: Type.Object({}),
    execute: wrapExecute(getSyncStatus),
  });

  pi.registerTool({
    name: "seed_auth_status",
    label: "Auth Status",
    description: "Check current Seed Network authentication status and which account is logged in.",
    parameters: Type.Object({}),
    execute: wrapExecute(seedAuthStatus),
  });
}
