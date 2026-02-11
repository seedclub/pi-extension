import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
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

// --- API-backed handlers (for DB-powered tools) ---

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
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!telegramSessionExists()) return notConnectedResult();

      // Require user confirmation before sending
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
    name: "telegram_sync",
    label: "Telegram Sync",
    description: "Sync Telegram chats and messages to the Seed Network database. Run this to populate the DB for fast querying. Requires both Telegram and Seed Network connections.",
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({ description: "Full backfill (default: incremental, recent messages only)" })),
      chats: Type.Optional(Type.Array(Type.String(), { description: "Sync specific chat names only" })),
      limit: Type.Optional(Type.Number({ description: "Messages per chat (default: 200)" })),
    }),
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
