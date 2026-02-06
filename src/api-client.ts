/**
 * API Client for Seed Network.
 * Simple HTTP client with Bearer token auth.
 */

import { getToken, getApiBase, clearStoredToken } from "./auth";

let cachedToken: string | null = null;
let cachedApiBase: string | null = null;

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super("Not connected to Seed Network. Run /seed-connect to authenticate.");
    this.name = "NotConnectedError";
  }
}

export function setCachedToken(token: string, apiBase: string): void {
  cachedToken = token;
  cachedApiBase = apiBase;
}

export async function clearCredentials(): Promise<void> {
  cachedToken = null;
  cachedApiBase = null;
  await clearStoredToken();
}

async function getAuthToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const token = await getToken();
  if (!token) throw new NotConnectedError();
  cachedToken = token;
  cachedApiBase = getApiBase();
  return token;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params } = options;
  const token = await getAuthToken();
  const apiBase = cachedApiBase || getApiBase();

  const url = new URL(`/api/mcp${endpoint}`, apiBase);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    await clearCredentials();
    throw new ApiError(401, "Token expired or revoked. Run /seed-connect to reconnect.");
  }

  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(response.status, data.error || `Request failed (${response.status})`, data.details);
  }
  return data as T;
}

export const api = {
  get: <T>(endpoint: string, params?: Record<string, string | number | undefined>) =>
    apiRequest<T>(endpoint, { method: "GET", params }),
  post: <T>(endpoint: string, body: unknown) =>
    apiRequest<T>(endpoint, { method: "POST", body }),
  patch: <T>(endpoint: string, body: unknown) =>
    apiRequest<T>(endpoint, { method: "PATCH", body }),
  delete: <T>(endpoint: string, params?: Record<string, string | number | undefined>) =>
    apiRequest<T>(endpoint, { method: "DELETE", params }),
};
