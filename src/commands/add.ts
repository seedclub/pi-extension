/**
 * /add command — instant signal creation without LLM involvement.
 *
 * Examples:
 *   /add @naval
 *   /add @naval @pmarca @balajis
 *   /add https://stratechery.com
 *   /add Stripe
 *   /add github.com/torvalds
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createSignal, importSignals } from "../tools/signals";

interface ParsedSignal {
  type: string;
  name: string;
  externalUrl?: string;
  metadata?: Record<string, unknown>;
}

function parseInput(raw: string): ParsedSignal[] {
  // Split on commas, newlines, or multiple spaces (but not single spaces in names)
  const items = raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // If only one item with spaces and no special characters, treat as single entry
  if (items.length === 1 && !items[0].includes("@") && !items[0].includes("/") && !items[0].includes(".")) {
    return [{ type: "person", name: items[0] }];
  }

  // For items with @handles or URLs mixed with spaces, re-split on whitespace
  const expanded: string[] = [];
  for (const item of items) {
    if (item.includes("@") || item.includes("://") || item.includes(".com") || item.includes(".io")) {
      expanded.push(...item.split(/\s+/).filter(Boolean));
    } else {
      expanded.push(item);
    }
  }

  return expanded.map(classify);
}

function classify(input: string): ParsedSignal {
  const s = input.trim();

  // Twitter handle: @username
  if (s.startsWith("@")) {
    const handle = s.slice(1).replace(/\/$/, "");
    return {
      type: "twitter_account",
      name: handle,
      externalUrl: `https://x.com/${handle}`,
      metadata: { handle },
    };
  }

  // Twitter URL
  const twitterMatch = s.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
  if (twitterMatch) {
    const handle = twitterMatch[1];
    return {
      type: "twitter_account",
      name: handle,
      externalUrl: `https://x.com/${handle}`,
      metadata: { handle },
    };
  }

  // GitHub URL
  const ghMatch = s.match(/github\.com\/([a-zA-Z0-9_-]+)/);
  if (ghMatch) {
    return {
      type: "github_profile",
      name: ghMatch[1],
      externalUrl: `https://github.com/${ghMatch[1]}`,
    };
  }

  // Substack
  if (s.includes("substack.com")) {
    const name = s.match(/([a-zA-Z0-9-]+)\.substack\.com/)?.[1] || s;
    return {
      type: "newsletter",
      name: name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      externalUrl: s.startsWith("http") ? s : `https://${s}`,
    };
  }

  // Reddit
  if (s.startsWith("r/") || s.includes("reddit.com/r/")) {
    const sub = s.match(/r\/([a-zA-Z0-9_]+)/)?.[1] || s;
    return {
      type: "subreddit",
      name: `r/${sub}`,
      externalUrl: `https://reddit.com/r/${sub}`,
    };
  }

  // URL (generic blog/company)
  if (s.includes("://") || s.match(/^[a-zA-Z0-9-]+\.[a-z]{2,}/)) {
    const url = s.startsWith("http") ? s : `https://${s}`;
    const domain = url.replace(/https?:\/\//, "").replace(/\/.*/, "").replace(/^www\./, "");
    const name = domain.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      type: "blog",
      name,
      externalUrl: url,
    };
  }

  // Plain text — could be a person or company or topic
  // If it looks like a name (2-3 capitalized words), treat as person
  if (s.match(/^[A-Z][a-z]+ [A-Z][a-z]+/)) {
    return { type: "person", name: s };
  }

  // Default: topic
  return { type: "topic", name: s };
}

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

export function registerAddCommand(pi: ExtensionAPI) {
  pi.registerCommand("add", {
    description: "Add signal(s) instantly. Usage: /add @naval or /add @user1 @user2",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /add @handle, company name, URL, or topic", "warning");
        return;
      }

      const raw = args.trim();
      const parsed = parseInput(raw);

      if (parsed.length === 0) {
        ctx.ui.notify("Couldn't parse any signals from input", "error");
        return;
      }

      // For bulk (3+), use the import endpoint — it's faster and dedupes
      if (parsed.length >= 3) {
        ctx.ui.notify(`Importing ${parsed.length} signals...`, "info");
        const result = await importSignals({ input: raw });
        if ("error" in result) {
          ctx.ui.notify(`✗ ${result.error}`, "error");
          return;
        }
        ctx.ui.notify(
          `✓ ${result.created} created, ${result.skipped} skipped`,
          "info"
        );
        return;
      }

      // For 1-2 signals, create individually for richer feedback
      const results: string[] = [];
      for (const signal of parsed) {
        const result = await createSignal(signal as any);
        if ("error" in result) {
          results.push(`  ✗ ${signal.name}: ${result.error}`);
        } else {
          const emoji = TYPE_EMOJI[signal.type] || "📌";
          results.push(`  ${emoji} ${result.name} (${signal.type})`);
        }
      }

      ctx.ui.notify(`✓ Added:\n${results.join("\n")}`, "info");
    },
  });
}
