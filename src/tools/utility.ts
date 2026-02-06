import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { api, ApiError } from "../api-client";
import { wrapExecute } from "../tool-utils";

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

export function registerUtilityTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_current_user",
    label: "Get Current User",
    description: "Get information about the currently authenticated Seed Network user and their stats.",
    parameters: Type.Object({}),
    execute: wrapExecute(getCurrentUser),
  });
}
