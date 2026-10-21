# Roadmap

## Done (release 0.1)

Phases 0 to 4 and the software parts of 5 and 6: capture inbox, knowledge library, projects/tasks, local AI workspace with grounded answers, Claude handoff, briefing, auth, backup/restore, manual jobs.

## Not done or not verified yet

- iPhone over Tailscale HTTPS (`tailscale serve`, tailnet only, secure cookies) was set up and verified by hand: sign-in and a capture made on the phone appeared on the PC. The app auto-starts at login via the `SecondBrainOS` scheduled task. Not yet verified: that ports 3000 and 11434 are unreachable from outside the tailnet.
- Playwright browser tests exist (18: desktop, phone and responsive widths, fake Ollama, installed Chrome). They run on demand, not in CI. Not verified: whether the New-conversation regression test fails on the old buggy code, since that crash depended on how the browser's `scrollIntoView` behaves.
- Semantic search was verified by hand with `nomic-embed-text` (semantic badge on keyword-free queries, cited grounded answers, refusal when evidence is missing). Automated tests still use a deterministic fake embedder; quality on a large real library is untested.
- Weekly backup runs (Sundays 10:00, copied to `D:\SecondBrainOS-backups`, newest 8 kept). On 2026-10-21 a restore from the D: copy was rehearsed into a scratch data folder: all files identical, SQLite integrity ok, and a second app instance booted from it. Encrypted backups (`--encrypt`) were rehearsed the same way, including a wrong passphrase and a fresh machine with no data folders. Since 2026-10-21 the weekly task also writes an encrypted copy to OneDrive (`--encrypt-to`); whether OneDrive actually syncs it is not verified. No OCR, no DOCX/PPTX extraction, no calendar, no voice.
- iPhone share-sheet capture: the endpoint, token and the Android/Chromium share target are built and tested, but the iOS Shortcut (README) has not been built and run on a real iPhone.

## Visual overhaul (done) and remaining visual work

Done: design tokens, shell, command palette, dashboard, inbox and AI review, notes reader/editor, tasks, projects, mobile and tablet navigation, responsive and keyboard tests (see README "Interface" and "Tests").

Not done / not verified:
- Automated accessibility audit: an axe-core WCAG 2.2 A/AA scan (`e2e/a11y.spec.ts`) covers login and 15 pages plus the task dialog and command palette, in light and dark, on desktop and phone, and passes. Fixed along the way: badge and secondary-text contrast (light-theme status colours darkened and dark `--faint`/accent/danger lightened, by calculation), the Search button's accessible name, and undersized touch targets (quick-capture checkbox and links, conversation delete). Still manual: keyboard order, screen-reader wording (VoiceOver), zoom/reflow at 200-400%, motion, and anything axe cannot judge.
- Screenshots in `test-results/shots` come from headless Chrome in the light theme; the dark theme was inspected by hand on desktop (home, a note, the AI review, the command palette). The dark theme at phone width and the final CSS-layer fix were verified by the test suite, not by eye. Real Safari on iPhone was not re-checked after the redesign.
- Home-screen app (manifest, icons, `appleWebApp` metadata) and the phone task layout were checked in desktop Chromium with iPhone/Pixel emulation only. Not verified on a real iPhone: the installed app's icon and full-screen look, the iOS status bar (`default` style), and that the keyboard stays down when the task dialog opens.
- Task trash (30 days, restore keeps the same id), notes sorting, AI task suggestions with approval and chat access to projects/tasks are done and covered by tests. The Workflow page (timeline with dependencies, critical path, drag to reschedule, AI-suggested dependencies you accept or dismiss, graph of tasks/notes/tags/captures, phone agenda) follows a design made in Claude and was checked in Chromium on desktop and at 390px, dark and light, with axe-core and with your real model (15 s for 35 tasks, sensible suggestions). It has not been used on a real iPhone: touch dragging of graph nodes and the sheet behaviour are the things to try first. Notes are linked in the graph only through real data (note-project, tag-note, capture-task, capture-note), so a note does not appear connected to a task unless one of those links exists.
- A `prefers-color-scheme` change while the app is open is not re-tested.

## Next, in value order

1. Re-check the redesign in Safari on the iPhone with VoiceOver and larger text; do a manual keyboard pass.
2. Keep the backup passphrase (`SBOS_BACKUP_PASSPHRASE` in `.env.local`) somewhere that is not this PC, and confirm OneDrive really syncs `SecondBrainOS-backups`. Rehearse a restore from the encrypted file on another PC if you can.
3. Build the iOS Shortcut (Settings now shows the exact values to copy) and confirm a share from Safari reaches the Inbox.
4. Optional: n8n or an internal scheduler for "process new captures" with an approval step; scheduled briefing.
5. Optional: additional `LlmProvider` implementations (explicitly configured, cost disclosed); DOCX extraction library; OCR.
