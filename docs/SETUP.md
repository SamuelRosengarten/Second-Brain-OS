# Setup

## 1. Prerequisites

Node 22 or newer, Git, Ollama. Check with `node -v`, `ollama --version`, `ollama list`.

Models (nothing is downloaded automatically):

| Purpose | Command | Approx. disk |
| --- | --- | --- |
| Chat + capture processing (default) | `ollama pull qwen3.5:9b` | about 6 GB, fits a 12 GB GPU |
| Semantic search (optional) | `ollama pull nomic-embed-text` | about 274 MB |

Without the embedding model, search is keyword-only. After pulling it, open Knowledge and click "Build semantic index" (or Automations, "Build semantic index").

Change models with `SBOS_CHAT_MODEL` / `SBOS_EMBED_MODEL` or in Settings.

## 2. Install and run

```powershell
npm install
copy .env.example .env.local
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # paste into SBOS_SESSION_SECRET
npm run set-password
npm run build
npm run start
```

Open http://127.0.0.1:3000 and sign in. Stop with Ctrl+C. To keep it running after logout, create a Windows Task Scheduler task "At log on" that runs `npm run start` in this folder (do not run it as a public-facing service).

## 3. Verify

```powershell
npm test                  # mocked-model tests
npm run typecheck
$env:SBOS_SMOKE_PASSWORD = "<your password>"; npm run smoke
```

`smoke` creates test items prefixed `SMOKE`; prefer a scratch data dir (`$env:SBOS_DATA_DIR='C:\temp\sbos'` before running `set-password` and `start`). Set `SBOS_SMOKE_SKIP_AI=1` to skip the Ollama steps.

## 4. Backup and restore

```powershell
npm run backup                      # folder in <data>/backups/backup-<time>
npm run export                      # Markdown + projects/tasks JSON in <data>/exports
```

Restore (stop the app first):

```powershell
npm run restore                     # lists backups
npm run restore -- backup-2026-10-21_01-32-24 --yes
```

Restore copies the current state to `backups/pre-restore-<time>` first, then replaces database, vault, attachments and imports. Copy backups to another drive or encrypted storage regularly; a backup on the same disk does not protect against disk failure.

## 5. iPhone via Tailscale

Tailscale is installed on this PC and the iPhone is already in your tailnet. Remaining manual steps, in order:

1. Make sure the Tailscale app on the iPhone is connected (it showed offline at check time).
2. Finish the hardening in docs/SECURITY.md (HTTPS via `tailscale serve`, secure cookies, allowed origin).
3. Open the `https://<machine>.<tailnet>.ts.net` address in Safari, sign in, and use Share, Add to Home Screen.

The PC must be on, awake, and Ollama running for AI features.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Login says "No password configured" | `npm run set-password` (needs a valid `SBOS_SESSION_SECRET`) |
| "Cannot reach Ollama" | Start Ollama from the tray; check `http://127.0.0.1:11434` |
| "Model not installed" | Run the exact `ollama pull ...` command shown in the message |
| Capture shows Failed | Open it, read the message, press Retry. The original is intact |
| Search seems stale | Automations, "Reindex vault from Markdown files" |
| Files edited outside the app don't show | Same reindex |
| Port 3000 busy | Stop the other process or run `next start -H 127.0.0.1 -p <port>` |
| 403 "Cross-origin request rejected" | Add your https origin to `SBOS_ALLOWED_ORIGINS` |
| Deleted note by mistake | Move the file back from `vault/.trash`, then reindex |
