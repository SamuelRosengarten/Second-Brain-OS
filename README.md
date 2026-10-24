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

Every backup is verified right after it is made (SQLite integrity check, file count against the manifest, row counts). You can check any backup, including the copy on D:, without touching your data:

```powershell
npm run restore -- 'D:\SecondBrainOS-backups\backup-2026-10-21_20-11-54' --verify
```

**Encrypted off-site copy.** Add `SBOS_BACKUP_PASSPHRASE` (12+ characters) to `.env.local`, then back up with `--encrypt`. The copy in `--copy-to` becomes one AES-256-GCM file (`backup-<time>.sbosenc`) that is safe on a cloud-synced folder or a USB stick; it is decrypted again as a check before the run counts as done. Without the passphrase it cannot be opened, so keep a copy of the passphrase somewhere that is not this PC.

```powershell
npm run backup -- --copy-to 'D:\SecondBrainOS-backups' --encrypt-to "$env:USERPROFILE\OneDrive\SecondBrainOS-backups" --keep 8   # plain copy on D: + encrypted copy in OneDrive
npm run restore -- "$env:USERPROFILE\OneDrive\SecondBrainOS-backups\backup-2026-10-21_20-11-54.sbosenc" --yes   # app stopped; works on a fresh PC too
```

`--encrypt-to <dir>` writes the encrypted file in addition to the plain `--copy-to` copy; `--encrypt` alone makes the `--copy-to` copy the encrypted file instead. The weekly task on this PC uses `--copy-to D:\SecondBrainOS-backups --encrypt-to <OneDrive>\SecondBrainOS-backups`, so each Sunday leaves a plain copy on D: and an encrypted, verified copy that OneDrive syncs off the machine.

## Capture from the iPhone share sheet

Safari on iOS does not support the web share-target standard, so the iPhone uses a small Shortcut that posts to the app. (Chrome on Android does support it: after installing the app, "Second Brain" appears in the share sheet and opens the capture form prefilled.)

1. On the PC, add a token to `.env.local` and restart the app. It can **only create captures**; it cannot read anything.
   ```powershell
   node -e "console.log('SBOS_CAPTURE_TOKEN=' + require('crypto').randomBytes(32).toString('base64url'))"   # paste the line into .env.local
   ```
2. On the iPhone, with Tailscale connected, open **Shortcuts** → **+** and add one action, **Get Contents of URL**:
   - URL: `https://<machine>.<tailnet>.ts.net/api/share`
   - Method: **POST**; Headers: `Authorization` = `Bearer <your token>`, `X-SBOS` = `1`
   - Request Body: **JSON**, with two Text fields: `text` = **Shortcut Input**, `title` = **Shortcut Input → Name**
3. Tap the shortcut's name → **Show in Share Sheet**, and allow **Safari web pages, URLs, Text**. Optionally add **Show Notification** ("Saved to Second Brain") after it.
4. In Safari (or any app) tap Share → **your shortcut**. The item lands in the Inbox; a lone link is saved as a link capture, and AI processing starts as usual. Sharing the same thing twice is detected as a duplicate.

A wrong or missing token returns 401 and is throttled after 8 failures. Leave `SBOS_CAPTURE_TOKEN` empty to switch the feature off (the endpoint then answers 404).

## Tests

| Command | What it covers |
| --- | --- |
| `npm test` | 103 unit/integration tests with a mock model: file safety, auth/CSRF, capture and failure paths, search fallback, backup/restore/retention/encryption, share-token capture, grounded chat, safe Markdown rendering |
| `npm run typecheck` | TypeScript |
| `npm run build` then `npm run e2e` | 25 Playwright browser tests on a scratch data folder with a fake Ollama, using your installed Google Chrome (no browser download): login, capture to note to search to task, duplicates, projects, grounded chat with citations, Claude handoff, settings/backup/sign-out, command palette, note editor with safe Markdown preview, task edit/snooze/undo, "today" in far-away timezones, phone task layout, home-screen manifest, no horizontal overflow on 10 pages at 375/390/430/768/1024/1440px, tap-target sizes, keyboard focus, the web share target, and an automated axe-core WCAG 2.2 A/AA scan of every page in both themes on desktop and phone, including the Workflow page with dependencies, suggestions, the graph and the phone agenda. Screenshots are saved to `test-results/shots/` |
| `npm run smoke` | HTTP end-to-end against a running instance, with real Ollama (see docs/SETUP.md) |
| `npm run audit` | Dependency audit |

## Interface

Dark-first (light theme follows the OS or Settings), compact, one icon set (lucide). Violet accent is reserved for active navigation, primary actions, focus and AI-generated content.

- **Ctrl+K (⌘K)** command palette: jump to any page, create a capture/note/task/project, open a project, find notes by title, or run a full library search / Ask AI. Every entry is a real action.
- **Plan** (sidebar, tab bar or Ctrl+K; `/workflow` and `/pipeline` redirect here) plans your week from your real tasks, with three views. *Week*: seven day columns with the hours planned per day (heavy days are flagged), overdue tasks pinned on top, drag a task to another day, and a details panel with its dependencies, linked notes and the AI-suggested links you accept or dismiss. On a phone it becomes a day strip with one day's list. *Timeline*: one lane per project, one chip per task on its due day with arrows for dependencies; drag a chip (or focus it and use the arrow keys) to change its real due date, *Undo date changes* puts them back, and *Critical path* highlights the longest unfinished chain. *Graph*: projects, tasks, notes, tags and captures as nodes; hover traces a chain, click pins it, drag moves nodes (remembered per device). Task estimates (`estimate_min`) feed the daily load.
- **Sidebar** (desktop, 1024px and up): New capture (N), search or jump (Ctrl+K), Today, Inbox (with the count to review), Notes, Plan, Ask, your projects with their colour, the local model status, and Settings & automations. Below 1024px it becomes a slim top bar plus a bottom tab bar (Today, Inbox, Notes, Plan, Ask); the capture screen and the inbox review flow use the full screen.
- **Today** (`/`) shows a plain-language summary of what is due and waiting for review (computed from your database, nothing generated), a one-box quick capture, today's focus tasks with a completion circle, captures to review, the week at a glance and recent notes. Nothing on it is fabricated.
- **Inbox** (`/inbox`) is a list beside a review pane: your original on the left, the clearly labelled, editable AI proposal on the right (title, summary, tags, project, and the tasks it found with due dates you can tick). Keyboard: A accept, D dismiss, J/K move. On a phone, *Review* (`/inbox/review`) steps through them one by one. **Capture** (`/capture`, N) is its own screen: Note, Task or Link, project, due date, attachments and a switch for the local AI tidy-up; the web share target opens it prefilled.
- **Notes** (`/knowledge`) is a list, the note and a connections column (backlinks from `[[Title]]` links, tasks that came from the same capture, similar notes). Notes read like pages (properties, summary, rendered Markdown) and edit with Write/Preview and Ctrl+S. Markdown is rendered by a small built-in renderer that never injects raw HTML and only links http(s)/mailto. `/search` redirects to the notes search.

## What is in it

| Area | What works |
| --- | --- |
| Inbox | Text, ideas, tasks, links, excerpts, md/txt/pdf/image attachments. Saved before any AI runs. AI proposal (title, summary, category, tags, projects, next action, open questions, confidence) is reviewed, edited, accepted, dismissed or retried. Archive, delete with confirmation, duplicate protection. |
| Knowledge | Notes are real `.md` files with frontmatter in `vault/`. Keyword (FTS5) + semantic hybrid search, automatic keyword fallback, import of files/folders, reindex from disk, delete moves to `vault/.trash`. |
| Projects & Tasks | Projects with goals, status, target date, linked notes and activity. Tasks with priority, due date, filters; tap a task to edit it, move an overdue or due-today task to tomorrow, and undo a move or a delete from the toast. Deleted tasks go to a Trash (Tasks, bottom of the page) for 30 days: Undo or Restore brings back the very same task. The Plan page lays them out by week, on a timeline with dependencies, or as a graph. "Today" and "overdue" follow the clock of the device you are using, so the phone and the PC agree. Capture to task conversion only with your approval. |
| Ask | Model picker, streaming chat, conversation history, custom system prompt, library-grounded answers with numbered citations and an explicit "not enough evidence" path. With "Answer from my library" on, the model also sees a live snapshot of your active projects and tasks (status, priority, due and overdue, tasks finished in the last 14 days), so it can answer "what is in progress for X?". **Suggest tasks** proposes tasks from your request and the conversation; you tick, edit and add the ones you want, nothing is saved before that, and reworded copies of tasks you already have are filtered out. |
| Claude handoff | Build a Markdown context package, review it, copy or download it, open claude.ai yourself, paste Claude's answer back as a note. The app never contacts Claude. |
| Today | Summary and briefing computed only from local rows. No calendar is connected, and it says so. |
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
| `npm run backup [-- --copy-to <dir> --keep <n> --encrypt]` / `npm run export` | Create and verify a backup (optionally copy it to another drive, encrypted, and prune old ones) / export Markdown + JSON |
| `npm run import-plan -- <plan.md> [--name <project>] [--yes]` | Replace ALL projects and tasks with the task table of a plan file (tasks get start and due dates). Dry run unless `--yes`; takes a backup first |
| `npm run restore -- <name, folder or file.sbosenc> [--verify] --yes` | Verify only, or restore a backup from anywhere (app must be stopped) |
| `npm run audit` | Dependency vulnerability audit |

## Documents

- [docs/SETUP.md](docs/SETUP.md): install, models, backup/restore, Tailscale, troubleshooting
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design and data layout
- [docs/SECURITY.md](docs/SECURITY.md): threat model, controls, remaining limitations
- [docs/ROADMAP.md](docs/ROADMAP.md): what is next

The PC must be awake and Ollama running for local AI; capture, notes, tasks and keyword search work without it.
