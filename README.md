# Second Brain OS

A private, local-first personal knowledge and productivity system. Capture ideas from your PC or iPhone, let a **local** model (Ollama) propose structure, keep notes as plain Markdown, search them later, turn them into tasks and projects, and hand context to Claude manually when you want deeper reasoning. No paid API is required.

## Quick start (Windows)

```powershell
npm install
copy .env.example .env.local        # then set SBOS_SESSION_SECRET (command inside the file)
npm run set-password                # min 12 characters, stored as a scrypt hash
npm run build
npm run start                       # http://127.0.0.1:3000  (localhost only)
```

For development use `npm run dev`. Stop the server with Ctrl+C.

Your data lives in `%USERPROFILE%\SecondBrainOS` by default (set `SBOS_DATA_DIR` to change it). It is deliberately outside this repository.

Prerequisites: Node 22+, Ollama running with a chat model (`ollama pull qwen3.5:9b`). Optional for semantic search: `ollama pull nomic-embed-text` (about 274 MB).

## What is in it

| Area | What works |
| --- | --- |
| Inbox | Text, ideas, tasks, links, excerpts, md/txt/pdf/image attachments. Saved before any AI runs. AI proposal (title, summary, category, tags, projects, next action, open questions, confidence) is reviewed, edited, accepted, dismissed or retried. Archive, delete with confirmation, duplicate protection. |
| Knowledge | Notes are real `.md` files with frontmatter in `vault/`. Keyword (FTS5) + semantic hybrid search, automatic keyword fallback, import of files/folders, reindex from disk, delete moves to `vault/.trash`. |
| Projects & Tasks | Projects with goals, status, target date, linked notes and activity. Tasks with priority, due date, filters. Capture to task conversion only with your approval. |
| AI Workspace | Model picker, streaming chat, conversation history, custom system prompt, library-grounded answers with numbered citations and an explicit "not enough evidence" path. |
| Claude handoff | Build a Markdown context package, review it, copy or download it, open claude.ai yourself, paste Claude's answer back as a note. The app never contacts Claude. |
| Home | Briefing computed only from local rows. No calendar is connected, and it says so. |
| Automations | Three fixed manual jobs with status and history. No autonomous actions. |
| Safety | Login, signed cookies, CSRF, upload validation, path sandboxing, backup/export/restore. |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Run the app (always bound to 127.0.0.1) |
| `npm test` | Unit + integration tests (mock model, no GPU needed) |
| `npm run typecheck` | TypeScript check |
| `npm run smoke` | End-to-end HTTP test against a running instance (see docs/SETUP.md) |
| `npm run set-password` | Set or rotate the login password (invalidates sessions) |
| `npm run backup` / `npm run export` | Create a backup folder / export Markdown + JSON |
| `npm run restore -- <name> --yes` | Restore a backup (app must be stopped) |
| `npm run audit` | Dependency vulnerability audit |

## Documents

- [docs/SETUP.md](docs/SETUP.md): install, models, backup/restore, Tailscale, troubleshooting
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design and data layout
- [docs/SECURITY.md](docs/SECURITY.md): threat model, controls, remaining limitations
- [docs/ROADMAP.md](docs/ROADMAP.md): what is next

The PC must be awake and Ollama running for local AI; capture, notes, tasks and keyword search work without it.
