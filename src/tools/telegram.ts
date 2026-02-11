import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import {
  telegramSessionExists,
  runTelegramScript,
  TelegramNotConnectedError,
} from "../telegram-client";

// Store pi.exec reference for use in handlers
let execFn: ReturnType<typeof createExecFn> | null = null;

function createExecFn(pi: ExtensionAPI) {
  return (cmd: string, args: string[], opts?: { timeout?: number; cwd?: string; signal?: AbortSignal }) =>
    pi.exec(cmd, args, opts);
}

function notConnectedResult() {
  return {
    content: [{ type: "text" as const, text: "Not connected to Telegram. Run /telegram-login to authenticate." }],
    details: { error: "Not connected", code: "NOT_CONNECTED" },
    isError: true,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code || "ERROR";
  return {
    content: [{ type: "text" as const, text: `Telegram error: ${message}` }],
    details: { error: message, code },
    isError: true,
  };
}

function jsonResult(data: any) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// --- Renderers ---

function renderError(details: any, theme: any): Text {
  return new Text(theme.fg("error", `✗ ${details?.error || "Unknown error"}`), 0, 0);
}

function renderChatsCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_chats"));
  if (args.type && args.type !== "all") text += " " + theme.fg("muted", args.type);
  if (args.limit) text += theme.fg("dim", ` (limit: ${args.limit})`);
  return new Text(text, 0, 0);
}

function renderChatsResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);
  const chats = details?.chats || [];
  let text = theme.fg("success", `✓ ${chats.length} chats`);
  if (expanded) {
    for (const c of chats) {
      const unread = c.unreadCount ? theme.fg("warning", ` (${c.unreadCount} unread)`) : "";
      const type = theme.fg("dim", ` [${c.type}]`);
      text += "\n  " + theme.fg("accent", c.name) + type + unread;
    }
  } else if (chats.length > 0) {
    const preview = chats.slice(0, 5).map((c: any) => c.name).join(", ");
    const more = chats.length > 5 ? ` +${chats.length - 5} more` : "";
    text += theme.fg("dim", ` — ${preview}${more}`);
  }
  return new Text(text, 0, 0);
}

function renderReadCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_read "));
  text += theme.fg("accent", args.chat || "");
  if (args.limit) text += theme.fg("dim", ` (${args.limit})`);
  if (args.since) text += theme.fg("dim", ` since ${args.since}`);
  return new Text(text, 0, 0);
}

function renderMessagesResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);
  const messages = details?.messages || [];
  const chatName = details?.chat?.name;
  let text = theme.fg("success", `✓ ${messages.length} messages`);
  if (chatName) text += theme.fg("dim", ` from ${chatName}`);
  if (expanded) {
    for (const m of messages) {
      const sender = m.sender?.name || m.sender?.username || "?";
      const msgText = (m.text || "[media]").slice(0, 120);
      const date = m.date ? new Date(m.date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
      text += "\n  " + theme.fg("accent", sender) + theme.fg("dim", ` ${date}`) + "\n    " + msgText;
    }
  } else if (messages.length > 0) {
    // Show last message preview
    const last = messages[0];
    const sender = last?.sender?.name || last?.sender?.username || "?";
    const preview = (last?.text || "[media]").slice(0, 80);
    text += theme.fg("dim", ` — ${sender}: ${preview}`);
  }
  return new Text(text, 0, 0);
}

function renderSearchCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_search "));
  text += theme.fg("accent", `"${args.query || ""}"`);
  if (args.chat) text += theme.fg("dim", ` in ${args.chat}`);
  return new Text(text, 0, 0);
}

function renderUnreadCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_unread"));
  if (args.minUnread) text += theme.fg("dim", ` (min: ${args.minUnread})`);
  return new Text(text, 0, 0);
}

function renderUnreadResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);
  const chats = details?.chats || [];
  const total = details?.totalUnread || 0;
  let text = theme.fg("success", `✓ ${total} unread`) + theme.fg("dim", ` across ${chats.length} chats`);
  if (expanded || chats.length <= 10) {
    for (const c of chats) {
      const mentions = c.mentionCount ? theme.fg("error", ` @${c.mentionCount}`) : "";
      text += "\n  " + theme.fg("warning", `${c.unreadCount}`) + " " + theme.fg("accent", c.name) + mentions;
    }
  } else {
    const top = chats.slice(0, 5);
    for (const c of top) {
      text += "\n  " + theme.fg("warning", `${c.unreadCount}`) + " " + theme.fg("accent", c.name);
    }
    text += theme.fg("dim", `\n  +${chats.length - 5} more`);
  }
  return new Text(text, 0, 0);
}

function renderInfoCall(args: any, theme: any): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold("telegram_info ")) + theme.fg("accent", args.chat || ""),
    0, 0
  );
}

function renderInfoResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);
  let text = theme.fg("success", `✓ ${details?.name || "?"}`);
  text += theme.fg("dim", ` [${details?.type || "?"}]`);
  if (details?.memberCount) text += theme.fg("dim", ` · ${details.memberCount} members`);
  if (expanded) {
    if (details?.description) text += "\n  " + theme.fg("dim", details.description.slice(0, 200));
    if (details?.username) text += "\n  " + theme.fg("accent", `@${details.username}`);
    const members = details?.members || [];
    if (members.length > 0) {
      text += "\n  " + theme.fg("dim", `Members: ${members.slice(0, 10).map((m: any) => m.name).join(", ")}`);
      if (members.length > 10) text += theme.fg("dim", ` +${members.length - 10} more`);
    }
  }
  return new Text(text, 0, 0);
}

function renderSendCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_send "));
  text += theme.fg("accent", args.chat || "");
  text += theme.fg("dim", ` "${(args.message || "").slice(0, 60)}${(args.message || "").length > 60 ? "..." : ""}"`);
  return new Text(text, 0, 0);
}

function renderSendResult(result: any, _opts: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);
  if (details?.cancelled) return new Text(theme.fg("warning", "✗ Cancelled"), 0, 0);
  return new Text(theme.fg("success", `✓ Sent to ${details?.chat || "?"}`), 0, 0);
}

function renderContactsCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_contacts"));
  if (args.search) text += " " + theme.fg("accent", `"${args.search}"`);
  return new Text(text, 0, 0);
}

function renderContactsResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);
  const contacts = details?.contacts || [];
  let text = theme.fg("success", `✓ ${contacts.length} contacts`);
  if (expanded) {
    for (const c of contacts) {
      const username = c.username ? theme.fg("dim", ` @${c.username}`) : "";
      text += "\n  " + theme.fg("accent", c.name) + username;
    }
  } else if (contacts.length > 0) {
    const preview = contacts.slice(0, 5).map((c: any) => c.name).join(", ");
    text += theme.fg("dim", ` — ${preview}${contacts.length > 5 ? ` +${contacts.length - 5} more` : ""}`);
  }
  return new Text(text, 0, 0);
}

function renderSyncCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_sync"));
  if (args.full) text += theme.fg("warning", " --full");
  if (args.chats?.length) text += theme.fg("dim", ` (${args.chats.join(", ")})`);
  return new Text(text, 0, 0);
}

function renderSyncResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);
  let text = theme.fg("success", `✓ Synced ${details?.messagesSynced || 0} messages`);
  if (details?.chatsSynced) text += theme.fg("dim", ` across ${details.chatsSynced} chats`);
  if (expanded && details?.chatDetails) {
    for (const c of details.chatDetails) {
      text += "\n  " + theme.fg("accent", c.chat) + theme.fg("dim", ` — ${c.created} new, ${c.updated} updated, ${c.skipped} skipped`);
    }
  }
  return new Text(text, 0, 0);
}

function renderDigestCall(args: any, theme: any): Text {
  let text = theme.fg("toolTitle", theme.bold("telegram_digest"));
  if (args.chats?.length) text += theme.fg("dim", ` (${args.chats.join(", ")})`);
  if (args.includeRead) text += theme.fg("dim", " +read");
  if (args.dryRun) text += theme.fg("warning", " [dry run]");
  return new Text(text, 0, 0);
}

function renderDigestResult(result: any, { expanded }: any, theme: any): Text {
  const details = result.details;
  if (details?.error) return renderError(details, theme);

  const chats = details?.chats || [];
  const total = details?.totalNewMessages || 0;

  if (total === 0) {
    return new Text(theme.fg("dim", "✓ No new messages since last digest"), 0, 0);
  }

  let text = theme.fg("success", `✓ ${total} new messages`) + theme.fg("dim", ` across ${chats.length} chats`);
  if (details?.dryRun) text += theme.fg("warning", " [dry run — watermarks not updated]");

  for (const c of chats) {
    if (c.error) {
      text += "\n  " + theme.fg("error", `✗ ${c.chat?.name}: ${c.error}`);
      continue;
    }
    if (c.newCount === 0) continue;

    text += "\n  " + theme.fg("accent", c.chat?.name || "?") + theme.fg("dim", ` (${c.newCount} messages)`);

    if (expanded && c.messages) {
      // Show first and last few messages as preview
      const msgs = c.messages;
      const preview = msgs.length <= 6 ? msgs : [...msgs.slice(0, 3), null, ...msgs.slice(-3)];
      for (const m of preview) {
        if (m === null) {
          text += "\n    " + theme.fg("dim", `... ${msgs.length - 6} more ...`);
          continue;
        }
        const sender = m.sender?.name || m.sender?.username || "?";
        const msgText = (m.text || "[media]").slice(0, 100);
        text += "\n    " + theme.fg("dim", sender + ":") + " " + msgText;
      }
    }
  }

  return new Text(text, 0, 0);
}

// --- Tool Handlers ---

async function telegramChats(args: { limit?: number; type?: string; archived?: boolean }) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  const scriptArgs: string[] = [];
  if (args.limit) scriptArgs.push("--limit", String(args.limit));
  if (args.type && args.type !== "all") scriptArgs.push("--type", args.type);
  if (args.archived) scriptArgs.push("--archived");
  return runTelegramScript(execFn!, "chats.py", scriptArgs);
}

async function telegramRead(args: {
  chat: string; limit?: number; offsetId?: number;
  since?: string; until?: string; fromUser?: string;
}) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  const scriptArgs: string[] = [args.chat];
  if (args.limit) scriptArgs.push("--limit", String(args.limit));
  if (args.offsetId) scriptArgs.push("--offset-id", String(args.offsetId));
  if (args.since) scriptArgs.push("--since", args.since);
  if (args.until) scriptArgs.push("--until", args.until);
  if (args.fromUser) scriptArgs.push("--from-user", args.fromUser);
  return runTelegramScript(execFn!, "read.py", scriptArgs, { timeout: 60000 });
}

async function telegramSearch(args: {
  query: string; chat?: string; limit?: number;
  fromUser?: string; since?: string;
}) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  const scriptArgs: string[] = [args.query];
  if (args.chat) scriptArgs.push("--chat", args.chat);
  if (args.limit) scriptArgs.push("--limit", String(args.limit));
  if (args.fromUser) scriptArgs.push("--from-user", args.fromUser);
  if (args.since) scriptArgs.push("--since", args.since);
  return runTelegramScript(execFn!, "search.py", scriptArgs, { timeout: 60000 });
}

async function telegramUnread(args: { limit?: number; minUnread?: number }) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  const scriptArgs: string[] = [];
  if (args.limit) scriptArgs.push("--limit", String(args.limit));
  if (args.minUnread) scriptArgs.push("--min-unread", String(args.minUnread));
  return runTelegramScript(execFn!, "unread.py", scriptArgs);
}

async function telegramInfo(args: { chat: string }) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  return runTelegramScript(execFn!, "info.py", [args.chat], { timeout: 60000 });
}

async function telegramContacts(args: { search?: string }) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  const scriptArgs: string[] = [];
  if (args.search) scriptArgs.push("--search", args.search);
  return runTelegramScript(execFn!, "contacts.py", scriptArgs);
}

async function telegramDigest(args: { chats?: string[]; limit?: number; includeRead?: boolean; dryRun?: boolean }) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  const scriptArgs: string[] = [];
  if (args.limit) scriptArgs.push("--limit", String(args.limit));
  if (args.includeRead) scriptArgs.push("--include-read");
  if (args.dryRun) scriptArgs.push("--dry-run");
  if (args.chats?.length) scriptArgs.push("--chats", args.chats.join(","));
  return runTelegramScript(execFn!, "digest.py", scriptArgs, { timeout: 120000 });
}

async function telegramSync(args: { full?: boolean; chats?: string[]; limit?: number }) {
  if (!telegramSessionExists()) throw new TelegramNotConnectedError();
  const scriptArgs: string[] = [];
  if (args.full) scriptArgs.push("--full");
  if (args.limit) scriptArgs.push("--limit", String(args.limit));
  if (args.chats) {
    for (const chat of args.chats) {
      scriptArgs.push("--chat", chat);
    }
  }
  return runTelegramScript(execFn!, "sync-all.py", scriptArgs, { timeout: 300000 });
}

// --- Registration ---

export function registerTelegramTools(pi: ExtensionAPI) {
  execFn = createExecFn(pi);

  pi.registerTool({
    name: "telegram_chats",
    label: "Telegram Chats",
    description: "List Telegram dialogs (groups, channels, DMs). Filter by type. Start here to discover chat names for other tools.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max chats to return (default: 50)" })),
      type: Type.Optional(StringEnum(["group", "supergroup", "channel", "user", "bot", "all"] as const, {
        description: "Filter by chat type (default: all)",
      })),
      archived: Type.Optional(Type.Boolean({ description: "Include archived chats" })),
    }),
    renderCall: renderChatsCall,
    renderResult: renderChatsResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await telegramChats(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_read",
    label: "Telegram Read",
    description: "Read recent messages from a specific Telegram chat. Supports date range, sender filter, and pagination. Chat can be a name, @username, or numeric ID.",
    parameters: Type.Object({
      chat: Type.String({ description: "Chat name, @username, or numeric ID" }),
      limit: Type.Optional(Type.Number({ description: "Max messages (default: 50, max: 200)" })),
      offsetId: Type.Optional(Type.Number({ description: "Start from this message ID (for pagination)" })),
      since: Type.Optional(Type.String({ description: "Only messages after this date (ISO 8601 or YYYY-MM-DD)" })),
      until: Type.Optional(Type.String({ description: "Only messages before this date" })),
      fromUser: Type.Optional(Type.String({ description: "Filter by sender (@username or user ID)" })),
    }),
    renderCall: renderReadCall,
    renderResult: renderMessagesResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await telegramRead(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_search",
    label: "Telegram Search",
    description: "Search messages across all Telegram chats or within a specific chat.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      chat: Type.Optional(Type.String({ description: "Limit search to this chat (name, @username, or ID)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
      fromUser: Type.Optional(Type.String({ description: "Filter by sender" })),
      since: Type.Optional(Type.String({ description: "Only messages after this date" })),
    }),
    renderCall: renderSearchCall,
    renderResult: renderMessagesResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await telegramSearch(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_send",
    label: "Telegram Send",
    description: "Send a message to a Telegram chat. Requires user confirmation before sending.",
    parameters: Type.Object({
      chat: Type.String({ description: "Chat name, @username, or numeric ID" }),
      message: Type.String({ description: "Message text to send" }),
      replyTo: Type.Optional(Type.Number({ description: "Message ID to reply to" })),
    }),
    renderCall: renderSendCall,
    renderResult: renderSendResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!telegramSessionExists()) return notConnectedResult();

      const ok = await ctx.ui.confirm(
        "Send Telegram Message",
        `To: ${params.chat}\n\n${params.message}${params.replyTo ? `\n\n(reply to #${params.replyTo})` : ""}`
      );
      if (!ok) {
        return {
          content: [{ type: "text" as const, text: "Message send cancelled by user." }],
          details: { cancelled: true },
        };
      }

      try {
        const scriptArgs: string[] = [params.chat, params.message];
        if (params.replyTo) scriptArgs.push("--reply-to", String(params.replyTo));
        const result = await runTelegramScript(execFn!, "send.py", scriptArgs);
        return jsonResult(result);
      } catch (e) {
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_unread",
    label: "Telegram Unread",
    description: "List Telegram chats with unread messages, sorted by unread count. Good starting point for triage.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max chats to return (default: 20)" })),
      minUnread: Type.Optional(Type.Number({ description: "Minimum unread count to include (default: 1)" })),
    }),
    renderCall: renderUnreadCall,
    renderResult: renderUnreadResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await telegramUnread(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_info",
    label: "Telegram Info",
    description: "Get metadata about a Telegram chat: description, members, pinned messages, admins.",
    parameters: Type.Object({
      chat: Type.String({ description: "Chat name, @username, or numeric ID" }),
    }),
    renderCall: renderInfoCall,
    renderResult: renderInfoResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await telegramInfo(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_contacts",
    label: "Telegram Contacts",
    description: "List or search Telegram contacts.",
    parameters: Type.Object({
      search: Type.Optional(Type.String({ description: "Search contacts by name or username" })),
    }),
    renderCall: renderContactsCall,
    renderResult: renderContactsResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await telegramContacts(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_digest",
    label: "Telegram Digest",
    description: "Fetch all new messages since the last digest across your Telegram chats. Uses watermarks to track what's been processed — won't repeat messages even if you've read them in the Telegram app. Returns messages grouped by chat for the LLM to extract action items, followups, and mentions.",
    parameters: Type.Object({
      chats: Type.Optional(Type.Array(Type.String(), { description: "Only digest these chats (default: all with unread)" })),
      limit: Type.Optional(Type.Number({ description: "Max messages per chat (default: 100)" })),
      includeRead: Type.Optional(Type.Boolean({ description: "Also check previously-digested chats even if 0 unread in Telegram" })),
      dryRun: Type.Optional(Type.Boolean({ description: "Fetch but don't update watermarks (preview mode)" })),
    }),
    renderCall: renderDigestCall,
    renderResult: renderDigestResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        onUpdate?.({
          content: [{ type: "text" as const, text: "Fetching new messages since last digest..." }],
        });
        const result = await telegramDigest(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });

  pi.registerTool({
    name: "telegram_sync",
    label: "Telegram Sync",
    description: "Sync Telegram chats and messages to the Seed Network database. Run this to populate the DB for fast querying. Requires both Telegram and Seed Network connections.",
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({ description: "Full backfill (default: incremental, recent messages only)" })),
      chats: Type.Optional(Type.Array(Type.String(), { description: "Sync specific chat names only" })),
      limit: Type.Optional(Type.Number({ description: "Messages per chat (default: 200)" })),
    }),
    renderCall: renderSyncCall,
    renderResult: renderSyncResult,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        onUpdate?.({
          content: [{ type: "text" as const, text: "Syncing Telegram messages to Seed Network..." }],
        });
        const result = await telegramSync(params);
        return jsonResult(result);
      } catch (e) {
        if (e instanceof TelegramNotConnectedError) return notConnectedResult();
        return errorResult(e);
      }
    },
  });
}
