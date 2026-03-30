# whatzap

A lightweight CLI for sending WhatsApp messages and recording conversation history from the terminal.

Built on top of [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web protocol). No API keys or paid services required — it connects directly to your WhatsApp account via QR code, just like WhatsApp Web.

## Features

- Send WhatsApp messages directly from the terminal
- Send messages to groups by name
- Record incoming and outgoing messages for watched contacts and groups
- Persistent background daemon — no re-authentication between commands
- Look up contacts by name via macOS Contacts app
- Multi-word messages without quotes
- Simple, scriptable interface — easy to integrate into shell scripts and automation tools

## Requirements

- Node.js 18 or later
- A WhatsApp account
- macOS (Linux support is partial — the `find-contact` command requires macOS Contacts)

## Installation

```bash
npm install -g whatzap-cli
```

## Usage

### First-time setup

```bash
whatzap init
```

Installs the Claude Code skill and authenticates with your WhatsApp account via QR code. Run this once after installing.

### Login

Re-authenticate after logout:

```bash
whatzap login
```

Credentials are persisted — you only need this if you've explicitly logged out.

### Send a Message

```bash
whatzap send-message <phone> <message>
```

The phone number must include the country code. Multi-word messages don't need quotes.

```bash
# Examples
whatzap send-message +5511999999999 Hello from the terminal!
whatzap send-message +15555550100 Meeting in 10 minutes
```

### Send a Message to a Group

```bash
whatzap send-group <group name> <message>
```

The group name is matched against your WhatsApp groups (case-insensitive). The longest prefix of the arguments that matches a known group name is used as the group, and the rest is the message.

```bash
whatzap send-group family Oi pessoal!
whatzap send-group Work Team Meeting in 5 minutes
```

### Find a Contact (macOS only)

Look up a contact by name from macOS Contacts:

```bash
whatzap find-contact <name>
```

Returns a JSON array of matching contacts with their phone numbers:

```bash
$ whatzap find-contact "John"
[{"name":"John Doe","phones":["+15555550100"]},{"name":"John Smith","phones":["+5511988887777"]}]
```

This is useful for scripting — you can pipe the output to look up a number before sending:

```bash
# Send a message to a contact by name (requires jq)
PHONE=$(whatzap find-contact "John Doe" | jq -r '.[0].phones[0]')
whatzap send-message "$PHONE" On my way!
```

### Watch a Contact or Group

Record all incoming and outgoing messages for a contact or group:

```bash
# Watch a contact by phone number
whatzap add-watch +5511999999999

# Watch a WhatsApp group by name
whatzap add-watch family group
whatzap add-watch Work Team
```

Messages are recorded to `~/.whatzap/history/` as newline-delimited JSON (JSONL). Each line contains:

```json
{"ts":"2026-03-22T10:00:00.000Z","d":"in","n":"Carlos","text":"Hello!"}
{"ts":"2026-03-22T10:01:00.000Z","d":"out","text":"Sure, see you there!"}
```

Fields:
- `ts` — ISO 8601 timestamp
- `d` — `"in"` for received messages, `"out"` for sent messages
- `n` — sender's WhatsApp display name (incoming only)
- `text` — message text

Non-text messages (images, audio, stickers) are not recorded. History is capped at the 100 most recent messages per contact or group.

### Manage the Watch List

```bash
# List all watched contacts and groups
whatzap list-watch

# Stop recording messages for a contact or group
whatzap remove-watch +5511999999999
whatzap remove-watch family group
```

Watch list changes take effect immediately — no daemon restart needed.

### Configure Default Country Code

Set a default country code so you can omit the `+` prefix when sending messages:

```bash
whatzap setting set default-country-code 55
```

Once set, phone numbers without a `+` prefix will have the country code prepended automatically:

```bash
whatzap send-message 11999999999 Hello!  # treated as +5511999999999
```

### Stop the Daemon

Stop the background WhatsApp session:

```bash
whatzap stop
```

### Restart the Daemon

Reconnect to WhatsApp (useful for connection troubleshooting):

```bash
whatzap restart
```

### Logout

Disconnect and delete saved credentials:

```bash
whatzap logout
```

### Help

```bash
whatzap --help
```

## How It Works

whatzap uses a **daemon architecture** to maintain a persistent WhatsApp connection without reconnecting on every command:

```
whatzap <command>
  → src/index.ts          (parse & dispatch)
    → src/commands/*.ts   (command handlers)
      → src/daemon/client.ts  (IPC over Unix socket)
        → src/daemon/server.ts  (background daemon)
          → src/services/whatsapp.ts  (Baileys WebSocket)
            → ~/.whatzap/auth/  (persisted credentials)
```

The daemon runs as a detached background process and communicates with CLI commands via a Unix domain socket at `~/.whatzap/daemon.sock`. It auto-starts on first use if credentials are available.

### Runtime Data

All runtime data is stored in `~/.whatzap/`:

| File/Directory | Description |
|---|---|
| `auth/` | Baileys session credentials (persisted) |
| `daemon.sock` | Unix socket for IPC |
| `daemon.pid` | Daemon process ID |
| `settings.json` | Watch list and default country code |
| `history/` | Recorded messages — one `.jsonl` file per watched contact/group |

History filenames are derived from WhatsApp JIDs (e.g. `5511999999999_s-whatsapp-net.jsonl` for an individual, `120363000000_g-us.jsonl` for a group).

## Development

```bash
# Clone the repository
git clone https://github.com/CarlosAugustoAlves/whatzap-cli.git
cd whatzap-cli

# Install dependencies
npm install

# Run without compiling (development)
npm start -- send-message +5511999999999 test

# Type-check without emitting
npx tsc --noEmit

# Build
npm run build

# Run compiled output
node dist/index.js --help
```

No automated test suite — verification is manual against a real WhatsApp account.

## Project Structure

The source is organized under `src/` with subdirectories for `commands/`, `daemon/`, `services/`, and `utils/`. Entry point is `src/index.ts`.

## TypeScript Notes

- ESM package (`"type": "module"`) — all local imports use `.js` extensions
- Module resolution: `NodeNext` (required by Baileys)
- `skipLibCheck: true` — Baileys ships types with strict-mode incompatibilities

## Claude Code Skill

whatzap ships with a [Claude Code](https://claude.ai/code) skill that lets Claude send WhatsApp messages and manage the watch list on your behalf — resolving contacts by name, normalizing phone numbers, and calling `whatzap` automatically.

The skill is installed automatically by `whatzap init`. To reinstall it manually:

```bash
whatzap install-skill
```

Once installed, you can say things like:

> "Send a WhatsApp to John saying the build is done"
> "Message Jane that I'll be late"
> "Watch Jane" (starts recording messages from that contact)
> "Add the family group to my watch list"

Claude will resolve the contact via `find-contact`, normalize the number, and send the message or add the watch — no phone number needed.

> **Note:** Contact resolution by name requires macOS — `find-contact` uses AppleScript to query Contacts.app and is not available on Linux or Windows. On other platforms, provide the phone number directly.

## Contributing

Contributions are welcome! Open an issue or pull request on [GitHub](https://github.com/CarlosAugustoAlves/whatzap-cli).

## License

MIT — see [LICENSE](LICENSE) for details.

## Disclaimer

This project uses the WhatsApp Web protocol via [Baileys](https://github.com/WhiskeySockets/Baileys). Use responsibly and in accordance with [WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service). Automated or bulk messaging may violate those terms and result in account restrictions.
