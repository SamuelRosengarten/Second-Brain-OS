# Roadmap

## Done (release 0.1)

Phases 0 to 4 and the software parts of 5 and 6: capture inbox, knowledge library, projects/tasks, local AI workspace with grounded answers, Claude handoff, briefing, auth, backup/restore, manual jobs.

## Not done or not verified yet

- iPhone over Tailscale HTTPS (`tailscale serve`, tailnet only, secure cookies) was set up and verified by hand: sign-in and a capture made on the phone appeared on the PC. The app auto-starts at login via the `SecondBrainOS` scheduled task. Not yet verified: that ports 3000 and 11434 are unreachable from outside the tailnet.
- Playwright browser tests exist (13: desktop, phone and responsive widths, fake Ollama, installed Chrome). They run on demand, not in CI. Not verified: whether the New-conversation regression test fails on the old buggy code, since that crash depended on how the browser's `scrollIntoView` behaves.
- Semantic search was verified by hand with `nomic-embed-text` (semantic badge on keyword-free queries, cited grounded answers, refusal when evidence is missing). Automated tests still use a deterministic fake embedder; quality on a large real library is untested.
- Weekly backup runs (Sundays 10:00, copied to `D:\SecondBrainOS-backups`, newest 8 kept) but restoring from the D: copy has not been rehearsed. No OCR, no DOCX/PPTX extraction, no calendar, no voice.
- Capture from iPhone share sheet (needs HTTPS PWA/Shortcut).

## Visual overhaul (done) and remaining visual work

Done: design tokens, shell, command palette, dashboard, inbox and AI review, notes reader/editor, tasks, projects, mobile and tablet navigation, responsive and keyboard tests (see README "Interface" and "Tests").

Not done / not verified:
- No automated accessibility audit (axe or Lighthouse) was run. Contrast was chosen by calculation (secondary text 5:1 or better on the dark background) and a few focus/tap-target checks are automated, but the full WCAG 2.2 AA review is manual work still to do.
- Screenshots in `test-results/shots` come from headless Chrome in the light theme; the dark theme was inspected by hand on desktop (home, a note, the AI review, the command palette). The dark theme at phone width and the final CSS-layer fix were verified by the test suite, not by eye. Real Safari on iPhone was not re-checked after the redesign.
- Notes list has no sort options (API returns most recently updated first). Daily briefing lives on Home, not on a separate page. Settings, Automations, project detail and the AI workspace got the shared styling but not a bespoke redesign.
- A `prefers-color-scheme` change while the app is open is not re-tested.

## Next, in value order

1. Run an accessibility audit (axe or Lighthouse) and fix findings; re-check the redesign in Safari on the iPhone.
2. Rehearse a restore from the D: copy; add an off-site or encrypted backup copy.
3. iPhone share-sheet capture (needs an HTTPS Shortcut or PWA share target).
4. Optional: n8n or an internal scheduler for "process new captures" with an approval step; scheduled briefing.
5. Optional: additional `LlmProvider` implementations (explicitly configured, cost disclosed); DOCX extraction library; OCR.
