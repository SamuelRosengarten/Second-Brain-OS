# Roadmap

## Done (release 0.1)

Phases 0 to 4 and the software parts of 5 and 6: capture inbox, knowledge library, projects/tasks, local AI workspace with grounded answers, Claude handoff, briefing, auth, backup/restore, manual jobs.

## Not done or not verified yet

- iPhone over Tailscale HTTPS (`tailscale serve`, tailnet only, secure cookies) was set up and verified by hand: sign-in and a capture made on the phone appeared on the PC. Not yet verified: that port 3000 and 11434 are unreachable from outside the tailnet; the app stops when its terminal closes (no auto-start yet).
- Playwright browser tests exist (8, desktop + phone, fake Ollama, installed Chrome). They run on demand, not in CI. Not verified: whether the New-conversation regression test fails on the old buggy code, since that crash depended on how the browser's `scrollIntoView` behaves.
- Semantic search was verified by hand with `nomic-embed-text` (semantic badge on keyword-free queries, cited grounded answers, refusal when evidence is missing). Automated tests still use a deterministic fake embedder; quality on a large real library is untested.
- Weekly backup runs (Sundays 10:00, copied to `D:\SecondBrainOS-backups`, newest 8 kept) but restoring from the D: copy has not been rehearsed. No OCR, no DOCX/PPTX extraction, no calendar, no voice.
- Capture from iPhone share sheet (needs HTTPS PWA/Shortcut).

## Next, in value order

1. Tailscale Serve + phone test; add the Home Screen shortcut flow.
3. Occasionally test a restore from the D: copy; add an off-site or encrypted backup copy.
4. Optional: n8n or an internal scheduler for "process new captures" with an approval step; scheduled briefing.
6. Optional: additional `LlmProvider` implementations (explicitly configured, cost disclosed); DOCX extraction library; OCR.
