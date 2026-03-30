# whatzap Claude Code Plugin — Design Spec

**Date:** 2026-03-26
**Goal:** Package whatzap-cli as an official Claude Code plugin for submission to Anthropic's marketplace.

---

## Overview

Turn the existing `whatzap-cli` npm package into a distributable Claude Code plugin. The plugin exposes a single skill (`/whatzap:send`) that lets Claude send WhatsApp messages, manage watched contacts, and handle conversation history — all via the existing CLI.

**Approach:** Skills-only plugin (no MCP server). The plugin lives in the same repo as the CLI. Users install the plugin via Claude Code; they still need `npm install -g whatzap-cli` and a one-time `whatzap login`.

---

## File Structure

New files added to the repo root (do not affect npm publish — excluded by `files` in `package.json`):

```
whatzap-cli/
├── .claude-plugin/
│   └── plugin.json          ← plugin manifest
├── skills/
│   └── send/
│       └── SKILL.md         ← unified whatzap skill
└── ... (existing files unchanged)
```

---

## Plugin Manifest (`.claude-plugin/plugin.json`)

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

---

## Skill (`skills/send/SKILL.md`)

**Invocation:** `/whatzap:send` (manual) or auto-triggered by Claude from context.

**Frontmatter:**
```yaml
---
name: whatzap:send
description: Send WhatsApp messages and manage conversation history using the whatzap CLI. Use when asked to send a WhatsApp message, notify someone on WhatsApp, message a contact, share information via WhatsApp, watch/record messages from a contact or group, or manage the watch list.
argument-hint: '<contact-name-or-phone> <message>'
---
```

**Content:** Adapted from `~/.claude/skills/whatzap/SKILL.md` with two changes:
1. Phone normalization is country-agnostic (relies on CLI's configured country code, not hardcoded `+55`)
2. Prerequisites section added (install + login instructions for new users)

The skill covers: `send-message`, `send-group`, `find-contact`, `add-watch`, `remove-watch`, `list-watch`, error handling.

---

## New CLI Features

### 1. `whatzap setting set default-country-code <code>`

Stores the default country code in `~/.whatzap/settings.json`:

```json
{
  "watchList": [...],
  "defaultCountryCode": "55"
}
```

**Updated `settings.json` schema:**

| Field | Type | Description |
|---|---|---|
| `watchList` | `string[]` | JIDs to record history for |
| `defaultCountryCode` | `string \| undefined` | Used by `normalizePhone()` to prepend country code to short numbers |

### 2. Post-login country code prompt

After QR scan succeeds in `src/commands/login.ts`, prompt the user once:

```
✓ Logged in successfully.

Default country code? (e.g. 55 Brazil, 1 USA, 44 UK — Enter to skip): _
```

If provided → save to `settings.json`. If skipped → normalization passes numbers as-is.

### 3. Updated `normalizePhone()` in `src/utils/phone.ts`

Updated logic:

| Input | `defaultCountryCode` | Output |
|---|---|---|
| `+5511999999999` | any | `+5511999999999` (already international) |
| `11999999999` | `"55"` | `+5511999999999` |
| `11999999999` | not set | `+11999999999` (passed as-is with `+`) |

### 4. Manual override

```bash
whatzap setting set default-country-code 55
```

Saves to `settings.json`. Can be run at any time after login.

---

## Documentation Updates

### `CLAUDE.md` (project instructions)

Add `whatzap setting set default-country-code <code>` to the Commands table and IPC/runtime sections so Claude can execute it when users ask.

### `~/.claude/skills/whatzap/SKILL.md` (local skill)

Updated after CLI implementation to:
- Remove hardcoded `+55` normalization logic
- Add `setting set default-country-code` to the commands reference table

---

## Marketplace Submission

After scaffolding and implementing, submit at:
- `claude.ai/settings/plugins/submit`
- `platform.claude.com/plugins/submit`

---

## Out of Scope

- MCP server layer
- Multiple skills (one unified skill covers all commands)
- Separate plugin repo
- `libphonenumber-js` or lookup table (post-login prompt is simpler and reliable)
