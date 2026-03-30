# whatzap Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package whatzap-cli as a distributable Claude Code plugin with a `/whatzap:send` skill, and add `whatzap setting set default-country-code` CLI command with post-login prompt.

**Architecture:** Skills-only plugin (no MCP). Plugin files live at repo root alongside CLI source. A new `src/utils/settings.ts` centralizes settings read/write for CLI commands. `normalizePhone()` gains an optional country code parameter.

**Tech Stack:** TypeScript (ESM/NodeNext), Node.js readline (stdin prompt), Claude Code plugin format (`.claude-plugin/plugin.json` + `skills/`)

---

## File Map

**New files:**
- `src/utils/settings.ts` — shared `readSettings()` / `writeSettings()` for CLI commands
- `src/commands/setting.ts` — `whatzap setting set default-country-code <code>`
- `.claude-plugin/plugin.json` — plugin manifest
- `skills/send/SKILL.md` — unified `/whatzap:send` skill

**Modified files:**
- `src/utils/phone.ts` — `normalizePhone(phone, countryCode?)` accepts optional country code
- `src/commands/send-message.ts` — reads settings, passes country code to `normalizePhone`
- `src/commands/add-watch.ts` — reads settings, passes country code to `normalizePhone`
- `src/commands/remove-watch.ts` — reads settings, passes country code to `normalizePhone`
- `src/commands/login.ts` — post-QR-scan prompt to set country code
- `src/index.ts` — register `setting` command, update USAGE
- `CLAUDE.md` — document `setting` command and updated `settings.json` schema
- `~/.claude/skills/whatzap/SKILL.md` — remove hardcoded `+55` logic, add `setting` command

---

## Task 1: Create shared settings utility

**Files:**
- Create: `src/utils/settings.ts`

- [ ] **Step 1: Create `src/utils/settings.ts`**

```typescript
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { WHATZAP_DIR } from './phone.js'
import { join } from 'path'

const SETTINGS_PATH = join(WHATZAP_DIR, 'settings.json')

export interface Settings {
  watchList?: string[]
  defaultCountryCode?: string
}

export function readSettings(): Settings {
  if (!existsSync(SETTINGS_PATH)) return {}
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Settings
  } catch {
    return {}
  }
}

export function writeSettings(patch: Partial<Settings>): void {
  const current = readSettings()
  const updated = { ...current, ...patch }
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2))
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/settings.ts
git commit -m "feat: add shared settings read/write utility"
```

---

## Task 2: Update `normalizePhone()` to accept a country code

**Files:**
- Modify: `src/utils/phone.ts`

- [ ] **Step 1: Update `normalizePhone()`**

Replace lines 12–20 in `src/utils/phone.ts`:

```typescript
/**
 * Normalize a phone input (e.g. "+55 (11) 99999-9999") to a WhatsApp JID.
 * Strips +, spaces, hyphens, parentheses. Validates all-digits.
 * If input has no leading + and defaultCountryCode is provided, prepends it.
 * Returns e.g. "5511999999999@s.whatsapp.net".
 */
export function normalizePhone(input: string, defaultCountryCode?: string): string {
  const hasPlus = input.startsWith('+')
  let digits = hasPlus ? input.slice(1) : input
  digits = digits.replace(/[\s\-()]/g, '')
  if (!/^\d+$/.test(digits)) {
    console.error('Invalid phone number.')
    process.exit(1)
  }
  if (!hasPlus && defaultCountryCode) {
    digits = `${defaultCountryCode}${digits}`
  }
  return `${digits}@s.whatsapp.net`
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/phone.ts
git commit -m "feat: normalizePhone accepts optional defaultCountryCode"
```

---

## Task 3: Thread country code through send-message, add-watch, remove-watch

**Files:**
- Modify: `src/commands/send-message.ts`
- Modify: `src/commands/add-watch.ts`
- Modify: `src/commands/remove-watch.ts`

- [ ] **Step 1: Update `src/commands/send-message.ts`**

```typescript
import { ensureDaemon, sendViaDaemon } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'
import { readSettings } from '../utils/settings.js'

export async function sendMessage(phone: string, text: string): Promise<void> {
  const { defaultCountryCode } = readSettings()
  const jid = normalizePhone(phone, defaultCountryCode)

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

- [ ] **Step 2: Update `src/commands/add-watch.ts`**

Add `readSettings` import and pass `defaultCountryCode` to `normalizePhone`:

```typescript
import { ensureDaemon, listGroups, watchAdd } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'
import { readSettings } from '../utils/settings.js'

function isPhoneInput(input: string): boolean {
  const stripped = input.startsWith('+') ? input.slice(1) : input
  return /^[\d\s\-()+]+$/.test(stripped) && /\d{7,}/.test(stripped)
}

export async function addWatch(input: string): Promise<void> {
  await ensureDaemon()

  let jid: string

  if (isPhoneInput(input)) {
    const { defaultCountryCode } = readSettings()
    jid = normalizePhone(input, defaultCountryCode)
  } else {
    const groups = await listGroups()
    const lower = input.toLowerCase()
    const matches = groups.filter((g) => g.name.trim().toLowerCase() === lower)

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

- [ ] **Step 3: Update `src/commands/remove-watch.ts`**

Add `readSettings` import and pass `defaultCountryCode` to `normalizePhone`:

```typescript
import { ensureDaemon, listGroups, watchRemove } from '../daemon/client.js'
import { normalizePhone } from '../utils/phone.js'
import { readSettings } from '../utils/settings.js'

function isPhoneInput(input: string): boolean {
  const stripped = input.startsWith('+') ? input.slice(1) : input
  return /^[\d\s\-()+]+$/.test(stripped) && /\d{7,}/.test(stripped)
}

export async function removeWatch(input: string): Promise<void> {
  await ensureDaemon()

  let jid: string

  if (isPhoneInput(input)) {
    const { defaultCountryCode } = readSettings()
    jid = normalizePhone(input, defaultCountryCode)
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

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/send-message.ts src/commands/add-watch.ts src/commands/remove-watch.ts
git commit -m "feat: use defaultCountryCode from settings in phone normalization"
```

---

## Task 4: Create `whatzap setting set default-country-code` command

**Files:**
- Create: `src/commands/setting.ts`

- [ ] **Step 1: Create `src/commands/setting.ts`**

```typescript
import { writeSettings } from '../utils/settings.js'

export function setting(args: string[]): void {
  // whatzap setting set default-country-code <code>
  const [sub, key, value] = args

  if (sub === 'set' && key === 'default-country-code') {
    if (!value || !/^\d{1,4}$/.test(value)) {
      console.error('Usage: whatzap setting set default-country-code <digits>')
      console.error('Examples: 55 (Brazil), 1 (USA), 44 (UK)')
      process.exitCode = 1
      return
    }
    writeSettings({ defaultCountryCode: value })
    console.log(`Default country code set to ${value}.`)
    return
  }

  console.error('Usage: whatzap setting set default-country-code <code>')
  process.exitCode = 1
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/setting.ts
git commit -m "feat: add 'whatzap setting set default-country-code' command"
```

---

## Task 5: Add post-login country code prompt

**Files:**
- Modify: `src/commands/login.ts`

- [ ] **Step 1: Update `src/commands/login.ts`**

```typescript
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import qrcode from 'qrcode-terminal'
import { WhatsAppService } from '../services/whatsapp.js'
import { isDaemonRunning, startDaemon } from '../daemon/client.js'
import { readSettings, writeSettings } from '../utils/settings.js'

const CREDS_FILE = join(homedir(), '.whatzap', 'auth', 'creds.json')

async function promptCountryCode(): Promise<void> {
  const settings = readSettings()
  if (settings.defaultCountryCode) return // already set — skip

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => {
    rl.question('\nDefault country code? (e.g. 55 Brazil, 1 USA, 44 UK — Enter to skip): ', resolve)
  })
  rl.close()

  const code = answer.trim()
  if (code && /^\d{1,4}$/.test(code)) {
    writeSettings({ defaultCountryCode: code })
    console.log(`Default country code set to ${code}.`)
  }
}

export async function login(): Promise<void> {
  if (await isDaemonRunning()) {
    console.log('Already logged in.')
    return
  }

  if (existsSync(CREDS_FILE)) {
    // Creds exist but daemon not running — just start it
    try {
      await startDaemon()
      console.log('Logged in successfully.')
    } catch {
      console.error('Connection failed. Please try again.')
      process.exitCode = 1
    }
    return
  }

  // No creds — need QR scan
  const service = new WhatsAppService()

  try {
    await service.connect((qr) => {
      console.clear()
      console.log('Scan this QR code with WhatsApp on your phone:\n')
      qrcode.generate(qr, { small: true })
    })
  } catch {
    console.error('Connection failed. Please try again.')
    process.exitCode = 1
    await service.disconnect()
    return
  }

  await service.disconnect()

  try {
    await startDaemon()
    console.log('Logged in successfully.')
    await promptCountryCode()
  } catch {
    console.error('Failed to start background session. Please try again.')
    process.exitCode = 1
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
git add src/commands/login.ts
git commit -m "feat: prompt for default country code after first login"
```

---

## Task 6: Register `setting` command in CLI entry point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import and case to `src/index.ts`**

Add import after existing imports:

```typescript
import { setting } from './commands/setting.js'
```

Update USAGE string — add after the `restart` line:

```
  whatzap setting set default-country-code <code> Set default country code for phone normalization
```

Add case in the switch statement, after `case 'restart'`:

```typescript
    case 'setting':
      setting(args)
      break
```

The full updated `src/index.ts`:

```typescript
#!/usr/bin/env node

import { login } from './commands/login.js'
import { logout } from './commands/logout.js'
import { sendMessage } from './commands/send-message.js'
import { stop } from './commands/stop.js'
import { findContact } from './commands/find-contact.js'
import { addWatch } from './commands/add-watch.js'
import { removeWatch } from './commands/remove-watch.js'
import { listWatch } from './commands/list-watch.js'
import { restart } from './commands/restart.js'
import { sendGroup } from './commands/send-group.js'
import { setting } from './commands/setting.js'


const [, , command, ...args] = process.argv

const USAGE = `whatzap — Send WhatsApp messages from the terminal

Usage:
  whatzap login                          Authenticate with WhatsApp via QR code
  whatzap logout                         Log out and remove saved credentials
  whatzap send-message <phone> <message> Send a text message to a phone number
  whatzap send-group <group name> <message> Send a text message to a group
  whatzap find-contact <query>           Search macOS Contacts by name, returns JSON
  whatzap stop                           Stop the background session
  whatzap add-watch <phone|group name>    Start recording messages for a contact or group
  whatzap remove-watch <phone|group name> Stop recording messages for a contact or group
  whatzap list-watch                      List watched contacts and groups
  whatzap restart                         Restart the background session
  whatzap setting set default-country-code <code>  Set default country code (e.g. 55, 1, 44)

Examples:
  whatzap login
  whatzap logout
  whatzap send-message +5511999999999 Hello!
  whatzap send-message +5511999999999 Multi word message works too
  whatzap send-group familia Oi pessoal!
  whatzap setting set default-country-code 55
  whatzap stop`

async function main() {
  switch (command) {
    case 'login':
      await login()
      break

    case 'logout':
      await logout()
      break

    case 'send-message': {
      const [phone, ...rest] = args
      const message = rest.join(' ')
      if (!phone || !message) {
        console.error(USAGE)
        process.exit(1)
      }
      await sendMessage(phone, message)
      break
    }

    case 'find-contact': {
      const query = args.join(' ')
      findContact(query)
      break
    }

    case 'stop':
      await stop()
      break

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

    case 'send-group': {
      if (args.length < 2) {
        console.error(USAGE)
        process.exit(1)
      }
      await sendGroup(args)
      break
    }

    case 'restart':
      await restart()
      break

    case 'setting':
      setting(args)
      break

    case '--help':
    case '-h':
    case 'help':
      console.log(USAGE)
      break

    default:
      console.error(USAGE)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
}).finally(() => {
  process.exit(process.exitCode ?? 0)
})
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: `dist/` updated, no errors.

- [ ] **Step 3: Smoke-test the setting command**

```bash
node dist/index.js setting set default-country-code 55
```

Expected: `Default country code set to 55.`

```bash
cat ~/.whatzap/settings.json
```

Expected: `"defaultCountryCode": "55"` present in the JSON.

- [ ] **Step 4: Smoke-test invalid input**

```bash
node dist/index.js setting set default-country-code abc
```

Expected: error message `Usage: whatzap setting set default-country-code <digits>`, non-zero exit.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: register 'setting' command in CLI"
```

---

## Task 7: Create plugin manifest

**Files:**
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: Create `.claude-plugin/plugin.json`**

```bash
mkdir -p .claude-plugin
```

```json
{
  "name": "whatzap",
  "description": "Send WhatsApp messages and manage conversation history from Claude Code",
  "version": "1.0.0",
  "author": {
    "name": "Carlos Alves",
    "email": "carlos.alves91@gmail.com"
  },
  "homepage": "https://github.com/carlosalves/whatzap-cli",
  "repository": "https://github.com/carlosalves/whatzap-cli",
  "license": "MIT"
}
```

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: add Claude Code plugin manifest"
```

---

## Task 8: Create the plugin skill

**Files:**
- Create: `skills/send/SKILL.md`

- [ ] **Step 1: Create `skills/send/SKILL.md`**

```bash
mkdir -p skills/send
```

```markdown
---
name: whatzap:send
description: Send WhatsApp messages and manage conversation history using the whatzap CLI. Use when asked to send a WhatsApp message, notify someone on WhatsApp, message a contact, share information via WhatsApp, watch/record messages from a contact or group, or manage the watch list. Trigger phrases: send WhatsApp, notify on WhatsApp, WhatsApp message, message via WhatsApp, watch contact, add watch, record messages, stop watching.
argument-hint: '<contact-name-or-phone> <message>'
---

# whatzap — Send WhatsApp Messages & Record History

## Prerequisites

- Install: `npm install -g whatzap-cli`
- Authenticate: `whatzap login` (one-time QR scan with your phone)
- Set your country code: `whatzap setting set default-country-code <code>` (e.g. `55` for Brazil, `1` for USA, `44` for UK) — prompted automatically after first login

## When to Use

- User asks to send a WhatsApp message to someone
- User asks to notify a contact on WhatsApp
- User wants to share a result, summary, or update via WhatsApp
- User asks to watch/record messages from a contact or group
- User asks to stop recording or list watched contacts

## Procedure: Send a message

1. **Resolve the recipient.**
   - If a phone number is provided (starts with `+` or is all digits), use it directly.
   - Otherwise, run:
     ```bash
     whatzap find-contact <name>
     ```
     Multi-word names work without quotes (e.g. `whatzap find-contact john doe`).
     Returns a JSON array:
     ```json
     [{ "name": "John Doe", "phones": ["+15551234567"] }]
     ```
   - **Zero results** → tell the user: "Contact not found."
   - **One result, one phone** → use it.
   - **One result, multiple phones** → prefer mobile/iPhone label; otherwise use the first.
   - **Multiple results** → pick the best name match from context; if ambiguous, list options and ask.

2. **Send the message:**
   ```bash
   whatzap send-message <phone> <message>
   ```
   - Phone can be in any format — the CLI normalizes it using the configured country code.
   - Multi-word messages do NOT need quotes.

3. **Expected output:** `Message sent.`

4. **On failure:** If the command errors with "Not logged in", instruct the user to run `whatzap login` and scan the QR code.

## Procedure: Send to a group

```bash
whatzap send-group <group name> <message>
```

Multi-word group names work without quotes. Example: `whatzap send-group family group Hello everyone!`

## Procedure: Watch a contact (record history)

When the user asks to watch/record messages from a contact:

1. **Resolve the contact** using `find-contact` (same logic as sending above).
2. **Add to watch list:**
   ```bash
   whatzap add-watch <phone>
   ```
   Expected outputs:
   - `Now watching '<input>'` — successfully added
   - `'<input>' is already being watched.` — already in watch list (not an error)

**For groups:** Pass the group name directly:
```bash
whatzap add-watch family group
```

## Commands Reference

| Command | Description |
|---|---|
| `whatzap login` | Authenticate via QR code, starts background daemon |
| `whatzap logout` | Log out and remove saved credentials |
| `whatzap find-contact <query>` | Search macOS Contacts by name, returns JSON |
| `whatzap send-message <phone> <message>` | Send a text message (phone number required) |
| `whatzap send-group <group name> <message>` | Send a text message to a group |
| `whatzap add-watch <phone\|group name>` | Start recording messages for a contact or group |
| `whatzap remove-watch <phone\|group name>` | Stop recording messages for a contact or group |
| `whatzap list-watch` | List all watched contacts and groups |
| `whatzap setting set default-country-code <code>` | Set default country code for phone normalization |
| `whatzap restart` | Restart the background daemon |
| `whatzap stop` | Stop the background daemon |

## Examples

```bash
whatzap find-contact john doe
whatzap send-message +15551234567 Build finished successfully
whatzap send-message 5551234567 Tests passed: 42/42
whatzap send-group dev team Deploy is live
whatzap add-watch +15551234567
whatzap add-watch family group
whatzap list-watch
whatzap remove-watch +15551234567
whatzap setting set default-country-code 55
```
```

- [ ] **Step 2: Commit**

```bash
git add skills/send/SKILL.md
git commit -m "feat: add /whatzap:send plugin skill"
```

---

## Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `setting` command to CLAUDE.md**

Add `whatzap setting set default-country-code <code>` to the Commands section, and update the `settings.json` schema table. Full updated sections:

In the **Commands** bash block, add:
```
  whatzap setting set default-country-code <code> Set default country code for phone normalization
```

In the **`settings.json` schema** section, replace:

```markdown
**`settings.json` schema:**
```json
{
  "watchList": ["5511999999999@s.whatsapp.net", "120363417135713951@g.us"]
}
```

| Field | Type | Description |
|---|---|---|
| `watchList` | `string[]` | JIDs to record history for. Managed via `watch-add`/`watch-remove` IPC — edit manually only when daemon is stopped. |
```

with:

```markdown
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
```

Add `src/utils/settings.ts` to the **Key files** section:
```
- `src/utils/settings.ts` — `readSettings()` and `writeSettings()` for CLI commands. Reads/writes `~/.whatzap/settings.json`.
```

Add `src/commands/setting.ts` to the **Key files** section:
```
- `src/commands/setting.ts` — Handles `whatzap setting set default-country-code <code>`. Writes `defaultCountryCode` to `settings.json` via `writeSettings()`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with setting command and settings schema"
```

---

## Task 10: Update local skill

**Files:**
- Modify: `~/.claude/skills/whatzap/SKILL.md`

- [ ] **Step 1: Update `~/.claude/skills/whatzap/SKILL.md`**

Replace the existing skill with the same content as `skills/send/SKILL.md` (Task 8, Step 1), but update the frontmatter `name` to keep the local skill name:

```yaml
---
name: whatzap
description: 'Send WhatsApp messages and manage conversation history using the whatzap CLI. Use when asked to send a WhatsApp message, notify someone on WhatsApp, message a contact, share information via WhatsApp, watch/record messages from a contact or group, or manage the watch list. Trigger phrases: send WhatsApp, notify on WhatsApp, WhatsApp message, message via WhatsApp, watch contact, add watch, record messages, stop watching.'
argument-hint: '<contact-name-or-phone> <message>'
---
```

Then the same body as `skills/send/SKILL.md`.

Note: Remove the Brazil-specific phone normalization steps (steps 2 "Normalize the phone number before sending" from the old skill). The new skill relies on the CLI's `defaultCountryCode` setting instead.

- [ ] **Step 2: Verify Claude picks up the updated skill**

In a new Claude Code session, type:
> "send a WhatsApp to John"

Expected: Claude invokes the skill and runs `whatzap find-contact john`.

- [ ] **Step 3: Commit the repo (local skill is outside the repo — no commit needed)**

The local skill at `~/.claude/skills/whatzap/SKILL.md` is outside the repo. No commit.

---

## Task 11: Final build and bump version

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: no errors, `dist/` updated.

- [ ] **Step 2: Verify `whatzap --help` shows the new command**

```bash
node dist/index.js --help
```

Expected: output includes `whatzap setting set default-country-code <code>`.

- [ ] **Step 3: Bump version in package.json to 1.1.0**

Update `"version": "1.0.0"` → `"version": "1.1.0"` in `package.json`.
Also update `"version"` in `.claude-plugin/plugin.json` to `"1.1.0"`.

- [ ] **Step 4: Commit**

```bash
git add package.json .claude-plugin/plugin.json
git commit -m "chore: bump version to 1.1.0 for plugin release"
```

---

## Task 12: Publish and submit

- [ ] **Step 1: Publish to npm**

```bash
npm publish
```

Expected: package published as `whatzap-cli@1.1.0`.

- [ ] **Step 2: Submit to Anthropic marketplace**

Go to `claude.ai/settings/plugins/submit` (or `platform.claude.com/plugins/submit`) and submit the plugin with:
- Repository: `https://github.com/carlosalves/whatzap-cli`
- Name: `whatzap`
- Description: "Send WhatsApp messages and manage conversation history from Claude Code"

- [ ] **Step 3: Tag the release**

```bash
git tag v1.1.0
git push && git push --tags
```
