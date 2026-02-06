/**
 * Wraps a handler function into a pi tool execute function.
 * Returns JSON results on success, clear error messages on failure.
 */

import { NotConnectedError } from "./api-client";

export function wrapExecute(fn: (params: any) => Promise<any>) {
  return async (_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) => {
    try {
      const result = await fn(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result ?? {},
      };
    } catch (error) {
      if (error instanceof NotConnectedError) {
        return {
          content: [{ type: "text" as const, text: "Not connected to Seed Network. Run /seed-connect to authenticate." }],
          details: { notConnected: true },
          isError: true,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        details: { error: message },
        isError: true,
      };
    }
  };
}
