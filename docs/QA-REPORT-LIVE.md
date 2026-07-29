# Live End-to-End QA Report — 2026-07-29

The previous QA pass (`docs/QA-REPORT.md`) was **static**: typecheck, build, unit
tests, syntax. This session performed the first **live** verification — real
PostgreSQL 16, real server boot, real Chromium browser, desktop and mobile — and
found (then fixed) five real defects that static analysis could never catch.

## Environment
- PostgreSQL 16.13, fresh database per run (clean-room installs)
- Node 22, backend booted with `NODE_ENV=production`, `JWT_SECRET`, CORS allow-list
- Web app: production build (`vite build`), served via `vite preview`
- Browser: Chromium via Playwright, 1440×900 desktop + 390×844 mobile (touch)

## Results (after fixes)

| Suite | Result |
|---|---|
| Backend unit tests (`npm test`) | ✅ 18/18 |
| Fresh-DB migrations (`node migrate.js`) | ✅ 8/8, idempotent |
| First boot on a fresh DB | ✅ zero errors, zero deadlocks |
| Live API integration smoke (`backend/test/integration/smoke.js`) | ✅ **45/45 calls** across projects, tasks (incl. subtasks), punch items (full open→in-progress→ready-for-review→closed workflow), sheets (custom columns, rows, hierarchy, cell edits), automations, forms (public fetch + public submit → creates punch item), notifications, documents, incidents, observations, contracts, budget, schedule, RFIs, daily logs, timesheets, users, audit log, search — plus auth-required and bad-credential negative checks |
| Web typecheck (`tsc --noEmit`) | ✅ clean |
| Web production build | ✅ 129 kB gzip JS |
| Browser E2E (22 steps, desktop) | ✅ all pass — login, dashboard, projects, punchlist (create item via UI, board view), sheets (open grid), schedule/Gantt, calendar, automations, forms, analytics, files, reports, notifications, AI, settings |
| Browser E2E (mobile 390px) | ✅ login, dashboard, punchlist, calendar — **no horizontal overflow**, bottom navigation works |
| Browser console/page errors | ✅ 0 / 0 (after self-hosting fonts) |

## Bugs found and fixed this session

1. **Boot-time migration deadlocks left random tables missing (critical).**
   ~50 route modules run idempotent `CREATE TABLE` DDL concurrently at require
   time; Postgres picked deadlock victims (`40P01`) and `notifications`,
   `incidents`, `drafts`, `documents` were simply never created — every endpoint
   touching them returned 500 until a lucky second boot. Worse, the `projects`
   module's column-add ALTERs were also victims, so `GET /api/projects` itself
   500'd (`column "project_number" does not exist`) — making a fresh install
   unusable. **Fix:** deadlock-aware retry with randomized backoff in the shared
   db layer (`backend/src/db/index.js`). Verified: repeated clean-room boots with
   zero deadlocks and all 80 tables present.

2. **`createAdmin.js` was drifted from the real schema.** It inserted a
   `username` column that doesn't exist, so a fresh install had no way to create
   the first admin. **Fix:** rewritten against the actual schema, idempotent
   (`ON CONFLICT (email)`), credentials configurable via `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

3. **`observations` had no table definition anywhere.** The routes were written
   against a production database that had been hand-mutated by the legacy patch
   scripts; every observations endpoint 500'd on a fresh install. **Fix:** new
   migration `008_observations.sql` (with indexes), matching the routes' queries.

4. **Legacy-data migrations raced their own table creation.** In
   `incidents`/`timesheets`/`meetings`, a second "legacy migration" IIFE ran
   concurrently with the module's `CREATE TABLE` IIFE; on a fresh DB the ALTERs
   fired first and failed, silently leaving columns missing until the next boot.
   **Fix:** the legacy block now awaits the table-creation promise.

5. **`contracts` was referenced before it was created.** In
   `cost-management.js`, `change_orders` (with `REFERENCES contracts(id)`) was
   created before `contracts`, so the whole cost-management migration aborted on
   fresh installs and `/cost/contracts` 500'd. **Fix:** creation reordered.

### Polish
6. **Self-hosted the Inter font** (`@fontsource/inter`) instead of a runtime
   Google Fonts fetch — removes the only external runtime dependency, the only
   source of console errors, and a failure mode behind strict proxies/offline.

## Regression protection added
- `backend/test/integration/smoke.js` — the 45-call live suite is now committed.
- `.github/workflows/ci.yml` — new **integration job**: spins up Postgres 16,
  runs migrations on a fresh DB, boots the API, fails the build on any boot-time
  `deadlock`/`does not exist` log line, then runs the smoke suite.

## Known limitations (documented, not defects)
- AI chat needs `ANTHROPIC_API_KEY` at runtime (UI degrades gracefully without it).
- Media (punch photos/voice) stored as data URLs — recommend object storage for scale.
- Google/Outlook two-way calendar sync, email/SMS delivery remain deferred (see gap matrix in `docs/CONSOLIDATION-REPORT.md`).
- Camera/voice/GPS capture verified at API level and in mobile-viewport browser; real-device hardware QA still recommended.
