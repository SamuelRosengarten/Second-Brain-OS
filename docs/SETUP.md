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

Open http://127.0.0.1:3000 and sign in. Stop with Ctrl+C.

### Auto-start at login (Windows Task Scheduler)

A per-user task named `SecondBrainOS` runs `npm run start` hidden at login, restarts up to 3 times on failure, and appends output to `%USERPROFILE%\SecondBrainOS\server.log`. It does not run while you are logged out and never touches firewall or network settings.

```powershell
Start-ScheduledTask SecondBrainOS     # start now
Stop-ScheduledTask SecondBrainOS      # stops the task, then also stop the node process on port 3000
Get-NetTCPConnection -LocalPort 3000 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }
Disable-ScheduledTask SecondBrainOS   # stop auto-starting
Unregister-ScheduledTask SecondBrainOS -Confirm:$false   # remove it
```

After changing code or `.env.local`: stop the app as above, run `npm run build` if code changed, then `Start-ScheduledTask SecondBrainOS`. Do not also run `npm run start` by hand while the task is running (port conflict).

## 3. Verify

```powershell
npm test                  # mocked-model tests
npm run typecheck
$env:SBOS_SMOKE_PASSWORD = "<your password>"; npm run smoke
```

`smoke` creates test items prefixed `SMOKE`; prefer a scratch data dir (`$env:SBOS_DATA_DIR='C:\temp\sbos'` before running `set-password` and `start`). Set `SBOS_SMOKE_SKIP_AI=1` to skip the Ollama steps.

## 4. Backup and restore

Scheduled weekly backups, the `--copy-to` / `--keep` options and the Task Scheduler commands are in the README ("Backups"). Browser tests: `npm run build` then `npm run e2e`.

```powershell
npm run backup                      # folder in <data>/backups/backup-<time>
npm run export                      # Markdown + projects/tasks JSON in <data>/exports
```

Restore (stop the app first):

```powershell
npm run restore                     # lists backups
npm run restore -- backup-2026-10-21_01-32-24 --yes
```

Check a backup without changing anything (works on the D: copy and while the app runs), restore from any folder, or from an encrypted file (see the README, "Backups"):

```powershell
npm run restore -- 'D:\SecondBrainOS-backups\backup-2026-10-21_20-11-54' --verify
npm run restore -- 'D:\SecondBrainOS-backups\backup-2026-10-21_20-11-54' --yes     # app stopped
npm run backup -- --encrypt --copy-to '<synced or external folder>'                 # needs SBOS_BACKUP_PASSPHRASE
```

Restore copies the current state to `backups/pre-restore-<time>` first, then replaces database, vault, attachments and imports. A damaged backup is refused before anything is touched. Copy backups to another drive or encrypted storage regularly; a backup on the same disk does not protect against disk failure.

## 5. iPhone via Tailscale

Tailscale is installed on this PC and the iPhone is already in your tailnet. Remaining manual steps, in order:

1. Make sure the Tailscale app on the iPhone is connected (it showed offline at check time).
2. Finish the hardening in docs/SECURITY.md (HTTPS via `tailscale serve`, secure cookies, allowed origin).
3. Open the `https://<machine>.<tailnet>.ts.net` address in Safari, sign in, and use Share, Add to Home Screen.
4. Optional: share-sheet capture with an iOS Shortcut (README, "Capture from the iPhone share sheet"). Needs `SBOS_CAPTURE_TOKEN` in `.env.local`.

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
