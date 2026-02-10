/**
 * /seedclub — the one command. Dynamic menu based on auth state.
 *
 * Not connected → connect flow
 * Connected → menu of actions
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getStoredToken, getApiBase } from "../auth";
import { getCurrentUser } from "../tools/utility";
import { getUnsortedSignals } from "../tools/signals";
import { runSortFlow } from "./sort";

interface SeedclubDeps {
  connect: (args: string | undefined, ctx: any) => Promise<void>;
  disconnect: (ctx: any) => Promise<void>;
}

export function registerSeedclubCommand(pi: ExtensionAPI, deps: SeedclubDeps) {
  pi.registerCommand("seedclub", {
    description: "The human+ venture network",
    handler: async (args, ctx) => {
      // Check connection state
      const stored = await getStoredToken();
      const hasEnvToken = !!process.env.SEED_NETWORK_TOKEN;
      const isConnected = !!stored || hasEnvToken;

      if (!isConnected) {
        return await showDisconnectedMenu(args, ctx);
      }

      // Fetch user info for personalized menu
      const user = await getCurrentUser();
      if ("error" in user) {
        // Token expired or invalid
        ctx.ui.notify("Session expired. Let's reconnect.", "warning");
        return await showDisconnectedMenu(args, ctx);
      }

      return await showMainMenu(pi, user, ctx);
    },
  });

  // --- Disconnected state ---

  async function showDisconnectedMenu(args: string | undefined, ctx: any) {
    // Not connected — only option is to connect. No dev/prod toggle until authenticated.
    await deps.connect(args, ctx);
  }

  // --- Connected state ---

  async function showMainMenu(pi: ExtensionAPI, user: any, ctx: any) {
    const apiBase = getApiBase();
    const isDev = apiBase.includes("localhost") || apiBase.includes("127.0.0.1");
    const envLabel = isDev ? " (dev)" : "";

    // Quick stats fetch — keep the full result so we can pass it to sort
    let unsortedCount = "?";
    let unsortedResult: any = null;
    try {
      const result = await getUnsortedSignals();
      if (!("error" in result)) {
        unsortedResult = result;
        unsortedCount = String(result.unsortedCount ?? result.unsorted?.length ?? 0);
      }
    } catch {}

    const greeting = `🌱 ${user.name}${envLabel}`;

    const sortLabel = unsortedCount === "0"
      ? `📋  Sort signals (✓ all sorted)`
      : `📋  Sort signals (${unsortedCount} unsorted)`;

    const options = [
      `📡  Add signals`,
      sortLabel,
      `───────────────`,
      ...(isDev ? [`🌐  Switch to production`] : [`🔧  Switch to local dev`]),
      `🚪  Disconnect`,
    ];

    const choice = await ctx.ui.select(greeting, options);
    if (!choice || choice.startsWith("──")) return;

    const action = choice.slice(4).trim(); // strip emoji + spaces

    if (action.startsWith("Sort signals")) {
      return await runSortFlow(pi, ctx, unsortedResult);
    }

    switch (action) {
      case "Add signals":
        ctx.ui.setEditorText("/add ");
        break;

      case "Switch to local dev": {
        const portInput = await ctx.ui.input("Dev server port:", "3000");
        if (!portInput) break;
        const port = parseInt(portInput, 10) || 3000;
        const devUrl = `http://localhost:${port}`;
        process.env.SEED_NETWORK_API = devUrl;
        ctx.ui.setStatus("seed-api", `🔧 ${devUrl}`);
        ctx.ui.notify(`✓ Switched to dev: ${devUrl}`, "info");
        break;
      }

      case "Switch to production":
        delete process.env.SEED_NETWORK_API;
        ctx.ui.setStatus("seed-api", undefined);
        ctx.ui.notify("✓ Switched to production", "info");
        break;

      case "Disconnect":
        await deps.disconnect(ctx);
        break;
    }
  }


}
