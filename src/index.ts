/**
 * Seed Network extension for pi
 *
 * Provides deal sourcing, research, signal tracking, enrichment,
 * and Twitter/X integration tools for investment research.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerDealTools } from "./tools/deals";
import { registerCompanyTools } from "./tools/companies";
import { registerSignalTools } from "./tools/signals";
import { registerResearchTools } from "./tools/research";
import { registerEnrichmentTools } from "./tools/enrichments";
import { registerEventTools } from "./tools/events";
import { registerTwitterTools } from "./tools/twitter";
import { registerUtilityTools } from "./tools/utility";
import { getCurrentUser } from "./tools/utility";
import { getStoredToken, storeToken, getApiBase, clearStoredToken } from "./auth";
import { setCachedToken, clearCredentials } from "./api-client";

export default function (pi: ExtensionAPI) {
  // --- Register all tools ---
  registerDealTools(pi);
  registerCompanyTools(pi);
  registerSignalTools(pi);
  registerResearchTools(pi);
  registerEnrichmentTools(pi);
  registerEventTools(pi);
  registerTwitterTools(pi);
  registerUtilityTools(pi);

  // --- Commands ---

  pi.registerCommand("seed-connect", {
    description: "Connect to Seed Network with an API token (get one from /admin/api-tokens)",
    handler: async (args, ctx) => {
      const token = args?.trim();

      if (!token) {
        ctx.ui.notify("Usage: /seed-connect <token>  (token starts with sn_)", "warning");
        return;
      }

      if (!token.startsWith("sn_")) {
        ctx.ui.notify("Invalid token format. Seed Network tokens start with 'sn_'.", "error");
        return;
      }

      const apiBase = getApiBase();

      // Store token and update cache so getCurrentUser uses it
      await storeToken(token, "pending", apiBase);
      setCachedToken(token, apiBase);

      // Verify by calling the API
      const result = await getCurrentUser();

      if ("error" in result) {
        await clearCredentials();
        ctx.ui.notify(`Token verification failed: ${result.error}`, "error");
        return;
      }

      // Update stored token with the actual email
      await storeToken(token, result.email, apiBase);

      ctx.ui.notify(`✓ Connected to Seed Network as ${result.email}`, "success");
      ctx.ui.setStatus("seed", `🌱 ${result.email}`);
    },
  });

  pi.registerCommand("seed-logout", {
    description: "Disconnect from Seed Network",
    handler: async (_args, ctx) => {
      await clearCredentials();
      ctx.ui.setStatus("seed", undefined);
      ctx.ui.notify("Logged out of Seed Network", "info");
    },
  });

  pi.registerCommand("seed-status", {
    description: "Check Seed Network connection status",
    handler: async (_args, ctx) => {
      const stored = await getStoredToken();
      if (stored) {
        ctx.ui.notify(`Connected as ${stored.email} (${stored.apiBase})`, "info");
      } else if (process.env.SEED_NETWORK_TOKEN) {
        ctx.ui.notify("Connected via SEED_NETWORK_TOKEN environment variable", "info");
      } else {
        ctx.ui.notify("Not connected. Use /seed-connect <token> to authenticate.", "warning");
      }
    },
  });

  // --- Session start: show connection status ---

  pi.on("session_start", async (_event, ctx) => {
    const stored = await getStoredToken();
    if (stored) {
      ctx.ui.setStatus("seed", `🌱 ${stored.email}`);
    } else if (process.env.SEED_NETWORK_TOKEN) {
      ctx.ui.setStatus("seed", "🌱 Connected (env)");
    }
  });
}
