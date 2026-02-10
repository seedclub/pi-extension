/**
 * /signals command — quick list/search without LLM.
 *
 * Examples:
 *   /signals              — list recent signals
 *   /signals twitter      — filter by type
 *   /signals search naval — search by name
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { listSignals, searchSignals } from "../tools/signals";

const TYPE_EMOJI: Record<string, string> = {
  twitter_account: "🐦",
  company: "🏢",
  person: "👤",
  blog: "📝",
  github_profile: "🐙",
  topic: "💡",
  newsletter: "📬",
  podcast: "🎙️",
  subreddit: "📢",
  custom: "📌",
};

const VALID_TYPES = [
  "twitter_account", "company", "person", "blog", "github_profile",
  "topic", "newsletter", "podcast", "subreddit", "custom",
];

// Short aliases
const TYPE_ALIASES: Record<string, string> = {
  twitter: "twitter_account",
  x: "twitter_account",
  gh: "github_profile",
  github: "github_profile",
  reddit: "subreddit",
  sub: "subreddit",
  pod: "podcast",
  news: "newsletter",
};

export function registerSignalsCommand(pi: ExtensionAPI) {
  pi.registerCommand("signals", {
    description: "List or search signals. Usage: /signals [type|search <query>]",
    handler: async (args, ctx) => {
      const parts = args?.trim().split(/\s+/) || [];
      const subcommand = parts[0]?.toLowerCase();

      // Search mode
      if (subcommand === "search" || subcommand === "find" || subcommand === "s") {
        const query = parts.slice(1).join(" ");
        if (!query) {
          ctx.ui.notify("Usage: /signals search <query>", "warning");
          return;
        }
        const result = await searchSignals({ query, limit: 20 });
        if ("error" in result) {
          ctx.ui.notify(`✗ ${result.error}`, "error");
          return;
        }
        if (!result.signals?.length) {
          ctx.ui.notify(`No signals matching "${query}"`, "info");
          return;
        }
        const lines = result.signals.map((s: any) => {
          const emoji = TYPE_EMOJI[s.type] || "📌";
          return `  ${emoji} ${s.name} ${s.tags?.length ? `[${s.tags.join(", ")}]` : ""}`;
        });
        ctx.ui.notify(`Found ${result.total} signals:\n${lines.join("\n")}`, "info");
        return;
      }

      // Type filter mode
      const typeFilter = TYPE_ALIASES[subcommand] || (VALID_TYPES.includes(subcommand) ? subcommand : undefined);

      const result = await listSignals({
        type: typeFilter,
        limit: 25,
      });

      if ("error" in result) {
        ctx.ui.notify(`✗ ${result.error}`, "error");
        return;
      }

      if (!result.signals?.length) {
        ctx.ui.notify(typeFilter ? `No ${typeFilter} signals` : "No signals yet. Use /add to create some!", "info");
        return;
      }

      const lines = result.signals.map((s: any) => {
        const emoji = TYPE_EMOJI[s.type] || "📌";
        return `  ${emoji} ${s.name}`;
      });

      const header = typeFilter
        ? `${TYPE_EMOJI[typeFilter] || ""} ${result.total} ${typeFilter} signals:`
        : `${result.total} signals:`;
      ctx.ui.notify(`${header}\n${lines.join("\n")}`, "info");
    },
  });
}
