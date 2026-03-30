# Contributing to whatzap

Thank you for your interest in contributing! Here's how to get started.

## Getting Started

1. Fork the repository and clone your fork:

   ```bash
   git clone https://github.com/your-username/whatzap-cli.git
   cd whatzap-cli
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build and verify everything works:

   ```bash
   npm run build
   node dist/index.js --help
   ```

## Development Workflow

- **Run without compiling:** `npm start -- <command> [args]`
- **Type-check:** `npx tsc --noEmit`
- **Build:** `npm run build`

There is no automated test suite. Verification is manual against a real WhatsApp account.

## Code Style

- TypeScript strict mode is enabled — all code must type-check cleanly
- ESM module format — local imports must use `.js` extensions (e.g., `'../services/whatsapp.js'`)
- Keep things simple. Avoid over-engineering for hypothetical future requirements.

## Submitting Changes

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes and ensure the project builds:

   ```bash
   npx tsc --noEmit
   npm run build
   ```

3. Write a clear commit message following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation changes
   - `chore:` maintenance, dependency updates
   - `refactor:` code restructuring without behavior change

4. Open a pull request against `main`. Fill in the PR template.

## Reporting Issues

Please use the GitHub issue templates:
- **Bug report** — for unexpected behavior
- **Feature request** — for new functionality

Include as much detail as possible: OS, Node.js version, steps to reproduce, and expected vs actual behavior.

## Platform Notes

- `find-contact` uses AppleScript via `osascript` and requires macOS with Contacts.app
- The daemon uses Unix domain sockets — Windows is not supported

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
