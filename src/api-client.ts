/**
 * API Client for Seed Network
 * Handles authenticated requests to the webapp API
 *
 * Authentication priority:
 * 1. SEED_NETWORK_TOKEN environment variable
 * 2. Stored token from browser auth flow (~/.config/seed-network/token)
 * 3. Trigger browser authentication if no token found
 */

import { getToken, getApiBase, ensureAuthenticated, clearStoredToken } from "./auth";

let cachedToken: string | null = null;
let cachedApiBase: string | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

async function getAuthToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const existingToken = await getToken();
  if (existingToken) {
    cachedToken = existingToken;
    cachedApiBase = getApiBase();
    return cachedToken;
  }

  const result = await ensureAuthenticated();
  cachedToken = result.token;
  cachedApiBase = result.apiBase;
  return cachedToken;
}

function getApiBaseUrl(): string {
  return cachedApiBase || getApiBase();
}

export async function clearCredentials(): Promise<void> {
  cachedToken = null;
  cachedApiBase = null;
  await clearStoredToken();
}

export function setCachedToken(token: string, apiBase: string): void {
  cachedToken = token;
  cachedApiBase = apiBase;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, params } = options;

  const token = await getAuthToken();
  const apiBase = getApiBaseUrl();

  const url = new URL(`/api/mcp${endpoint}`, apiBase);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    await clearCredentials();
    const result = await ensureAuthenticated();
    cachedToken = result.token;
    cachedApiBase = result.apiBase;

    headers.Authorization = `Bearer ${cachedToken}`;
    const retryResponse = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!retryResponse.ok) {
      const retryData = await retryResponse.json();
      throw new ApiError(
        retryResponse.status,
        retryData.error || `Request failed with status ${retryResponse.status}`,
        retryData.details
      );
    }

    return (await retryResponse.json()) as T;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error || `Request failed with status ${response.status}`,
      data.details
    );
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
