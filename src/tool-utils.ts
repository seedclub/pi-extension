/**
 * Shared utility for wrapping tool execute functions.
 * Handles AuthRequiredError and generic errors consistently.
 */

import { AuthRequiredError } from "./auth";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Wraps a handler function into a pi tool execute function.
 * Catches AuthRequiredError and formats the auth URL for the user.
 * All other errors are caught and returned as tool errors.
 */
export function wrapExecute(fn: (params: any) => Promise<any>) {
  return async (
    _toolCallId: string,
    params: any,
    _signal: AbortSignal | undefined,
    _onUpdate: any,
    _ctx: any
  ): Promise<ToolResult> => {
    try {
      const result = await fn(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result ?? {},
      };
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        return {
          content: [
            {
              type: "text",
              text: [
                "🔐 Authentication required for Seed Network.",
                "",
                "Please open this URL in your browser:",
                error.authUrl,
                "",
                "After signing in, retry your request.",
                "",
                "Alternatively, use /seed-connect <token> with an API token from the Seed Network admin panel.",
              ].join("\n"),
            },
          ],
          details: { authRequired: true, authUrl: error.authUrl },
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        details: { error: message },
        isError: true,
      };
    }
  };
}
