# Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record incoming and outgoing WhatsApp messages for a configurable watch list of contacts/groups, stored as JSONL files per contact/group.

**Architecture:** A `watchList` of pre-resolved JIDs is stored in `~/.whatzap/config.json`. The daemon owns this list in memory and exposes IPC commands to mutate it live. Incoming messages are captured via Baileys' `messages.upsert` event; outgoing messages are captured in the existing `send` IPC handler. Four new CLI commands manage the watch list and one restarts the daemon.

**Tech Stack:** TypeScript, `@whiskeysockets/baileys` (WhatsApp Web), Node.js `fs.appendFile`, Unix socket IPC (newline-delimited JSON), ESM (`"type": "module"`, `.js` imports).

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/utils/phone.ts` | **Create** | Shared `normalizePhone` + `jidToFilename` utilities |
| `src/daemon/client.ts` | **Modify** | Generic `sendRequest<T>`, new IPC helpers |
| `src/daemon/server.ts` | **Modify** | Watch set, group cache, serialized config writes, message listener, outgoing logging, new IPC handlers |
| `src/commands/add-watch.ts` | **Create** | `whatzap add-watch` command |
| `src/commands/remove-watch.ts` | **Create** | `whatzap remove-watch` command |
| `src/commands/list-watch.ts` | **Create** | `whatzap list-watch` command |
| `src/commands/restart.ts` | **Create** | `whatzap restart` command |
| `src/commands/send-message.ts` | **Modify** | Import `normalizePhone` from shared utility |
| `src/index.ts` | **Modify** | Register 4 new commands |

---

## Task 1: Extract `normalizePhone` utility

**Files:**
- Create: `src/utils/phone.ts`
- Modify: `src/commands/send-message.ts`

- [ ] **Step 1: Create `src/utils/phone.ts`**

```typescript
import { homedir } from 'os'
import { join } from 'path'

export const WHATZAP_DIR = join(homedir(), '.whatzap')
export const HISTORY_DIR = join(WHATZAP_DIR, 'history')

/**
 * Normalize a phone input (e.g. "+55 (11) 99999-9999") to a WhatsApp JID.
 * Strips +, spaces, hyphens, parentheses. Validates all-digits.
 * Returns e.g. "5511999999999@s.whatsapp.net".
 */
export function normalizePhone(input: string): string {
  let digits = input.startsWith('+') ? input.slice(1) : input
  digits = digits.replace(/[\s\-()]/g, '')
  if (!/^\d+$/.test(digits)) {
    console.error('Invalid phone number.')
    process.exit(1)
  }
  return `${digits}@s.whatsapp.net`
}

/**
 * Convert a JID to a safe filename by replacing '@' with '_' and '.' with '-'.
 * e.g. "5511999999999@s.whatsapp.net" → "5511999999999_s-whatsapp-net"
 */
export function jidToFilename(jid: string): string {
  return jid.replace('@', '_').replace(/\./g, '-')
}
```

- [ ] **Step 2: Update `src/commands/send-message.ts` to import from shared utility**

Replace the inline `normalizePhone` function with an import:

```typescript
import { ensureDaemon, sendViaDaemon } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'

export async function sendMessage(phone: string, text: string): Promise<void> {
  const jid = normalizePhone(phone)
  await ensureDaemon()
  try {
    await sendViaDaemon(jid, text)
    console.log('Message sent.')
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/phone.ts src/commands/send-message.ts
git commit -m "refactor: extract normalizePhone and jidToFilename to shared utility"
```

---

## Task 2: Make `sendRequest` generic and add new IPC client helpers

**Files:**
- Modify: `src/daemon/client.ts`

- [ ] **Step 1: Make `sendRequest` generic and add new IPC helpers**

Replace the `type Response` line and `sendRequest` signature, then add helpers at the bottom:

```typescript
import net from 'net'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const WHATZAP_DIR = join(homedir(), '.whatzap')
const SOCK_PATH = join(WHATZAP_DIR, 'daemon.sock')
const CREDS_PATH = join(WHATZAP_DIR, 'auth', 'creds.json')
const DAEMON_PATH = join(__dirname, 'server.js')

function sendRequest<T extends object>(req: object, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCK_PATH)
    let buf = ''
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
      socket.destroy()
    }

    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => settle(() => reject(new Error('Daemon timeout'))))
    socket.on('error', (err) => settle(() => reject(err)))
    socket.on('connect', () => socket.write(JSON.stringify(req) + '\n'))

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          settle(() => resolve(JSON.parse(line) as T))
        } catch {
          settle(() => reject(new Error('Invalid response from daemon')))
        }
      }
    })
  })
}

export function isDaemonRunning(): Promise<boolean> {
  return sendRequest<{ ok: boolean }>({ command: 'ping' }, 2000).then(() => true).catch(() => false)
}

export async function startDaemon(): Promise<void> {
  const child = spawn(process.execPath, [DAEMON_PATH], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  for (let i = 0; i < 40; i++) {
    await new Promise<void>((r) => setTimeout(r, 500))
    if (await isDaemonRunning()) return
  }

  throw new Error('Daemon failed to start within 20s')
}

export async function ensureDaemon(): Promise<void> {
  if (!existsSync(CREDS_PATH)) {
    console.error("Not logged in. Run 'whatzap login' first.")
    process.exit(1)
  }
  if (await isDaemonRunning()) return
  await startDaemon()
}

export async function sendViaDaemon(jid: string, text: string): Promise<void> {
  const res = await sendRequest<{ ok: boolean; error?: string }>({ command: 'send', jid, text }, 30000)
  if (!res.ok) throw new Error(res.error ?? 'Send failed')
}

export async function stopDaemon(): Promise<void> {
  await sendRequest<{ ok: boolean }>({ command: 'stop' })
}

export async function logoutDaemon(): Promise<void> {
  await sendRequest<{ ok: boolean }>({ command: 'logout' }, 15000)
}

export async function listGroups(): Promise<{ jid: string; name: string }[]> {
  const res = await sendRequest<{ ok: true; groups: { jid: string; name: string }[] }>({ command: 'list-groups' })
  return res.groups
}

export async function watchAdd(jid: string): Promise<{ alreadyPresent: boolean }> {
  const res = await sendRequest<{ ok: true; alreadyPresent: boolean }>({ command: 'watch-add', jid })
  return { alreadyPresent: res.alreadyPresent }
}

export async function watchRemove(jid: string): Promise<{ ok: boolean }> {
  const res = await sendRequest<{ ok: boolean; error?: string }>({ command: 'watch-remove', jid })
  return { ok: res.ok }
}

export async function watchList(): Promise<{ jid: string; name: string }[]> {
  const res = await sendRequest<{ ok: true; list: { jid: string; name: string }[] }>({ command: 'watch-list' })
  return res.list
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/client.ts
git commit -m "feat: make sendRequest generic and add watch/group IPC client helpers"
```

---

## Task 3: Daemon — config helpers, watch set, group cache

**Files:**
- Modify: `src/daemon/server.ts`

This task adds the foundational daemon state without touching IPC handlers yet. We'll add:
1. A `readConfig` / `writeConfig` helper with a serialized write queue
2. Load `watchList` into a `Set<string>` on startup
3. Load group cache into a `Map<string, string>` after connecting

- [ ] **Step 1: Add config helpers and in-memory state to `src/daemon/server.ts`**

Add after the existing imports and constants (after line `const service = new WhatsAppService()`):

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs'
// (merge with existing fs import at top)

// --- Config helpers ---

interface Config {
  contacts?: Record<string, unknown>
  watchList?: string[]
}

function readConfig(): Config {
  if (!existsSync(join(WHATZAP_DIR, 'config.json'))) return {}
  try {
    return JSON.parse(readFileSync(join(WHATZAP_DIR, 'config.json'), 'utf8')) as Config
  } catch {
    return {}
  }
}

// Serialized write queue — prevents concurrent config mutations losing data
let configWriteQueue: Promise<void> = Promise.resolve()

function writeConfig(config: Config): void {
  configWriteQueue = configWriteQueue.then(() => {
    writeFileSync(join(WHATZAP_DIR, 'config.json'), JSON.stringify(config, null, 2))
  })
}

// --- In-memory state ---

const watchSet = new Set<string>(readConfig().watchList ?? [])
const groupCache = new Map<string, string>() // jid → name
```

Note: The `existsSync`, `readFileSync`, `writeFileSync` imports must be merged with the existing `import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'` line at the top.

- [ ] **Step 2: Populate group cache after connecting in `main()`**

After `await service.connect(...)` in `main()`, add:

```typescript
// Populate group cache (best-effort — don't fail daemon startup if this errors)
try {
  const groups = await service.fetchGroups()
  for (const [jid, name] of Object.entries(groups)) {
    groupCache.set(jid, name)
  }
} catch {
  // Group fetch failed — list-groups will return empty until restart
}
```

Also add `fetchGroups()` to `WhatsAppService` in `src/services/whatsapp.ts`:

```typescript
async fetchGroups(): Promise<Record<string, string>> {
  if (!this.socket) throw new Error('Not connected')
  const groups = await this.socket.groupFetchAllParticipating()
  const result: Record<string, string> = {}
  for (const [jid, meta] of Object.entries(groups)) {
    result[jid] = meta.subject
  }
  return result
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/server.ts src/services/whatsapp.ts
git commit -m "feat: add config helpers, watch set, and group cache to daemon"
```

---

## Task 4: Daemon — new IPC command handlers

**Files:**
- Modify: `src/daemon/server.ts`

Add handlers for `list-groups`, `watch-add`, `watch-remove`, `watch-list` inside `handleRequest`.

- [ ] **Step 1: Add new IPC handlers in `handleRequest`**

Add these branches before the final `else` block in `handleRequest`:

```typescript
} else if (req.command === 'list-groups') {
  const groups = Array.from(groupCache.entries()).map(([jid, name]) => ({ jid, name }))
  socket.write(JSON.stringify({ ok: true, groups }) + '\n')

} else if (req.command === 'watch-add') {
  const jid = req.jid!
  const alreadyPresent = watchSet.has(jid)
  watchSet.add(jid)
  const config = readConfig()
  config.watchList = Array.from(watchSet)
  writeConfig(config)
  socket.write(JSON.stringify({ ok: true, alreadyPresent }) + '\n')

} else if (req.command === 'watch-remove') {
  const jid = req.jid!
  if (!watchSet.has(jid)) {
    socket.write(JSON.stringify({ ok: false, error: 'JID not in watch list' }) + '\n')
  } else {
    watchSet.delete(jid)
    const config = readConfig()
    config.watchList = Array.from(watchSet)
    writeConfig(config)
    socket.write(JSON.stringify({ ok: true }) + '\n')
  }

} else if (req.command === 'watch-list') {
  const list = Array.from(watchSet).map((jid) => {
    const name = jid.endsWith('@g.us')
      ? (groupCache.get(jid) ?? jid)
      : jid.replace('@s.whatsapp.net', '')
    return { jid, name }
  })
  socket.write(JSON.stringify({ ok: true, list }) + '\n')
```

Verify the `req` type in `handleRequest` already includes `jid?`:

```typescript
let req: { command: string; jid?: string; text?: string }
```

This is already present in `server.ts` — no change needed. If it isn't there, add it.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Build and verify `list-groups` works:

```bash
npm run build
whatzap stop 2>/dev/null; sleep 1
whatzap send-message +5511999999999 test  # triggers daemon restart
# In a second terminal (--input-type=commonjs needed for inline scripts in ESM projects):
node --input-type=commonjs -e "
const net = require('net');
const s = net.createConnection(process.env.HOME + '/.whatzap/daemon.sock');
s.on('connect', () => s.write(JSON.stringify({command:'list-groups'})+'\n'));
s.on('data', d => { console.log(d.toString()); s.destroy(); });
"
```

Expected: JSON with `ok: true, groups: [...]`.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/server.ts
git commit -m "feat: add list-groups, watch-add, watch-remove, watch-list IPC handlers"
```

---

## Task 5: Daemon — incoming message listener

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/utils/phone.ts` (already has `jidToFilename` — use it)

Add the `messages.upsert` listener after the daemon connects.

- [ ] **Step 1: Add history append helper and incoming message listener to `server.ts`**

Add this import at the top:
```typescript
import { appendFileSync, mkdirSync } from 'fs'
// (merge with existing fs import)
```

Add the helper function and import near the top of the file (after constants):

```typescript
import { jidToFilename, HISTORY_DIR } from '../utils/phone.js'

function appendHistory(jid: string, entry: object): void {
  mkdirSync(HISTORY_DIR, { recursive: true })
  const filename = jidToFilename(jid) + '.jsonl'
  appendFileSync(join(HISTORY_DIR, filename), JSON.stringify(entry) + '\n')
}
```

Add the listener in `main()`, after group cache population:

```typescript
service.onMessage((msg) => {
  const { key, message, pushName } = msg
  if (key.fromMe) return
  const remoteJid = key.remoteJid
  if (!remoteJid || !watchSet.has(remoteJid)) return

  const text =
    message?.conversation ??
    message?.extendedTextMessage?.text
  if (!text) return

  const isGroup = remoteJid.endsWith('@g.us')
  const participant = key.participant
  if (isGroup && !participant) return

  const from = (isGroup ? participant! : remoteJid).replace(/@.*$/, '')

  appendHistory(remoteJid, {
    ts: new Date().toISOString(),
    direction: 'in',
    from,
    name: pushName ?? undefined,
    text,
  })
})
```

Also add `onMessage()` to `WhatsAppService` in `src/services/whatsapp.ts`:

```typescript
onMessage(handler: (msg: { key: import('@whiskeysockets/baileys').WAMessageKey; message: import('@whiskeysockets/baileys').WAMessage['message']; pushName?: string | null }) => void): void {
  if (!this.socket) throw new Error('Not connected')
  this.socket.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      handler({ key: msg.key, message: msg.message, pushName: msg.pushName })
    }
  })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/server.ts src/services/whatsapp.ts src/utils/phone.ts
git commit -m "feat: record incoming messages to history for watched JIDs"
```

---

## Task 6: Daemon — outgoing message logging

**Files:**
- Modify: `src/daemon/server.ts`

Log outgoing messages to history when `send` succeeds and the target JID is watched.

- [ ] **Step 1: Add outgoing history write to the `send` IPC handler**

Find the existing `send` handler in `handleRequest`:

```typescript
} else if (req.command === 'send') {
  try {
    await service.sendMessage(req.jid!, req.text!)
    socket.write(JSON.stringify({ ok: true }) + '\n')
  } catch (err) {
    socket.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + '\n')
  }
```

Add history logging after the successful send:

```typescript
} else if (req.command === 'send') {
  try {
    await service.sendMessage(req.jid!, req.text!)
    socket.write(JSON.stringify({ ok: true }) + '\n')
    if (watchSet.has(req.jid!)) {
      appendHistory(req.jid!, {
        ts: new Date().toISOString(),
        direction: 'out',
        text: req.text!,
      })
    }
  } catch (err) {
    socket.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + '\n')
  }
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/server.ts
git commit -m "feat: record outgoing messages to history for watched JIDs"
```

---

## Task 7: `whatzap restart` command

**Files:**
- Create: `src/commands/restart.ts`

- [ ] **Step 1: Create `src/commands/restart.ts`**

```typescript
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { stopDaemon, ensureDaemon } from '../daemon/client.js'

const SOCK_PATH = join(homedir(), '.whatzap', 'daemon.sock')
const POLL_INTERVAL = 100
const TIMEOUT_MS = 5000

async function waitForSocketGone(): Promise<boolean> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!existsSync(SOCK_PATH)) return true
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL))
  }
  return false
}

export async function restart(): Promise<void> {
  if (existsSync(SOCK_PATH)) {
    try {
      await stopDaemon()
    } catch {
      // Daemon may already be shutting down — proceed to poll
    }
    const stopped = await waitForSocketGone()
    if (!stopped) {
      console.error('Daemon did not stop within 5s')
      process.exitCode = 1
      return
    }
  }
  await ensureDaemon()
  console.log('Daemon restarted.')
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/restart.ts
git commit -m "feat: add restart command"
```

---

## Task 8: `whatzap add-watch` command

**Files:**
- Create: `src/commands/add-watch.ts`

- [ ] **Step 1: Create `src/commands/add-watch.ts`**

```typescript
import { ensureDaemon, listGroups, watchAdd } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'

function isPhoneInput(input: string): boolean {
  const stripped = input.startsWith('+') ? input.slice(1) : input
  return /^[\d\s\-()+]+$/.test(stripped) && /\d{7,}/.test(stripped)
}

export async function addWatch(input: string): Promise<void> {
  await ensureDaemon()

  let jid: string

  if (isPhoneInput(input)) {
    jid = normalizePhone(input)
  } else {
    // Group name — resolve via daemon
    const groups = await listGroups()
    const lower = input.toLowerCase()
    const matches = groups.filter((g) => g.name.toLowerCase() === lower)

    if (matches.length === 0) {
      console.error(`No group found matching '${input}'`)
      process.exitCode = 1
      return
    }
    if (matches.length > 1) {
      const list = matches.map((g) => `${g.name} [${g.jid}]`).join(', ')
      console.error(`Ambiguous name — matches: ${list}`)
      process.exitCode = 1
      return
    }
    jid = matches[0].jid
  }

  const { alreadyPresent } = await watchAdd(jid)
  if (alreadyPresent) {
    console.log(`'${input}' is already being watched.`)
  } else {
    console.log(`Now watching '${input}'.`)
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/add-watch.ts
git commit -m "feat: add add-watch command"
```

---

## Task 9: `whatzap remove-watch` command

**Files:**
- Create: `src/commands/remove-watch.ts`

- [ ] **Step 1: Create `src/commands/remove-watch.ts`**

```typescript
import { ensureDaemon, listGroups, watchRemove } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'

function isPhoneInput(input: string): boolean {
  const stripped = input.startsWith('+') ? input.slice(1) : input
  return /^[\d\s\-()+]+$/.test(stripped) && /\d{7,}/.test(stripped)
}

export async function removeWatch(input: string): Promise<void> {
  await ensureDaemon()

  let jid: string

  if (isPhoneInput(input)) {
    jid = normalizePhone(input)
  } else {
    const groups = await listGroups()
    const lower = input.toLowerCase()
    const matches = groups.filter((g) => g.name.toLowerCase() === lower)

    if (matches.length === 0) {
      console.error(`No group found matching '${input}'`)
      process.exitCode = 1
      return
    }
    if (matches.length > 1) {
      const list = matches.map((g) => `${g.name} [${g.jid}]`).join(', ')
      console.error(`Ambiguous name — matches: ${list}`)
      process.exitCode = 1
      return
    }
    jid = matches[0].jid
  }

  const { ok } = await watchRemove(jid)
  if (!ok) {
    console.error(`'${input}' is not in the watch list`)
    process.exitCode = 1
  } else {
    console.log(`Stopped watching '${input}'.`)
  }
}
```

Note: `isPhoneInput` is duplicated between `add-watch.ts` and `remove-watch.ts`. This is intentional — extracting it is not worth an abstraction for two callers with no variation.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/remove-watch.ts
git commit -m "feat: add remove-watch command"
```

---

## Task 10: `whatzap list-watch` command

**Files:**
- Create: `src/commands/list-watch.ts`

- [ ] **Step 1: Create `src/commands/list-watch.ts`**

```typescript
import { ensureDaemon, watchList } from '../daemon/client.js'

export async function listWatch(): Promise<void> {
  await ensureDaemon()
  const list = await watchList()

  if (list.length === 0) {
    console.log('No contacts or groups are being watched.')
    return
  }

  for (const { jid, name } of list) {
    const display = jid.endsWith('@g.us') ? name : `+${name}`
    console.log(`  ${display}  (${jid})`)
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/list-watch.ts
git commit -m "feat: add list-watch command"
```

---

## Task 11: Register new commands in `index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports and command cases to `src/index.ts`**

Add imports at the top:

```typescript
import { addWatch } from './commands/add-watch.js'
import { removeWatch } from './commands/remove-watch.js'
import { listWatch } from './commands/list-watch.js'
import { restart } from './commands/restart.js'
```

Add cases in the `switch` block:

```typescript
case 'add-watch': {
  const input = args.join(' ')
  if (!input) {
    console.error('Usage: whatzap add-watch <phone|group name>')
    process.exit(1)
  }
  await addWatch(input)
  break
}

case 'remove-watch': {
  const input = args.join(' ')
  if (!input) {
    console.error('Usage: whatzap remove-watch <phone|group name>')
    process.exit(1)
  }
  await removeWatch(input)
  break
}

case 'list-watch':
  await listWatch()
  break

case 'restart':
  await restart()
  break
```

Update the `USAGE` string to include the new commands:

```
  whatzap add-watch <phone|group name>   Start recording messages for a contact or group
  whatzap remove-watch <phone|group name> Stop recording messages for a contact or group
  whatzap list-watch                     List watched contacts and groups
  whatzap restart                        Restart the background session
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: no errors, `dist/` updated.

- [ ] **Step 4: End-to-end manual test**

```bash
# 1. Check list is empty
whatzap list-watch
# Expected: "No contacts or groups are being watched."

# 2. Add a contact
whatzap add-watch +5511999999999
# Expected: "Now watching '+5511999999999'."

# 3. List — should show the contact
whatzap list-watch
# Expected: "+5511999999999  (5511999999999@s.whatsapp.net)"

# 4. Add same contact again
whatzap add-watch +5511999999999
# Expected: "'+5511999999999' is already being watched."

# 5. Remove it
whatzap remove-watch +5511999999999
# Expected: "Stopped watching '+5511999999999'."

# 6. Remove non-existent
whatzap remove-watch +5511999999999
# Expected: error + exit 1

# 7. Add contact back, send a message, check history file
whatzap add-watch +5511999999999
whatzap send-message +5511999999999 hello from history test
cat ~/.whatzap/history/5511999999999_s-whatsapp-net.jsonl
# Expected: JSON line with direction:"out", text:"hello from history test"
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: register add-watch, remove-watch, list-watch, restart commands"
```
