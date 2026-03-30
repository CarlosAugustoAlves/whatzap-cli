# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript → dist/
npx tsc --noEmit     # Type-check without emitting
npm start            # Run via tsx (dev, no compile step)
node dist/index.js   # Run compiled output
```

No test suite — verification is manual against a real WhatsApp account.

## Architecture

`whatzap` is a TypeScript CLI for sending WhatsApp messages from the terminal and recording conversation history. It uses `@whiskeysockets/baileys` (WhatsApp Web protocol) and is structured around a **daemon pattern**:

**Daemon architecture:** A long-lived background process (`src/daemon/server.ts`) maintains the Baileys WebSocket connection to WhatsApp. CLI commands communicate with it via a Unix domain socket at `~/.whatzap/daemon.sock`. This avoids reconnecting on every invocation.

**Data flow:**
```
process.argv
  → src/index.ts          (parse command, dispatch)
    → src/commands/*.ts   (command handlers)
      → src/daemon/client.ts  (IPC over Unix socket)
        → src/daemon/server.ts  (background process, holds WhatsAppService)
          → src/services/whatsapp.ts  (Baileys socket + ~/.whatzap/auth/)
```

**Key files:**
- `src/services/whatsapp.ts` — `WhatsAppService` owns the Baileys socket lifecycle. `connect()` resolves only when `connectionState === 'open'`. Includes retry logic (max 5 attempts, 1.5s delay) and silenced Baileys logger. Also exposes `fetchGroups()` and `onMessage()` for history features.
- `src/daemon/server.ts` — Spawned detached by `startDaemon()`. Connects to WhatsApp, then listens on `daemon.sock` for JSON-newline IPC. Manages in-memory `watchSet` (JIDs to record) and `groupCache` (JID → name). Writes PID to `~/.whatzap/daemon.pid`. Cleans up socket/PID on exit.
- `src/daemon/client.ts` — Client-side IPC helpers: `isDaemonRunning()`, `startDaemon()`, `ensureDaemon()`, `sendViaDaemon()`, `stopDaemon()`, `listGroups()`, `watchAdd()`, `watchRemove()`, `watchList()`.
- `src/utils/phone.ts` — Shared `normalizePhone()` and `jidToFilename()` utilities, plus `WHATZAP_DIR` / `HISTORY_DIR` path constants.
- `src/utils/settings.ts` — `readSettings()` and `writeSettings()` for CLI commands. Reads/writes `~/.whatzap/settings.json`.
- `src/commands/setting.ts` — Handles `whatzap setting set default-country-code <code>`. Writes `defaultCountryCode` to `settings.json` via `writeSettings()`.
- `src/commands/login.ts` — If daemon already running: prints "Already logged in." If creds exist but no daemon: starts daemon. Otherwise: QR scan flow, then starts daemon.
- `src/commands/send-message.ts` — Normalizes phone to JID (`digits@s.whatsapp.net`), calls `ensureDaemon()` (starts daemon if needed), then `sendViaDaemon()`.
- `src/commands/add-watch.ts` — Resolves phone or group name to JID, sends `watch-add` IPC. Live update — no restart needed.
- `src/commands/remove-watch.ts` — Same resolution, sends `watch-remove` IPC.
- `src/commands/list-watch.ts` — Sends `watch-list` IPC, prints watched contacts/groups.
- `src/commands/restart.ts` — Stops daemon, polls for socket removal, restarts via `ensureDaemon()`.

**IPC commands (daemon ↔ client):**

| Command | Payload | Description |
|---|---|---|
| `ping` | — | Health check |
| `send` | `{ jid, text }` | Send message (also logs to history if JID is watched) |
| `stop` | — | Graceful shutdown |
| `logout` | — | Log out from WhatsApp |
| `list-groups` | — | Returns cached `[{ jid, name }]` |
| `watch-add` | `{ jid }` | Add JID to watch set, persist config |
| `watch-remove` | `{ jid }` | Remove JID from watch set, persist config |
| `watch-list` | — | Returns current watch set with names |

**Runtime data at `~/.whatzap/`:**
- `auth/creds.json` + session files — Baileys auth state (persisted by `useMultiFileAuthState`)
- `settings.json` — Persisted daemon configuration (see below)
- `daemon.sock` — Unix socket for IPC
- `daemon.pid` — PID file for the background daemon
- `history/<jid>.jsonl` — One file per watched JID; newline-delimited JSON entries with `ts`, `d` (`in`/`out`), `n` (sender name, incoming only), `text`

**`settings.json` schema:**
```json
{
  "watchList": ["5511999999999@s.whatsapp.net", "120363417135713951@g.us"],
  "defaultCountryCode": "55"
}
```

| Field | Type | Description |
|---|---|---|
| `watchList` | `string[]` | JIDs to record history for. Managed via `watch-add`/`watch-remove` IPC — edit manually only when daemon is stopped. |
| `defaultCountryCode` | `string \| undefined` | Prepended to phone numbers without a `+` prefix. Set via `whatzap setting set default-country-code <code>` or prompted after first login. |

**History filename format:** JID with `@` → `_` and `.` → `-`, e.g. `5511999999999_s-whatsapp-net.jsonl`.

## TypeScript notes

- ESM package (`"type": "module"`) — all local imports must use `.js` extensions (e.g., `'../services/whatsapp.js'`)
- Module resolution: `NodeNext` (required by Baileys)
- `skipLibCheck: true` — Baileys ships types that don't fully satisfy strict checks
- The daemon server (`src/daemon/server.ts`) runs as a plain Node.js file after compilation; `client.ts` launches it with `process.execPath` pointing to `dist/daemon/server.js`
