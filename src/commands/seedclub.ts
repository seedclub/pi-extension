/**
 * /seedclub — the one command. Dynamic menu based on auth state.
 *
 * Not connected → connect flow
 * Connected → menu of actions
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getStoredToken, getApiBase } from "../auth";
import { getCurrentUser } from "../tools/utility";
import { listSignals } from "../tools/signals";

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

      return await showMainMenu(user, ctx);
    },
  });

  // --- Disconnected state ---

  async function showDisconnectedMenu(args: string | undefined, ctx: any) {
    const apiBase = getApiBase();
    const isDev = apiBase.includes("localhost") || apiBase.includes("127.0.0.1");

    const options = [
      "🔑  Connect to Seed Club",
      ...(isDev ? [] : ["🔧  Switch to local dev server"]),
      ...(isDev ? ["🌐  Switch to production"] : []),
    ];

    const choice = await ctx.ui.select("🌱 Seed Club", options);
    if (!choice) return;

    if (choice.startsWith("🔑")) {
      await deps.connect(args, ctx);
    } else if (choice.startsWith("🔧")) {
      process.env.SEED_NETWORK_API = "http://localhost:3000";
      ctx.ui.setStatus("seed-api", "🔧 localhost:3000");
      ctx.ui.notify("✓ Switched to local dev. Run /seedclub again to connect.", "info");
    } else if (choice.startsWith("🌐")) {
      delete process.env.SEED_NETWORK_API;
      ctx.ui.setStatus("seed-api", undefined);
      ctx.ui.notify("✓ Switched to production.", "info");
    }
  }

  // --- Connected state ---

  async function showMainMenu(user: any, ctx: any) {
    const apiBase = getApiBase();
    const isDev = apiBase.includes("localhost") || apiBase.includes("127.0.0.1");
    const envLabel = isDev ? " (dev)" : "";

    // Quick stats fetch
    let signalCount = "?";
    try {
      const result = await listSignals({ limit: 1 });
      if (!("error" in result)) signalCount = String(result.total ?? 0);
    } catch {}

    const greeting = `🌱 ${user.name}${envLabel}`;

    const options = [
      `📡  Add signals`,
      `📋  My signals (${signalCount})`,
      `📦  Import signals`,
      `🔍  Search signals`,
      `───────────────`,
      `🎯  Source a deal`,
      `💼  Browse deals`,
      `🔬  Research`,
      `───────────────`,
      `🐦  Twitter check`,
      `📰  Twitter news`,
      `📚  Import follows`,
      `🔖  Import bookmarks`,
      `───────────────`,
      `👤  My profile`,
      `🚪  Disconnect`,
    ];

    const choice = await ctx.ui.select(greeting, options);
    if (!choice || choice.startsWith("──")) return;

    const action = choice.slice(4).trim(); // strip emoji + spaces

    switch (action) {
      case "Add signals":
        ctx.ui.setEditorText("/add ");
        break;

      case `My signals (${signalCount})`:
        pi.sendUserMessage("/signals");
        break;

      case "Import signals":
        pi.sendUserMessage("/import");
        break;

      case "Search signals":
        const query = await ctx.ui.input("Search signals:", "");
        if (query) pi.sendUserMessage(`/signals search ${query}`);
        break;

      case "Source a deal":
        pi.sendUserMessage("/source");
        break;

      case "Browse deals":
        pi.sendUserMessage("List all available deals with their current status");
        break;

      case "Research":
        pi.sendUserMessage("Show recent research artifacts");
        break;

      case "Twitter check":
        pi.sendUserMessage("/twitter-check");
        break;

      case "Twitter news":
        pi.sendUserMessage("/twitter-news");
        break;

      case "Import follows":
        pi.sendUserMessage("/import-follows");
        break;

      case "Import bookmarks":
        pi.sendUserMessage("/import-bookmarks");
        break;

      case "My profile": {
        const stats = user.stats || {};
        const lines = [
          `Name: ${user.name}`,
          `Email: ${user.email}`,
          `Role: ${user.role}`,
          `API: ${apiBase}`,
          ``,
          `Deals created: ${stats.dealsCreated ?? 0}`,
          `Research saved: ${stats.researchSaved ?? 0}`,
          `Enrichments: ${stats.enrichmentsSubmitted ?? 0}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        break;
      }

      case "Disconnect":
        await deps.disconnect(ctx);
        break;
    }
  }
}
