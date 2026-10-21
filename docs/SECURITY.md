# Security

Scope: a single-user system on a home PC, reached from the same PC and from an iPhone over Tailscale. It is not hardened for the public internet and must not be exposed there.

## Controls implemented and how they are verified

| Control | Implementation | Verified by |
| --- | --- | --- |
| Localhost binding | `dev`/`start` use `-H 127.0.0.1` | server banner; only the local address listens |
| Authentication on everything | Every API route is wrapped by `route()`; pages redirect to `/login`; with no password configured the API answers 503 | `tests/api-auth.test.ts`, `npm run smoke` |
| Password storage | scrypt (N=32768), random salt, constant-time compare, minimum 12 chars; set only via CLI, never in source or env | unit tests |
| Sessions | HMAC-signed cookie, 7-day expiry, HttpOnly, SameSite=Strict, Secure when `SBOS_SECURE_COOKIES=1`. Signing key mixes `SBOS_SESSION_SECRET` with a password fingerprint, so rotating either logs everyone out | unit tests |
| Login throttling | 8 failures per 15 minutes per client key, in memory | unit test |
| CSRF | State-changing requests need header `x-sbos: 1` (cannot be sent cross-site without a CORS preflight) plus Origin check when present; allowed extra origins via `SBOS_ALLOWED_ORIGINS` | tests + smoke (cross-origin POST gets 403) |
| Input validation | zod schemas at API boundaries; 2 MB JSON cap; upload cap `SBOS_MAX_UPLOAD_MB` | tests |
| Filesystem safety | `sanitizeFilename`, `resolveInside` (rejects `..`, absolute, drive letters, UNC, NUL, escaping symlinks), temp-file + rename, never overwrite | `tests/safe-fs.test.ts` |
| Upload safety | Extension allowlist (md, txt, pdf, images) + magic-byte check; nothing is executed; downloads served as `application/octet-stream` with `CSP: sandbox` and `nosniff` | tests + smoke (`.exe` rejected) |
| Output safety | Notes shown as plain text, search snippets split on markers and rendered as text nodes | code review |
| Error hygiene | Unknown errors return a generic 500; logs are one-line JSON and never include note or capture content | test |
| Secrets | `.env.local` is git-ignored; `.env.example` has placeholders only; Anthropic or other API keys are not used anywhere | repo review |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities at the time of the first release check | `npm run audit` |
| AI boundaries | Models only produce text/JSON proposals. They get no tools, no shell, no file access. Jobs are a fixed enum. Nothing is saved, created or sent without a user click. Library content is never sent to a cloud model; the Claude workflow is a manual copy/download | design |

## Share-sheet capture token

`POST /api/share` is the only route that accepts something other than the login cookie. It requires `Authorization: Bearer <SBOS_CAPTURE_TOKEN>` (32+ characters, compared in constant time, same 8-failures-per-15-minutes throttle as login) plus the usual `X-SBOS` header, is checked before the body is read, and can only create an inbox capture (saved first, AI proposal reviewed by you as always). Without a configured token it answers 404. The token lives only in `.env.local` and in the iPhone Shortcut; rotate it by changing the value in both. Anyone holding it can add junk to your inbox, nothing more. Verified by unit tests (disabled, wrong/missing/cookie-only token, throttling, duplicates).

## Remote access (iPhone)

Use Tailscale only. Never port-forward 3000 or 11434.

1. Keep the app on 127.0.0.1 and publish it privately with Tailscale Serve (HTTPS, tailnet-only):
   `tailscale serve --bg 3000`
   Note: this reconfigures your machine's network exposure, so run it yourself after reading `tailscale serve status`. Do **not** use `tailscale funnel` (public).
2. Set in `.env.local`: `SBOS_SECURE_COOKIES=1` and `SBOS_ALLOWED_ORIGINS=https://<machine>.<tailnet>.ts.net`, restart the app.
3. On the iPhone open that https URL in Safari and sign in.

HTTPS matters for iOS features such as the clipboard API. Until you have done these steps and tested from the phone, treat remote access as **not configured**.

## Rotating secrets

- Password: `npm run set-password` (all sessions end).
- Session secret: change `SBOS_SESSION_SECRET` in `.env.local`, restart (all sessions end).

## Known limitations

- Single user, single password, no MFA. Tailscale device approval is the real perimeter.
- Login throttling is per process and resets on restart.
- Data at rest is not encrypted by the app; use BitLocker for the disk. Backups copied elsewhere can be encrypted with `npm run backup -- --encrypt` (AES-256-GCM, scrypt key from `SBOS_BACKUP_PASSPHRASE`); the passphrase sits in `.env.local` on this PC, so it protects the off-site copy, not a stolen PC.
- The Ollama API has no authentication of its own; it must stay on localhost.
- Scanned PDFs and images have no OCR; their content is not searchable.
- A malicious PDF could in principle target the parser (`unpdf`); only import documents you trust.
- Windows Firewall was not modified.
