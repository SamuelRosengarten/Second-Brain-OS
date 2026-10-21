# Architecture

## Environment this was built for

Windows 11, RTX 3060 12 GB, 32 GB RAM, Node 24, Ollama 0.40 with `qwen3.5:9b` (6 GB, fits in VRAM), `llama3.1:8b`, `llama3.2`. Chosen chat model: `qwen3.5:9b` (already installed; nothing was downloaded). Embeddings: `nomic-embed-text` (not installed yet, optional).

## Shape

One Next.js 16 application (TypeScript, Tailwind 4) with route handlers as the API. One SQLite database through `better-sqlite3`. No ORM, no separate backend, no Redis, no vector server. Plain SQL with numbered migrations keeps the stack small and inspectable.

```
Browser (desktop / iPhone)  ->  Next.js (127.0.0.1:3000)  ->  src/lib/*  ->  SQLite + Markdown vault + attachments
                                                           ->  Ollama (127.0.0.1:11434, never exposed)
```

## Layers (all in `src/lib`, UI never touches storage directly)

| Module | Responsibility |
| --- | --- |
| `config.ts` | Env parsing, data directory layout |
| `db.ts` + `migrations/*.sql` | Connection, WAL, transactional migrations, settings |
| `safe-fs.ts` | Filename sanitising, path sandbox (`resolveInside`), atomic never-overwrite writes |
| `notes.ts` | Markdown vault CRUD, frontmatter, chunking, FTS indexing, reindex from disk |
| `search.ts` | FTS5 keyword, embeddings, reciprocal-rank-fusion hybrid, graceful fallback |
| `ollama.ts` | `LlmProvider` interface + Ollama implementation (health, models, capabilities, stream, JSON, embed) |
| `prompts.ts` | Capture prompt, proposal schema (zod -> JSON schema for Ollama `format`), grounded-chat prompt, idea-to-note template |
| `captures.ts` | Save-first capture pipeline, processing, accept, attachments |
| `workflow.ts` | Task dependencies (loop-safe), AI-suggested dependencies stored as pending proposals, and the one-call data set behind the Workflow page |
| `workflow-logic.ts` | Pure functions shared with the browser: task status, critical path, timeline grid and graph layout |
| `projects.ts` | Projects, tasks, note links, activity |
| `chat.ts` | Conversations, retrieval-grounded streaming (NDJSON) |
| `briefing.ts` | Deterministic briefing from SQL |
| `importer.ts`, `backup.ts`, `claude-handoff.ts` | Import, backup/restore/export, Claude context package |
| `auth.ts`, `api.ts` | Password + signed sessions; route wrapper (auth, CSRF, zod, error hygiene) |

Swapping or adding a model provider means implementing `LlmProvider` and calling `setProvider`. Model names are config/settings, never hard-coded in logic.

## Data layout (`SBOS_DATA_DIR`, default `~/SecondBrainOS`)

```
database/sbos.db     metadata, search index, tasks, chats (rebuildable parts: FTS + embeddings)
vault/               one .md per note, frontmatter + body. THE source of truth for note text
  .trash/            deleted notes (recoverable)
attachments/YYYY-MM/ files attached to captures, stored as uploaded, never executed
imports/             untouched originals of imported documents
exports/  backups/   outputs of export and backup
```

Notes stay usable without the app (Obsidian can open `vault/`). `Reindex vault` rebuilds metadata and the search index from the files; `Build semantic index` rebuilds vectors. Neither modifies user files.

## Key flows

**Capture:** POST saves `original_content` (immutable) and attachments in one transaction, returns. Optional processing is a separate step: Ollama is asked for JSON constrained by a schema, validated with zod, invented project names are dropped, result stored in `proposal_json`. Any failure sets `status=failed` with a readable message and a Retry button; the original is untouched. Accepting creates the note file first (no overwrite), then the DB row, then links/tasks.

**Search:** FTS5 rows exist per chunk (title, heading, body, tags). Semantic search embeds the query and scores stored chunk vectors (cosine, in process; fine for personal-scale libraries). Results fuse by rank. If embeddings are missing or Ollama is down, keyword results are returned with the reason shown.

**Grounded chat:** retrieve top passages, number them, instruct the model to cite only those and to say when evidence is insufficient. Sources actually passed to the model are stored with the answer and shown in the UI. With no passages the model is told so.

## Decisions and tradeoffs

- Vectors live in SQLite BLOBs with brute-force cosine. Revisit above roughly 100k chunks.
- Notes render as preformatted text, not HTML, so imported content cannot inject markup.
- Auth is a single-user password; this is a personal system, not multi-tenant.
- `next build` prints Turbopack tracing warnings for dynamic filesystem paths in `backup.ts`; harmless for a local `next start`.
