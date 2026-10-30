# CUEPA hub update — Oct 30, 2026

Copy these files into the `cuepa-app` repo root (same folders), commit, push. Vercel builds it.
Nothing else in the repo changes. Env vars already exist in Vercel (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI, AUTH_SECRET, BLOB_READ_WRITE_TOKEN, CUEPA_USERS, CUEPA_CONTACT).

## New
- `api/today.js`  — new Today page (3 panels, light/dark toggle). Real data only: /api/google, /api/timecards, /api/gmail.
- `api/gmail.js`  — Gmail connect + Inbox page + send/reply.
- `lib/gmail.js`  — Gmail logic (OAuth, encrypted refresh token in private Blob `gmail/<ws>.json`).
- `tests/gmail.test.cjs` — run `npm test` (5 tests).

## Changed
- `vercel.json` — routes:
  - `/<ws>`          → Today (new front door)
  - `/<ws>/hub`      → the classic hub (Calendar, Timecards, Vendors, Meetings, Setup, Access)
  - `/<ws>/inbox`    → Inbox
  - `/api/gmail/callback` → Gmail OAuth return
- `api/hub.js` — Setup › Email › Gmail now shows "Connect Gmail →" and opens `/<ws>/inbox` (replaces "Save my choice").

## Notes
- Google Calendar's OAuth return (`/<ws>?google=…`) is forwarded by Today to `/<ws>/hub?google=…#connect`, so the calendar picker still works.
- Do NOT add `api/zsrc.js` — that was a temporary preview-only helper and is intentionally left out.
