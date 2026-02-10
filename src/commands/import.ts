/**
 * /import command — bulk import signals from raw text.
 *
 * Examples:
 *   /import @naval @pmarca @balajis @cdixon @sama
 *   /import (opens editor for pasting a big list)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { importSignals } from "../tools/signals";

export function registerImportCommand(pi: ExtensionAPI) {
  pi.registerCommand("import", {
    description: "Bulk import signals. Paste handles, URLs, names — one per line or comma-separated",
    handler: async (args, ctx) => {
      let input = args?.trim();

      // If no args, open editor for multi-line paste
      if (!input) {
        input = await ctx.ui.editor(
          "Paste signals (one per line — @handles, URLs, names):",
          ""
        );
        if (!input?.trim()) {
          ctx.ui.notify("Import cancelled", "info");
          return;
        }
      }

      // Count rough number of items
      const lines = input.split(/[\n,]+/).filter((l: string) => l.trim()).length;
      ctx.ui.notify(`⏳ Importing ~${lines} signals...`, "info");

      const result = await importSignals({ input });

      if ("error" in result) {
        ctx.ui.notify(`✗ ${result.error}`, "error");
        return;
      }

      ctx.ui.notify(
        `✓ Done — ${result.created} created, ${result.skipped} already existed`,
        "info"
      );
    },
  });
}
