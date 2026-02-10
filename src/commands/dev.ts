/**
 * /seed-dev command — toggle between production and local dev API.
 *
 * Usage:
 *   /seed-dev           — toggle to localhost:3000
 *   /seed-dev 3001      — use custom port
 *   /seed-dev off       — switch back to production
 *   /seed-dev status    — show current API base
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getApiBase } from "../auth";

const DEFAULT_DEV_URL = "http://localhost:3000";
const PROD_URL = "https://beta.seedclub.com";

export function registerDevCommand(pi: ExtensionAPI) {
  pi.registerCommand("seed-dev", {
    description: "Toggle between production and local dev API. Usage: /seed-dev [port|off|status]",
    handler: async (args, ctx) => {
      const arg = args?.trim().toLowerCase();
      const currentBase = getApiBase();
      const isCurrentlyDev = currentBase.includes("localhost") || currentBase.includes("127.0.0.1");

      if (arg === "status") {
        ctx.ui.notify(`API: ${currentBase} ${isCurrentlyDev ? "(dev)" : "(prod)"}`, "info");
        return;
      }

      if (arg === "off" || arg === "prod") {
        delete process.env.SEED_NETWORK_API;
        ctx.ui.setStatus("seed-api", undefined);
        ctx.ui.notify(`✓ Switched to production: ${PROD_URL}`, "info");
        return;
      }

      // Toggle or set port
      const port = arg ? parseInt(arg, 10) : 3000;
      const devUrl = isNaN(port) ? DEFAULT_DEV_URL : `http://localhost:${port}`;

      process.env.SEED_NETWORK_API = devUrl;
      ctx.ui.setStatus("seed-api", `🔧 ${devUrl}`);
      ctx.ui.notify(`✓ Switched to dev: ${devUrl}`, "info");
    },
  });
}
