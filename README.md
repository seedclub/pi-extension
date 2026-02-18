# Seed Network Pi Extension

The Seed Network agent for [pi](https://buildwithpi.com) — reads your Telegram, surfaces deal flow, and routes approvals through the Seed Network webapp.

---

## Prerequisites

- **pi** installed ([buildwithpi.com](https://buildwithpi.com))
- A Seed Network account at [beta.seedclub.com](https://beta.seedclub.com)

---

## Installation

```bash
pi install git:git@github.com:seedclub/pi-extension
```

This is a terminal command — no pi session needed. The extension is available the next time you start pi.

---

## Step 1 — Connect to Seed Network

Run in pi:

```
/seed-connect
```

This opens your browser to sign in. Once you approve, pi picks up the token automatically and you'll see `🌱 you@email.com` in the status bar.

Alternatively, pass a token directly if you have one:

```
/seed-connect sn_abc123...
```

---

## Step 2 — Connect Telegram

Run in pi:

```
/telegram-login
```

Pi will walk you through it interactively:

1. **Phone number** — enter your Telegram phone number in international format (e.g. `+14155550123`)
2. **Verification code** — Telegram sends a code to your Telegram app (not SMS by default). Enter it when prompted.
3. **2FA password** — if your account has two-factor authentication enabled, you'll be prompted for that too.

When done you'll see `📱 +1415***0123` in the status bar.

> Your Telegram session is stored at `~/.config/seed-network/telegram/session.json`. Pi reads and writes Telegram messages as your personal account.

---

## Step 3 — Check status

```
/seed-status       → shows your Seed Network email and API base
/telegram-status   → shows your connected phone number
```

---

## Disconnecting

### Disconnect Telegram only

```
/telegram-logout
```

Revokes the session on Telegram's servers (it disappears from Settings → Devices → Active Sessions) and removes the local session file. You can reconnect any time with `/telegram-login`.

### Disconnect Seed Network only

```
/seed-logout
```

Clears your API token and relay config. Re-run `/seed-connect` to reconnect.

### Disconnect everything

```
/seed-logout
/telegram-logout
```

---

## Commands Reference

| Command | What it does |
|---------|-------------|
| `/seed-connect [token]` | Connect to Seed Network (browser flow, or paste token directly) |
| `/seed-logout` | Disconnect from Seed Network |
| `/seed-status` | Show current Seed Network connection |
| `/telegram-login` | Connect your Telegram account (interactive) |
| `/telegram-logout` | Disconnect Telegram and revoke the session |
| `/telegram-status` | Show connected Telegram phone number |

---

## Troubleshooting

**`/seed-connect` opens a browser but nothing happens in pi**
The callback server runs on a random local port. Make sure nothing is blocking localhost connections, then try again.

**`/telegram-login` fails with "Telegram app credentials not configured"**
You need to run `/seed-connect` first — it fetches the shared app credentials automatically.

**`/telegram-login` fails with "FLOOD_WAIT"**
Telegram is rate-limiting code requests. Wait the number of seconds shown, then try again.

**Telegram tools return "Not connected"**
Your session may have been revoked (e.g. you logged out from another device). Run `/telegram-logout` then `/telegram-login` to re-authenticate.
