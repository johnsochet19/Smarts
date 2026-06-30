# BuildForge / Scheduler — Phase 1 Full Application Audit

**Audited repo:** `johnsochet19/scheduler` (HEAD `e534419`)
**Date:** 2026-06-30
**Auditor scope:** Frontend, backend, APIs, DB schema, auth, integrations, UI/UX, performance, mobile.

> **Important context:** The target repo (`johnsochet19/Smarts`) was empty; the real application lives in `johnsochet19/scheduler` and was cloned for this audit. This document is the evidence-based audit of that codebase. Every claim below cites a file you can open.

---

## 0. Executive Summary

BuildForge is a **genuinely feature-rich construction project-management suite** — far more than a "scheduler." The **backend is the strong half**: ~50 well-separated Express route modules covering projects, tasks, RFIs, submittals, daily logs, inspections, punch lists, drawings, specs, cost management, timesheets, meetings, permits, photos, documents, notifications, audit log, search, Google/Box/Excel integrations, an AI assistant, and even a "Superhuman" email client. That is real, valuable functionality and most of it should be **kept**.

The **frontend is the critical liability**. Essentially the entire UI is a **single 31,936-line, 2.4 MB `App.jsx` file** with its own hand-rolled design system, an inline admin visual editor, **805 `useState` calls and 2,488 inline `style={{…}}` blocks** in one module. It was clearly assembled by **42 committed code-generation/patch scripts** (`*.ps1`, `fix*.js`, `update*.js`) that string-inject code — a build process that is unmaintainable and the root cause of most of the technical debt.

**Mobile** is a Capacitor shell wrapping the same desktop-first web bundle — there is no responsive system, so "mobile" today is the desktop UI in a native window.

**Bottom line:** Keep and harden the backend and the data/integration layer. The frontend needs a **ground-up rebuild on a real component architecture** — and that rebuild is also the single highest-leverage step toward the Smartsheet-parity and mobile goals.

---

## 1. Inventory — What Actually Exists

### 1.1 Stack
| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 19, Vite 7, react-router 7, Recharts, date-fns, xlsx, jsPDF, socket.io-client | SPA, deployed to Vercel |
| Backend | Node/Express 4, PostgreSQL (`pg`), socket.io, node-cron, Multer | Deployed to Railway (`scheduler-production-6ac2.up.railway.app`) |
| AI | `@anthropic-ai/sdk` (backend route + Vercel serverless `frontend/api/ai/*`) | Two parallel AI paths |
| Integrations | Google APIs, Box, Excel (exceljs/xlsx) | |
| Mobile | Capacitor 6 (iOS/Android), wraps `frontend/dist` | `mobile/capacitor.config.ts` |
| Desktop | Electron (`desktop/main.js`) | |

### 1.2 Backend route modules (≈50) — `backend/src/routes/`
auth, projects, tasks, users, dependencies, changelog, audit-log, related-items, themes, search, export/import, google, rfis, submittals, daily-logs, project-inspections, observations, punch-items, drawings, specifications, cost-management, schedule-items/schedule/schedules, timesheets, meetings, correspondence, incidents, permits, companies, equipment, photos, project-documents, notifications, budget, drafts, reminders, attachments, box, excel, ai, claude-code, superhuman-emails/-ai/-tracking.

### 1.3 Frontend modules — `frontend/src/`
- **Monolith:** `App.jsx` (31.9k lines) — routing, auth context, theme, an inline design system (`DSBtn/DSCard/DSInput/DSModal/DSTable…`), an inline admin editor (`IEText/IEImage/IEModal/EditOverlay…`), and most pages.
- **Separate pages:** `Dashboard`, `Schedule`, `Documents`, `GoogleSheets`, `Users`, `Settings`, `Search`, `Login`, `AIChatPanel`, `ClaudeCodePanel`, `AdminVisualEditor`, `Changelog`.
- **Feature folders:** `bidding/` (bid packages, leveling, trade partners), `superhuman/` (full email client UI).
- **Components:** `GanttChart`, `Navbar`, `Sidebar`, `ExcelImportModal`.

---

## 2. Feature Classification (the 3 buckets requested)

### ✅ Category 1 — Good, KEEP & improve
- **Backend route/domain separation** — clean one-module-per-domain structure.
- **Breadth of construction domain features** — RFIs, submittals, daily logs, inspections, punch items, cost management, timesheets, permits, etc. This is real parity-plus for the *construction* use case (beyond what Smartsheet ships).
- **Auth core** — bcrypt password hashing + JWT (`routes/auth.js`, `middleware/auth.js`). Mechanism is sound; needs hardening (§4).
- **Role + per-tool permission model** — `requireRole` and `requireToolPermission` with a `user_tool_permissions` table and granular levels. Good foundation for the Owner/Admin/Manager/Member/Viewer requirement.
- **Audit log + changelog** — already implemented server-side.
- **Real-time channel** — socket.io already wired (`app.set('io', io)`).
- **Integrations** — Google, Box, Excel import/export, AI assistant all present.

### 🟡 Category 2 — Partially works, FIX & upgrade
- **Gantt / schedule** — exists (`components/GanttChart.jsx`, `pages/Schedule.jsx`) but lives inside the monolith ecosystem; needs to become a first-class, virtualized, dependency-aware view.
- **Dashboards** — `pages/Dashboard.jsx` + Recharts exist but are not configurable widget grids.
- **Punch list** — backend `punch-items.js` is solid; UI lacks Board/Calendar/**Map** views and field-team (photo/voice/GPS/offline) features.
- **Notifications** — in-app + due-date cron exist; email/push/SMS and a unified inbox are incomplete.
- **AI assistant** — works, but **two divergent implementations** (backend `routes/ai.js` using `node-fetch` + a Vercel serverless `frontend/api/ai/chat.js` using the SDK). Consolidate.
- **Permissions** — model exists but **defaults to `standard` when no row is present** (`middleware/auth.js`) — permissive-by-default; should be deny-by-default.
- **Theme system** — multiple competing theme mechanisms (`ThemeContext`, `themes` route, inline `IE*` editor, `*theme*.ps1` scripts).

### 🔴 Category 3 — Missing, BUILD
- **Generic Sheets/grid engine** (Smartsheet core): custom columns/column-types, formulas, row hierarchy, conditional formatting, freeze/lock — **not present**.
- **Multiple swappable Views** (Grid/Gantt/Calendar/Kanban/Timeline/List) over the same data — not present as a unified system.
- **No-code Automation engine** (triggers → conditions → actions) — not present.
- **Forms builder** (public/internal, conditional logic) — not present.
- **Workspaces / multi-tenancy** — there is no workspace/org boundary above "projects."
- **True responsive/mobile UI** — not present (§7).
- **File version history & previews** — attachments exist; versioning/preview do not.
- **Automated tests / CI** — none exist (§5).

---

## 3. Technical Audit

### 3.1 Frontend architecture — **CRITICAL**
- `frontend/src/App.jsx`: **31,936 lines / 2.39 MB in one file.** `805` `useState`, `2,488` inline `style={{}}`, mixed JSX **and** `React.createElement` + ES5 `var` — hallmarks of machine-generated code.
- **42 committed codegen/patch scripts** (`*.ps1`, `fix.js…fix11.js`, `update-v6.*.js`, `phase*-*.ps1`) are the de-facto build pipeline. Editing the app means re-running string-injection scripts, not editing components.
- **Hardcoded production API URL** (`https://scheduler-production-6ac2.up.railway.app`) embedded across `App.jsx`, `api.js`, `superhuman/api.js`, `pages/*`, and even `backend/src/routes/budget.js`. No env-based config.
- Committed junk: `App.jsx.backup`, `app_backup.txt`, `app_b64.txt` (150 KB base64 of the app), a stray file named `h` (51 KB), `frontend/test.jsx`.

**Impact:** unmaintainable, un-reviewable, slow to load (one giant JS chunk), impossible to unit-test, and the direct blocker to responsiveness and a design system.

### 3.2 Backend architecture — **GOOD with gaps**
- Clean modular routing (`backend/src/index.js` mounts ~50 routers). This is the healthiest part of the codebase.
- **Schema is defined in at least three divergent places** and has drifted: `setup-db.js` defines `tasks(name, start_date, finish_date, status…)` with **no `project_id`**, while `routes/ai.js` queries `tasks(title, status, due_date, priority) WHERE project_id = $1`. The runtime schema was mutated by the `.ps1` scripts and no longer matches `setup-db.js`. **There is no migration framework and no single source of truth for the schema.**
- Ad-hoc `migrate()` in `index.js` plus `createSuperhumanTables()` create tables at boot — order-dependent and fragile.
- No central error handler, no request validation layer, no rate limiting, no structured logging.

### 3.3 API design
- REST is reasonable but **every resource is double-mounted** (`/api/projects/:id/rfis` *and* `/api/rfis`, etc.) "for backward compat," doubling surface area and auth-surface.
- No API versioning, no OpenAPI/spec, inconsistent response envelopes (`{error}` vs raw rows).
- Some routers mounted under `/api/projects/:id/...` rely on `req.params` that Express won't populate without `mergeParams: true` — verify each router sets it.

### 3.4 Database design
- No indexes defined beyond PKs/FKs; no `updated_at` triggers; `ON DELETE` rules inconsistent.
- No workspace/tenant column anywhere — multi-tenancy will require a schema migration.
- `changelog` defined twice with different columns (`index.js` migrate vs `setup-db.js`).

### 3.5 Performance
- **Single 2.4 MB JS entry** = large parse/eval, poor TTI, no code-splitting/lazy-loading despite react-router.
- No query pagination visible on list endpoints (`LIMIT` used sparingly); large projects will return unbounded rows.
- No caching layer (HTTP cache headers, Redis, or query memoization).

### 3.6 Scalability
- `io = new Server(..., { cors:{ origin:'*' }})` and single-process socket.io with no adapter — won't scale horizontally without a Redis adapter.
- Cron jobs (`startSuperhumanCron`, `startDueDateCron`) run **in-process** on every instance — will double-fire if scaled to >1 replica.
- DB pool created per-process with no SSL in the runtime `db/index.js` (only `setup-db.js` sets SSL).

---

## 4. Security Audit

| # | Severity | Finding | Evidence |
|---|---|---|---|
| S1 | **High** | **Unauthenticated debug endpoint writes request body to disk** and records the caller's JWT (`localStorage.token`) into `.claude-debug-request.txt`. Any anonymous POST can write/overwrite that file and inject content. | `backend/src/index.js` `POST /api/debug-report` |
| S2 | **High** | **CORS fully open** (`origin:'*'`) on both Express and socket.io, app-wide. | `index.js`, `frontend/api/ai/chat.js` |
| S3 | **High** | **No rate limiting / account lockout** on `/api/auth/login` — brute-force open. | `routes/auth.js` |
| S4 | Med | **Permissions default to `standard` (write) when no permission row exists** — permissive-by-default instead of deny-by-default. | `middleware/auth.js` `requireToolPermission` |
| S5 | Med | **DB TLS verification disabled** (`ssl:{ rejectUnauthorized:false }`). | `setup-db.js` |
| S6 | Med | **No `JWT_SECRET` presence check** — if unset, token signing/verifying behavior is unsafe; 24 h tokens with no refresh/rotation/revocation. | `auth.js`, `middleware/auth.js` |
| S7 | Med | **No input validation / schema enforcement** on request bodies across routes; raw `req.body` fields flow into queries (parameterized, so not SQLi, but no type/shape guarantees). | most routes |
| S8 | Low | **Public tracking pixel** + tracking stats mounted at root (`/t/:pixelId`). Confirm no info leak. | `index.js`, `superhuman-tracking.js` |
| S9 | Low | No security headers (helmet), no HTTPS redirect, no body-size limits on JSON/uploads. | `index.js` |

> Good news: **no secrets are committed** (`.env` is git-ignored; no API keys found in tracked source). Passwords are bcrypt-hashed. Queries are parameterized.

---

## 5. Testing & Tooling
- **Zero automated tests** (no `*.test/*.spec`, no `__tests__`, no test runner configured).
- **No CI** workflow.
- ESLint present on frontend only (`frontend/eslint.config.js`); backend unlinted.
- No TypeScript anywhere (despite `@types/react` being installed).

---

## 6. Design / UI Audit

| Dimension | Finding |
|---|---|
| **Visual consistency** | Multiple overlapping systems: hand-rolled `DS*` components, `design-system.css` (56 KB), `mobile.css`, inline `IE*` editor styling, and `2,488` inline style objects. No single source of truth. |
| **Spacing** | No spacing scale/tokens — magic-number paddings scattered inline. |
| **Typography** | No type scale; font sizing ad hoc inline. |
| **Color** | Theme exists but split across `ThemeContext`, `/api/themes`, inline editor, and `theme-toggle.ps1`. Dark default (`#0d0d14`). No semantic token layer. |
| **Components** | Two+ competing button/card/modal implementations (`DSBtn` vs `Btn`, `DSModal` vs `Modal`). |
| **Responsiveness** | Desktop-first; layout assumes wide viewports. |
| **Mobile usability** | Capacitor shell only — no touch targets, no mobile nav, no responsive breakpoints. |

---

## 7. Mobile Audit
- `mobile/` is a **Capacitor wrapper** pointing `webDir` at `frontend/dist`. Native plugins (push, local-notifications, haptics, camera-adjacent, network, preferences) are **installed but the web UI is not responsive**, so the app renders the desktop layout inside a phone.
- No offline mode, no GPS tagging, no mobile camera/voice capture wired into punch-list flows (all explicitly requested for the field team).

---

## 8. Feature Gaps vs Smartsheet (condensed)
| Smartsheet capability | BuildForge today |
|---|---|
| Generic Sheets/grid w/ column types & formulas | ❌ missing |
| Multiple views (Grid/Gantt/Calendar/Kanban/Timeline/Card) on one dataset | 🟡 Gantt/Calendar partial; no unified view switcher |
| No-code Automations | ❌ missing |
| Forms | ❌ missing |
| Dashboards (widget library) | 🟡 charts exist, not composable widgets |
| Reports (cross-sheet) | 🟡 search/export partial |
| Workspaces & sharing/permissions | 🟡 project-scoped roles; no workspace tier |
| File proofing/version history | 🟡 attachments only |
| Mobile apps | 🟡 shell only |
| **Construction domain depth (RFIs, submittals, punch, cost…)** | ✅ **exceeds Smartsheet** |

---

## 9. Top 10 Risks, Ranked
1. **2.4 MB monolithic `App.jsx`** — blocks maintainability, testing, performance, responsiveness. *(rebuild)*
2. **Codegen/patch-script "build" (42 scripts)** — no real source-of-truth for UI. *(replace pipeline)*
3. **Schema drift, no migrations** — runtime DB ≠ `setup-db.js`. *(introduce migrations + reconcile)*
4. **Unauthenticated debug file-write endpoint (S1).** *(remove/secure now)*
5. **Open CORS + no rate limiting (S2/S3).** *(harden now)*
6. **No tests / no CI.** *(add safety net before refactor)*
7. **Hardcoded prod URLs everywhere.** *(env config)*
8. **Permissive-by-default permissions (S4).** *(flip to deny-by-default)*
9. **In-process cron + non-scalable socket.io.** *(extract workers / Redis adapter)*
10. **No responsive/mobile system.** *(design system + breakpoints)*

---

## 10. Recommended Direction (feeds Phase 2+)
1. **Freeze the backend's good parts**, add a migration tool (e.g. node-pg-migrate / Prisma) and reconcile the schema to a single source of truth.
2. **Patch the 5 high/medium security findings immediately** (small, isolated, high value).
3. **Rebuild the frontend incrementally** on a real architecture (component library + design tokens + routing + data layer), deleting the codegen scripts — *not* a blind from-scratch rewrite of the backend.
4. **Introduce the unified "Views" abstraction and Sheets engine** as the new platform spine, then migrate existing pages onto it.
5. **Make responsiveness a first-class constraint** from the first rebuilt screen, so mobile is native to the design rather than retrofitted.

See `docs/REBUILD-ROADMAP.md` for the phased, incremental plan and the recommended first increment.
