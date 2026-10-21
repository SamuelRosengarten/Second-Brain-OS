# Roadmap

## Done (release 0.1)

Phases 0 to 4 and the software parts of 5 and 6: capture inbox, knowledge library, projects/tasks, local AI workspace with grounded answers, Claude handoff, briefing, auth, backup/restore, manual jobs.

## Not done or not verified yet

- iPhone over Tailscale HTTPS (`tailscale serve`, tailnet only, secure cookies) was set up and verified by hand: sign-in and a capture made on the phone appeared on the PC. The app auto-starts at login via the `SecondBrainOS` scheduled task. Not yet verified: that ports 3000 and 11434 are unreachable from outside the tailnet.
- Playwright browser tests exist (18: desktop, phone and responsive widths, fake Ollama, installed Chrome). They run on demand, not in CI. Not verified: whether the New-conversation regression test fails on the old buggy code, since that crash depended on how the browser's `scrollIntoView` behaves.
- Semantic search was verified by hand with `nomic-embed-text` (semantic badge on keyword-free queries, cited grounded answers, refusal when evidence is missing). Automated tests still use a deterministic fake embedder; quality on a large real library is untested.
- Weekly backup runs (Sundays 10:00, copied to `D:\SecondBrainOS-backups`, newest 8 kept). On 2026-10-21 a restore from the D: copy was rehearsed into a scratch data folder: all files identical, SQLite integrity ok, and a second app instance booted from it. Encrypted backups (`--encrypt`) were rehearsed the same way, including a wrong passphrase and a fresh machine with no data folders. The weekly task itself is not yet switched to `--encrypt` (needs your passphrase in `.env.local`), and no copy lives off-site yet. No OCR, no DOCX/PPTX extraction, no calendar, no voice.
- iPhone share-sheet capture: the endpoint, token and the Android/Chromium share target are built and tested, but the iOS Shortcut (README) has not been built and run on a real iPhone.

## Visual overhaul (done) and remaining visual work

Done: design tokens, shell, command palette, dashboard, inbox and AI review, notes reader/editor, tasks, projects, mobile and tablet navigation, responsive and keyboard tests (see README "Interface" and "Tests").

Not done / not verified:
- Automated accessibility audit: an axe-core WCAG 2.2 A/AA scan (`e2e/a11y.spec.ts`) covers login and 15 pages plus the task dialog and command palette, in light and dark, on desktop and phone, and passes. Fixed along the way: badge and secondary-text contrast (light-theme status colours darkened and dark `--faint`/accent/danger lightened, by calculation), the Search button's accessible name, and undersized touch targets (quick-capture checkbox and links, conversation delete). Still manual: keyboard order, screen-reader wording (VoiceOver), zoom/reflow at 200-400%, motion, and anything axe cannot judge.
- Screenshots in `test-results/shots` come from headless Chrome in the light theme; the dark theme was inspected by hand on desktop (home, a note, the AI review, the command palette). The dark theme at phone width and the final CSS-layer fix were verified by the test suite, not by eye. Real Safari on iPhone was not re-checked after the redesign.
- Home-screen app (manifest, icons, `appleWebApp` metadata) and the phone task layout were checked in desktop Chromium with iPhone/Pixel emulation only. Not verified on a real iPhone: the installed app's icon and full-screen look, the iOS status bar (`default` style), and that the keyboard stays down when the task dialog opens.
- Deleting a task is permanent; the Undo toast re-creates it from the fields on screen (new id and created date). Tasks still have no trash.
- Notes list has no sort options (API returns most recently updated first). Daily briefing lives on Home, not on a separate page. Settings, Automations, project detail and the AI workspace got the shared styling but not a bespoke redesign.
- A `prefers-color-scheme` change while the app is open is not re-tested.

## Next, in value order

1. Re-check the redesign in Safari on the iPhone with VoiceOver and larger text; do a manual keyboard pass.
2. Set `SBOS_BACKUP_PASSPHRASE`, point `--copy-to` at a synced or external folder with `--encrypt`, and update the weekly task. Rehearse a restore from that file once more on another PC if you can.
3. Build the iOS Shortcut (README) and confirm a share from Safari reaches the Inbox.
4. Optional: n8n or an internal scheduler for "process new captures" with an approval step; scheduled briefing.
5. Optional: additional `LlmProvider` implementations (explicitly configured, cost disclosed); DOCX extraction library; OCR.
