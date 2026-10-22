# Overnight test pass (branch `overnight-20261021`)

Baseline: 12 test files / 103 tests. Now: 19 files / 283 tests. Typecheck clean.

## Added
`extract-util`, `notes-lib`, `captures-lib`, `projects-search-connections`, `config-auth-suggest`, `ollama-provider`, `importer-briefing` (all in `tests/`).

## Bugs fixed (both small, each covered by a test)
- `parseMarkdown` left a stray `\r\n` at the start of the body for notes saved with Windows line endings (Obsidian on Windows). Now stripped.
- `OllamaProvider.chatStream` dropped a final event that arrived without a trailing newline. Now flushed.

## Findings, not changed
- **Keyword-only "similar notes" is almost always empty.** `noteConnections` searches the note's own title and summary with an AND query; the note itself matches, so `search` never falls back to OR and the note is then filtered out. Similar notes only appear once embeddings are built.
- **A model answer with more than 4 tasks fails the whole capture proposal** (`ProposalSchema` caps `tasks` at 4), although the cleaning code afterwards keeps only 3. Trimming to the first 3 before validation would make small models more forgiving.
- `parseCookies` accepts a cookie with an empty name (` =value`). Harmless.
- Not run: Playwright e2e (needs a build and a browser), `npm audit` (network), and anything needing a real Ollama.

## Still manual (from the roadmap)
iPhone checks (Safari/VoiceOver, installed home-screen app, iOS Shortcut), confirming OneDrive syncs the encrypted backup, and that ports 3000/11434 are not reachable outside the tailnet.
