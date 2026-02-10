/**
 * /sort command — sort unsorted signals into buckets.
 *
 * Checks for signals without a bucket, then asks:
 *   - Automatic: uses get_unsorted_signals → LLM scoring → submit_sort_scores (angel.md + fuzzy prior)
 *   - Manual: opens the browser to the signals page
 *
 * Usage:
 *   /sort          — check unsorted, pick auto or manual
 *   /sort auto     — skip the menu, go straight to auto-sort
 *   /sort manual   — skip the menu, open browser
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getUnsortedSignals } from "../tools/signals";
import { getApiBase } from "../auth";

/**
 * Run the sort flow. Can be called from /sort command or /seedclub menu.
 * If prefetchedResult is provided, skips the unsorted-signals fetch.
 */
export async function runSortFlow(
  pi: ExtensionAPI,
  ctx: any,
  prefetchedResult?: any
) {
  let result = prefetchedResult;

  if (!result) {
    ctx.ui.notify("Checking for unsorted signals…", "info");
    result = await getUnsortedSignals();
    if ("error" in result) {
      ctx.ui.notify(`✗ ${result.error}`, "error");
      return;
    }
  }

  const count = result.unsortedCount ?? result.unsorted?.length ?? 0;

  if (count === 0) {
    ctx.ui.notify("✓ All signals are sorted!", "info");
    return;
  }

  const choice = await ctx.ui.select(
    `Sort ${count} unsorted signal${count === 1 ? "" : "s"}`,
    [
      "🤖  Automatically (AI scores + your taste prior)",
      "🖐️  Manually (open in browser)",
    ]
  );

  if (!choice) return;

  if (choice.includes("Automatically")) {
    return await autoSort(pi, ctx, result);
  } else {
    return await manualSort(pi, ctx);
  }
}

export function registerSortCommand(pi: ExtensionAPI) {
  pi.registerCommand("sort", {
    description: "Sort unsorted signals into buckets. Usage: /sort [auto|manual]",
    handler: async (args, ctx) => {
      const arg = args?.trim().toLowerCase();

      // Quick path: direct subcommand
      if (arg === "auto" || arg === "a") {
        return await autoSort(pi, ctx);
      }
      if (arg === "manual" || arg === "m" || arg === "browse") {
        return await manualSort(pi, ctx);
      }

      // Default: interactive flow
      return await runSortFlow(pi, ctx);
    },
  });
}

async function autoSort(pi: ExtensionAPI, ctx: any, prefetched?: any) {
  // If we already fetched unsorted signals from the menu flow, pass the data along.
  // Otherwise the LLM will call get_unsorted_signals itself.
  if (prefetched) {
    const count = prefetched.unsortedCount ?? prefetched.unsorted?.length ?? 0;
    const prompt = buildAutoSortPrompt(count, prefetched);
    pi.sendUserMessage(prompt);
  } else {
    pi.sendUserMessage(
      "Sort my unsorted signals. Call get_unsorted_signals, score each one across all 10 buckets, then call submit_sort_scores."
    );
  }
}

function buildAutoSortPrompt(count: number, data: any): string {
  // Feed the LLM the prefetched data so it doesn't need to call get_unsorted_signals again
  const signals = data.unsorted || [];
  const angelMd = data.angelMd || "";
  const buckets = data.buckets || {};

  let prompt = `I have ${count} unsorted signals. Score each one across all 10 buckets (0-1), then call submit_sort_scores.\n\n`;

  if (angelMd) {
    prompt += `**My angel.md (investment thesis):**\n${angelMd}\n\n`;
  }

  if (Object.keys(buckets).length) {
    prompt += `**Bucket definitions:**\n`;
    for (const [k, v] of Object.entries(buckets)) {
      prompt += `- ${k}: ${v}\n`;
    }
    prompt += "\n";
  }

  prompt += `**Unsorted signals:**\n`;
  for (const s of signals) {
    const parts = [`- [${s.userSignalId}] ${s.name} (${s.type})`];
    if (s.description) parts.push(`  "${s.description}"`);
    if (s.tags?.length) parts.push(`  tags: ${s.tags.join(", ")}`);
    if (s.externalUrl) parts.push(`  ${s.externalUrl}`);
    prompt += parts.join("\n") + "\n";
  }

  prompt += `\nScore each signal honestly based on what it IS. Then call submit_sort_scores with all the scores. Do NOT call get_unsorted_signals — I've already provided the data above.`;

  return prompt;
}

async function manualSort(pi: ExtensionAPI, ctx: any) {
  const apiBase = getApiBase();
  const isDev = apiBase.includes("localhost") || apiBase.includes("127.0.0.1");
  const url = isDev ? `${apiBase}/signals` : "https://beta.seedclub.com/signals";

  ctx.ui.notify(`Opening signals page…\n${url}`, "info");

  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  pi.exec(openCmd, [url]).catch(() => {
    ctx.ui.notify(`Couldn't open browser. Visit:\n${url}`, "warning");
  });
}
