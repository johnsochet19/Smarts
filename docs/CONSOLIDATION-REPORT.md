# Consolidation Report — scheduler → Smarts (2026-07-29)

## Why this repo
The platform was audited (`docs/PHASE-1-AUDIT.md`), then rebuilt increment by
increment inside `johnsochet19/scheduler` (see `docs/INCREMENT-*.md` and
`docs/PLATFORM-OVERVIEW.md`). That repo still carries the debt the audit
condemned: a 31,936-line `App.jsx` monolith, 42 codegen/patch scripts, committed
backups and base64 blobs. **This repo is the clean cut**: only the hardened
backend, the rebuilt TypeScript/React app, migrations, tests, CI, and docs.

## What was brought over
- `backend/` — full Express API (~50 domain route modules), middleware
  (auth/security), automation engine, TOTP auth, migration runner + 8 SQL
  migrations, unit tests, **plus the five fresh-install bug fixes made this
  session** (see `docs/QA-REPORT-LIVE.md`).
- `web/` — the rebuilt frontend (design tokens, component library, responsive
  AppShell with mobile bottom nav, 16+ feature modules), **plus self-hosted fonts**.
- `docs/` — audit, roadmap, all increment logs, QA reports.
- `.github/workflows/ci.yml` — rewritten: unit + syntax jobs kept, legacy-monolith
  job dropped, **new live Postgres integration job** added.
- `railway.json`, `backend/nixpacks.toml`, `web/vercel.json` — deploy configs.
- `backend/.env.example` — documented configuration incl. `DEFAULT_TOOL_PERMISSION=none`
  (deny-by-default permissions).

## What was deliberately left behind (in `scheduler`)
- `frontend/` — the 2.4 MB legacy monolith (still deployed; the new app links to
  it via `VITE_LEGACY_BASE` for the handful of unported classic modules).
- 42 `*.ps1` / `fix*.js` / `update*.js` codegen scripts, `App.jsx.backup`,
  `app_b64.txt`, `h`, and other committed junk.
- `mobile/` (Capacitor) and `desktop/` (Electron) wrappers — they wrap the legacy
  bundle; wrapping `web/dist` instead is a follow-up.
- `setup-db.js` — superseded by `backend/migrations/` as the single schema source
  of truth.

Nothing in the working platform was dropped: the legacy monolith remains
untouched and deployed from `scheduler`, and every rebuilt module lives here.

## Also in this repo
- `website/` — the JR Fine Wood static site that previously occupied this repo's
  root; preserved unmodified, just moved into its own folder.

## Status vs the MASTER BUILD brief

| Area | Status |
|---|---|
| Auth (JWT, bcrypt, rate-limited login, MFA/TOTP, password reset) | ✅ live-verified |
| Roles & granular tool permissions (deny-by-default via env) | ✅ (workspace-level RBAC = follow-up) |
| Projects / Tasks (subtasks, dependencies, statuses, priorities) | ✅ live-verified |
| Sheets engine (14 column types, hierarchy, formulas, cond. formatting) | ✅ live-verified |
| Views: Grid, List, Board/Kanban, Calendar, Gantt+CPM, Timeline, Map (punch) | ✅ |
| Punchlist (statuses, categories, photos/voice/GPS, mobile) | ✅ live-verified |
| Calendar (month/week/agenda, drag-reschedule) | ✅ |
| Dashboards & Analytics (KPIs, charts, aging, workload) | ✅ (drag-drop widget layout = follow-up) |
| Automation engine (trigger→condition→action) | ✅ live-verified |
| Forms (builder, public links, submissions → records) | ✅ live-verified |
| Files (upload, preview, versions) | ✅ |
| Notifications (in-app inbox, bell, unread) | ✅ (email/push/SMS delivery = follow-up) |
| AI assistant (chat + insight cards) | ✅ UI/API; needs `ANTHROPIC_API_KEY` |
| Audit log | ✅ live-verified |
| Construction depth: RFIs, submittals, daily logs, inspections, cost mgmt, timesheets, meetings, permits, incidents, observations | ✅ — beyond Smartsheet |
| CI with live-DB integration gate | ✅ new this session |
| Multi-tenant organizations/workspaces layer | 🔴 largest remaining architectural gap |
| Google/Outlook two-way calendar sync | 🔴 deferred (OAuth plumbing exists for Google/Box) |
| Email/SMS/Slack delivery channels | 🔴 deferred |
| SSO/OAuth login, WebAuthn | 🔴 deferred |
| Native mobile wrappers over the new app | 🔴 deferred |

## Recommended next steps (in order)
1. **Workspaces/multi-tenancy** — add `organizations` + `workspaces` tables and a
   tenant column across domain tables (migration-driven; the FK graph is now clean).
2. Point the Capacitor shell at `web/dist` to ship the mobile apps on the new UI.
3. Email delivery (transactional provider) behind the existing notification triggers.
4. Google Calendar two-way sync on the existing `google_tokens` OAuth plumbing.
5. Dashboard drag-drop widget layout on the existing widget components.
