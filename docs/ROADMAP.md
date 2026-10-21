# Roadmap

## Done (release 0.1)

Phases 0 to 4 and the software parts of 5 and 6: capture inbox, knowledge library, projects/tasks, local AI workspace with grounded answers, Claude handoff, briefing, auth, backup/restore, manual jobs.

## Not done or not verified yet

- **iPhone over Tailscale/HTTPS is unverified.** Needs `tailscale serve`, secure-cookie env settings and a test from the phone (docs/SECURITY.md). Not configured by the build because it changes network exposure.
- **Browser UI automation tests.** Covered instead by mocked-model unit/integration tests, an HTTP end-to-end smoke test, and manual visual checks at desktop and phone widths. Add Playwright next.
- **Semantic search not exercised with a real embedding model** (not installed). Logic is tested with a deterministic fake embedder.
- No scheduled backups, no OCR, no DOCX/PPTX extraction, no calendar, no voice.
- Capture from iPhone share sheet (needs HTTPS PWA/Shortcut).

## Next, in value order

1. Pull `nomic-embed-text`, build the index, evaluate result quality on real notes.
2. Tailscale Serve + phone test; add the Home Screen shortcut flow.
3. Playwright smoke suite for capture, accept, search, task, chat.
4. Scheduled backup with retention (Task Scheduler running `npm run backup`).
5. Optional: n8n or an internal scheduler for "process new captures" with an approval step; scheduled briefing.
6. Optional: additional `LlmProvider` implementations (explicitly configured, cost disclosed); DOCX extraction library; OCR.
