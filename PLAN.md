# Seed Network Pi — Plan

## Current State

The Seed Network pi extension is installed globally via `pi install`. This means every pi session loads ~20+ tools (deals, signals, telegram, twitter, etc.), shows status indicators in the footer, and optionally connects to the mirror relay.

This works fine for development, but is not the right end-state UX. Most pi sessions don't need Seed Network tooling, and having it always present adds noise — status bar clutter, LLM system prompt bloat from unused tools, background connections.

### Online/Offline Toggle (interim solution)

We added `/seed-online` and `/seed-offline` commands that gate the mirror relay connection (the most expensive/noisy piece). The mirror defaults to **off** and must be explicitly enabled. This state persists in `~/.config/seed-network/online`.

This is a reasonable stopgap but doesn't solve the core issue: tools and status indicators are still registered in every session.

---

## Future: `seedclub` CLI via Pi SDK

### The idea

Instead of a global pi extension, ship a standalone CLI (`seedclub`) that wraps pi using the SDK. Users run `seedclub` when they want the Seed Network experience, and `pi` for everything else.

### Why this is right

- **Clean separation**: `pi` stays a clean coding agent, `seedclub` is the Seed Network agent
- **No toggle complexity**: No "offline mode", no conditional tool registration, no status bar management
- **Same UX**: The SDK's `InteractiveMode` gives the full pi TUI — editor, sessions, compaction, model cycling, keyboard shortcuts — identical experience
- **Clear mental model**: Users know which tool they're launching and what it does

### How it works

The pi SDK (`@mariozechner/pi-coding-agent`) exports `createAgentSession()` and `InteractiveMode`. A `seedclub` CLI would be a thin wrapper:

```typescript
import {
  createAgentSession,
  InteractiveMode,
  DefaultResourceLoader,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";

const authStorage = new AuthStorage();
const modelRegistry = new ModelRegistry(authStorage);

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  additionalExtensionPaths: [
    // Load the seed network extension
    require.resolve("@seedclub/pi-extension/src/index.ts"),
  ],
});
await loader.reload();

const { session } = await createAgentSession({
  resourceLoader: loader,
  sessionManager: SessionManager.continueRecent(process.cwd()),
  authStorage,
  modelRegistry,
});

const mode = new InteractiveMode(session);
await mode.run();
```

### Package structure

```
@seedclub/cli
├── src/
│   └── cli.ts          # Entry point — arg parsing, createAgentSession, InteractiveMode
├── package.json        # bin: { "seedclub": "./src/cli.ts" }
└── README.md
```

Dependencies:
- `@mariozechner/pi-coding-agent` (SDK)
- `@seedclub/pi-extension` (this repo, or bundled directly)

### What to preserve

- The existing extension code (tools, mirror, telegram, etc.) stays as-is
- Skills, prompts, scripts all carry over — loaded via the ResourceLoader
- Session files are compatible (same format as pi)
- Can still load other pi extensions alongside

### What changes

- No global `pi install` — install `@seedclub/cli` globally instead
- The extension is loaded programmatically, not via pi's package system
- Could customize the system prompt, default model, or session directory if needed
- Could add seedclub-specific CLI flags (e.g., `--online` to auto-enable mirror)

### When to build this

Once the extension is feature-complete and stable. The current global install approach is fine for development and testing. The CLI wrapper is a packaging/distribution concern, not a feature concern.

### Open questions

- Should `seedclub` use its own session directory, or share with pi?
- Should it have its own `auth.json` / credentials, or share pi's?
- Do we want a custom system prompt, or just pi's default + the extension's CLAUDE.md?
- Package name: `@seedclub/cli`, `seedclub-cli`, `seed-cli`?
