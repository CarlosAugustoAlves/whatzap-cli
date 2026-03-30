---
name: whatzap
description: 'Send WhatsApp messages and manage conversation history using the whatzap CLI. Use when asked to send a WhatsApp message, notify someone on WhatsApp, message a contact, share information via WhatsApp, watch/record messages from a contact or group, or manage the watch list. Trigger phrases: send WhatsApp, notify on WhatsApp, WhatsApp message, message via WhatsApp, watch contact, add watch, record messages, stop watching.'
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
