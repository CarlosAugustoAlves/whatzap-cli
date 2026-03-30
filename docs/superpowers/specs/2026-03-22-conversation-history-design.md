# Conversation History Design

**Date:** 2026-03-22
**Status:** Approved

## Overview

Record incoming WhatsApp messages for a configurable watch list of contacts and groups. Messages are stored as JSONL files per contact/group. The watch list is managed via CLI commands and updated live in the running daemon without requiring a restart.

## Runtime Data Layout (`~/.whatzap/`)

| Path | Description |
|---|---|
| `auth/` | Baileys auth state (pre-existing) |
| `daemon.sock` | Unix socket for IPC (pre-existing) |
| `daemon.pid` | PID file (pre-existing) |
| `config.json` | Config including `watchList` (pre-existing, extended) |
| `history/` | **New** — one `.jsonl` file per watched JID |

## Config & Storage

### `~/.whatzap/config.json`

Gains a `watchList` array of resolved JIDs:

```json
{
  "contacts": {},
  "watchList": [
    "5511999999999@s.whatsapp.net",
    "120363000000@g.us"
  ]
}
```

(`contacts` is a pre-existing field not modified by this feature.)

JIDs are stored pre-resolved (phone numbers normalized to `<digits>@s.whatsapp.net`, groups as `<id>@g.us`). The daemon is the source of truth for `watchList` — all mutations go through it. Writes to `config.json` are serialized: the daemon queues mutations and applies them one at a time to prevent lost updates from concurrent IPC requests.

### `~/.whatzap/history/<filename>.jsonl`

One file per watched JID. The filename is derived from the JID by replacing `@` with `_` and `.` with `-`, e.g.:

- `5511999999999_s-whatsapp-net.jsonl` (individual)
- `120363000000_g-us.jsonl` (group)

The `history/` directory is created on first write if it does not exist.

Each line is a JSON object:

```json
{"ts":"2026-03-22T10:00:00Z","direction":"in","from":"5511999999999","name":"Carlos","text":"Hello!"}
```

Fields:
- `ts` — ISO 8601 timestamp
- `direction` — `"in"` for received messages, `"out"` for sent messages
- `from` — sender's phone number (digits only). For incoming individual chats: derived from `key.remoteJid`. For incoming group messages: derived from `key.participant`. For outgoing messages: omitted (the sender is always the authenticated user).
- `name` — sender's WhatsApp display name (`pushName`). Omitted for outgoing messages.
- `text` — message text content

Non-text messages (images, stickers, etc.) are skipped.

## Phone Normalization

All commands that accept a phone number (`add-watch`, `remove-watch`) use the same normalization as `send-message`: strip leading `+`, remove spaces/hyphens/parentheses, validate all-digits, append `@s.whatsapp.net`. This is extracted into a shared utility so that `add-watch +55 (11) 99999-9999` and a later `remove-watch +5511999999999` resolve to the same JID.

## New CLI Commands

All new commands call `ensureDaemon()` before any IPC. If the daemon fails to start (e.g. missing credentials), the error from `ensureDaemon()` is printed and the process exits 1. This applies to `add-watch`, `remove-watch`, and `list-watch`.

### `whatzap add-watch <phone|group name>`

1. Call `ensureDaemon()`
2. Determine input type:
   - **Phone number** (starts with `+` or is all digits after stripping formatting) — normalize using shared utility → JID
   - **Group name** (any other input) — send `list-groups` IPC, match by name (case-insensitive):
     - Zero matches → print `"No group found matching '<name>'"` and exit 1
     - Multiple matches → print `"Ambiguous name — matches: Family [120363@g.us], Family 2 [120364@g.us]"` and exit 1
     - Exactly one match → use its JID
3. Send `watch-add` IPC with resolved JID
4. If daemon responds `{ ok: true, alreadyPresent: true }` → print `"<input> is already being watched."` and exit 0
5. If daemon responds `{ ok: true, alreadyPresent: false }` → print `"Now watching <input>."` and exit 0

### `whatzap remove-watch <phone|group name>`

Same steps as `add-watch` (1–2) to resolve the JID. Then:

3. Send `watch-remove` IPC with resolved JID
4. If daemon responds `{ ok: false }` → print `"<input> is not in the watch list"` and exit 1
5. If daemon responds `{ ok: true }` → print `"Stopped watching <input>."` and exit 0

The CLI uses its own hardcoded message strings and does not forward the daemon's error string verbatim.

### `whatzap list-watch`

1. Call `ensureDaemon()`
2. Send `watch-list` IPC
3. Daemon returns `{ ok: true, list: [{ jid, name }] }` where `name` is:
   - For groups: group subject from daemon's cached group metadata
   - For individuals: raw digits from JID (e.g. `5511999999999`)
4. CLI prepends `+` to individual phone digits when displaying (e.g. `+5511999999999`)
5. If list is empty, prints `"No contacts or groups are being watched."`

### `whatzap restart`

1. If `daemon.sock` does not exist, proceed directly to step 4 (daemon already stopped)
2. Send `stop` IPC to the daemon
3. Poll for `daemon.sock` to disappear (100ms interval, 5s timeout). If it does not disappear within 5 seconds, print `"Daemon did not stop within 5s"` and exit 1
4. Call `ensureDaemon()` to start a fresh daemon

Utility command for connection troubleshooting. Not required for watch list changes — those apply live.

## Daemon Changes

### `src/daemon/client.ts`

`sendRequest` becomes generic: `sendRequest<T extends object>(req): Promise<T>`. Each new IPC helper is typed to its specific response shape:

- `listGroups(): Promise<{ ok: true; groups: { jid: string; name: string }[] }>`
- `watchAdd(jid: string): Promise<{ ok: true; alreadyPresent: boolean }>`
- `watchRemove(jid: string): Promise<{ ok: true } | { ok: false; error: string }>`
- `watchList(): Promise<{ ok: true; list: { jid: string; name: string }[] }>`

### `src/daemon/server.ts`

#### In-memory watch set

On startup, the daemon reads `watchList` from `config.json` (or defaults to `[]` if absent) and stores it as a `Set<string>` in memory. This is the live set used for filtering incoming messages.

#### Group cache

On startup after connecting, the daemon calls `groupFetchAllParticipating()` once and stores the result in memory as a `Map<jid, name>`. This cache is used by `list-groups` and `watch-list` without making additional network calls. The cache is not refreshed during the daemon's lifetime — users who added a new WhatsApp group must restart the daemon for it to appear in `list-groups`.

#### New IPC commands

| Command | Payload | Response | Behavior |
|---|---|---|---|
| `list-groups` | — | `{ ok: true, groups: [{ jid, name }] }` | Returns cached group map |
| `watch-add` | `{ jid }` | `{ ok: true, alreadyPresent: boolean }` | Idempotent — adds JID to in-memory set, serializes write to `config.json` |
| `watch-remove` | `{ jid }` | `{ ok: true }` or `{ ok: false, error: string }` | Removes JID from in-memory set (error if not present), serializes write to `config.json` |
| `watch-list` | — | `{ ok: true, list: [{ jid, name }] }` | Returns in-memory watch set; names from group cache for groups, raw JID digits for individuals |

#### Incoming message listener

After connecting, the daemon subscribes to Baileys' `messages.upsert` event. Only events with `type === 'notify'` are processed (skips history sync replays on reconnect).

For each message in `upsert.messages`:
1. Skip if `key.fromMe === true`
2. Skip if `key.remoteJid` is not in the in-memory watch set
3. Extract text: check `message.conversation` first, then `message.extendedTextMessage?.text`. Skip if neither exists.
4. Derive `from`: for group JIDs (ending in `@g.us`), use `key.participant`. If `key.participant` is absent or empty, skip the message. For individual JIDs, use `key.remoteJid`. Strip the `@...` suffix to get digits only.
5. Append a JSONL entry (`direction: "in"`) to `~/.whatzap/history/<filename>.jsonl` (creating the `history/` directory if needed). Uses `fs.appendFile` with `O_APPEND` flag, which provides atomic append semantics on local filesystems for small writes.

#### Outgoing message logging

When the `send` IPC command succeeds and the target JID is in the in-memory watch set, the daemon appends a JSONL entry with `direction: "out"` to the same history file. The entry omits `from` and `name` (sender is always the authenticated user). Example:

```json
{"ts":"2026-03-22T10:01:00Z","direction":"out","text":"Sure, see you there!"}
```

This happens in the existing `send` IPC handler in `server.ts`, after `service.sendMessage()` resolves successfully.

## File Structure Changes

```
src/
  commands/
    add-watch.ts       # new
    remove-watch.ts    # new
    list-watch.ts      # new
    restart.ts         # new
  daemon/
    server.ts          # modified: watch set, group cache, message listener, new IPC commands
    client.ts          # modified: generic sendRequest, new IPC helper functions
  utils/
    phone.ts           # new — shared normalizePhone utility (extracted from send-message.ts)
  index.ts             # modified: register new commands
```

## Out of Scope

- Message history for media (images, audio, stickers)
- A command to read/tail history from the CLI
- History rotation or size limits
- Live group cache refresh (requires daemon restart to pick up new groups)
