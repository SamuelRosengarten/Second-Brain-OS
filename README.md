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

## Run it permanently on Windows (auto-start at login)

Create a per-user Task Scheduler task that starts the app hidden at login and restarts it if it crashes. Run this once in PowerShell (adjust `$proj`); run `npm run build` first. It does not touch the firewall or network settings and does not run while you are logged out.

```powershell
$proj = "C:\path\to\Second-Brain-OS"
$log  = Join-Path $env:USERPROFILE "SecondBrainOS\server.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$cmd = "Set-Location -LiteralPath '$proj'; & 'C:\Program Files\nodejs\npm.cmd' run start *>> '$log'"
$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`"" -WorkingDirectory $proj
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "SecondBrainOS" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Start-ScheduledTask SecondBrainOS
```

Manage it:

```powershell
Start-ScheduledTask SecondBrainOS
Stop-ScheduledTask SecondBrainOS
Get-NetTCPConnection -LocalPort 3000 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }   # stop the node process
Disable-ScheduledTask SecondBrainOS                       # stop auto-starting
Unregister-ScheduledTask SecondBrainOS -Confirm:$false    # remove
```

After changing code or `.env.local`: stop the app, run `npm run build` if code changed, then `Start-ScheduledTask SecondBrainOS`. Do not also run `npm run start` by hand while the task is running (port conflict).

## Use it from your iPhone (Tailscale, private)

Never port-forward 3000 or 11434 and never use `tailscale funnel` (public).

1. Install Tailscale on the PC and the iPhone and sign in to the same account.
2. In the Tailscale admin console, open **DNS**, make sure **MagicDNS** is on and click **Enable HTTPS**.
3. On the PC, publish the local app to your tailnet only: `tailscale serve --bg 3000`, then check `tailscale serve status` shows `https://<machine>.<tailnet>.ts.net (tailnet only)` pointing at `http://127.0.0.1:3000`.
4. In `.env.local` set `SBOS_SECURE_COOKIES=1` and `SBOS_ALLOWED_ORIGINS=https://<machine>.<tailnet>.ts.net`, then restart the app.
5. On the iPhone, with the Tailscale app connected, open `https://<machine>.<tailnet>.ts.net` in Safari and sign in. Share, then Add to Home Screen. It opens full screen with its own icon (web app manifest). If you added it before this was set up, delete the old shortcut and add it again; an installed web app keeps its own sign-in, so you sign in once more.

`localhost` on the phone is the phone itself and will never work. A `502 Bad Gateway` means the app is not running on the PC. The PC must be on, logged in, and Ollama running for AI features. Details in [docs/SECURITY.md](docs/SECURITY.md).

## Backups

Backups are plain folders (database snapshot + vault + attachments + imports). Back up on demand, or on a schedule with a copy to another drive. Retention keeps the newest 8 backups, only ever deleting folders named `backup-<date>` that contain a `manifest.json` (restore safety copies and your own folders are never touched).

```powershell
npm run backup                                                      # local only
npm run backup -- --copy-to "D:\SecondBrainOS-backups" --keep 8     # also copy to another drive
```

Weekly schedule (Sundays 10:00; runs at next login if the PC was off). Adjust `$proj` and the destination:

```powershell
$proj = "C:\path\to\Second-Brain-OS"
$log  = Join-Path $env:USERPROFILE "SecondBrainOS\backup.log"
$cmd = "Set-Location -LiteralPath '$proj'; & 'C:\Program Files\nodejs\npm.cmd' run backup -- --copy-to 'D:\SecondBrainOS-backups' --keep 8 *>> '$log'"
$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`"" -WorkingDirectory $proj
$trigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 10:00
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "SecondBrainOS-Backup" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
```

Restore (stop the app first, see above):

```powershell
npm run restore                                        # lists backups
npm run restore -- backup-2026-10-21_02-15-36 --yes    # replaces current data; the old state is copied to backups\pre-restore-<time> first
```

A copy on the same physical disk does not protect against disk failure; use a different drive and occasionally an off-site or encrypted copy. Check `backup.log` in your data folder if a run looks missing.

## Tests

| Command | What it covers |
| --- | --- |
| `npm test` | 60 unit/integration tests with a mock model: file safety, auth/CSRF, capture and failure paths, search fallback, backup/restore/retention, grounded chat, safe Markdown rendering |
| `npm run typecheck` | TypeScript |
| `npm run build` then `npm run e2e` | 18 Playwright browser tests on a scratch data folder with a fake Ollama, using your installed Google Chrome (no browser download): login, capture to note to search to task, duplicates, projects, grounded chat with citations, Claude handoff, settings/backup/sign-out, command palette, note editor with safe Markdown preview, task edit/snooze/undo, "today" in far-away timezones, phone task layout, home-screen manifest, no horizontal overflow on 10 pages at 375/390/430/768/1024/1440px, tap-target sizes, keyboard focus. Screenshots are saved to `test-results/shots/` |
| `npm run smoke` | HTTP end-to-end against a running instance, with real Ollama (see docs/SETUP.md) |
| `npm run audit` | Dependency audit |

## Interface

Dark-first (light theme follows the OS or Settings), compact, one icon set (lucide). Violet accent is reserved for active navigation, primary actions, focus and AI-generated content.

- **Ctrl+K (⌘K)** command palette: jump to any page, create a capture/note/task/project, open a project, find notes by title, or run a full library search / Ask AI. Every entry is a real action.
- **Sidebar** (desktop, 1024px and up): New capture, search, navigation, your active projects and recent notes (real data), live Ollama status, collapsible. Below 1024px (phones and tablets) it becomes a top bar plus a bottom nav with a raised Capture button.
- **Home** shows the date's greeting, a one-box quick capture, the briefing computed from your database, today's tasks, items awaiting review, recent notes, active projects and system status. Nothing on it is fabricated.
- **Inbox** is a status-filtered list; each capture shows your original beside the clearly labelled, editable AI suggestion.
- **Notes** read like pages (properties, summary, rendered Markdown) and edit with Write/Preview and Ctrl+S. Markdown is rendered by a small built-in renderer that never injects raw HTML and only links http(s)/mailto.

## What is in it

| Area | What works |
| --- | --- |
| Inbox | Text, ideas, tasks, links, excerpts, md/txt/pdf/image attachments. Saved before any AI runs. AI proposal (title, summary, category, tags, projects, next action, open questions, confidence) is reviewed, edited, accepted, dismissed or retried. Archive, delete with confirmation, duplicate protection. |
| Knowledge | Notes are real `.md` files with frontmatter in `vault/`. Keyword (FTS5) + semantic hybrid search, automatic keyword fallback, import of files/folders, reindex from disk, delete moves to `vault/.trash`. |
| Projects & Tasks | Projects with goals, status, target date, linked notes and activity. Tasks with priority, due date, filters; tap a task to edit it, move an overdue or due-today task to tomorrow, and undo a move or a delete from the toast. "Today" and "overdue" follow the clock of the device you are using, so the phone and the PC agree. Capture to task conversion only with your approval. |
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
| `npm run e2e` | Playwright browser tests (build first; see Tests below) |
| `npm run smoke` | End-to-end HTTP test against a running instance (see docs/SETUP.md) |
| `npm run set-password` | Set or rotate the login password (invalidates sessions) |
| `npm run backup [-- --copy-to <dir> --keep <n>]` / `npm run export` | Create a backup (optionally copy to another drive, prune old ones) / export Markdown + JSON |
| `npm run restore -- <name> --yes` | Restore a backup (app must be stopped) |
| `npm run audit` | Dependency vulnerability audit |

## Documents

- [docs/SETUP.md](docs/SETUP.md): install, models, backup/restore, Tailscale, troubleshooting
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design and data layout
- [docs/SECURITY.md](docs/SECURITY.md): threat model, controls, remaining limitations
- [docs/ROADMAP.md](docs/ROADMAP.md): what is next

The PC must be awake and Ollama running for local AI; capture, notes, tasks and keyword search work without it.
