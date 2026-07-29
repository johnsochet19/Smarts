# Increment 6 — Automation engine (Phase 11)

A no-code trigger → conditions → actions engine, end-to-end.

## Backend
- **Pure core** (`src/automation/engine.js`): `matchesTrigger`, `evaluateConditions` (AND semantics; ops: equals, not_equals, contains, greater_than, less_than, is_empty, is_not_empty), `planActions` with `{{field}}` interpolation, and `decide`. No I/O → fully unit-tested.
- **Runner** (`src/automation/runner.js`): executes actions with real side effects — `notify` (in-app), `assign`, `update_field` (column-whitelisted per resource to prevent injection), `create_task`, `send_email` (stub until SMTP is configured). `runAutomationsForEvent()` loads enabled rules, decides, runs, and logs — wrapped so it **never breaks core flows**.
- **Routes** (`src/routes/automations.js`, migration `004`): CRUD, `GET /:id/runs` (run log), `POST /:id/test` (dry-run, no side effects), `GET /meta`. Mounted at `/api/projects/:id/automations` and `/api/automations`.
- **Live wiring**: `status_changed` fires from the punch-item status endpoint; `task_created` fires from task creation. Both non-blocking. Other trigger types (`task_updated`, `punch_created`, `date_reached`, `form_submitted`) are defined and selectable; the UI labels which are live vs not-yet-wired.
- **Tests**: `test/automation.test.js` — 6 tests for the pure core. Backend suite now **12/12**.

## Frontend (`web/src/features/automations/`)
- **AutomationsPage** — list with enable/disable toggle switch, run counts, delete, and a visual when→if→then flow summary.
- **AutomationBuilder** — a 3-step builder (When: trigger + resource · If: condition rows with field/operator/value · Then: action rows with per-type config), `{{field}}` token hint, and a "live / not wired yet" badge on triggers so expectations are honest.
- Nav: new **Automate** group; routed at `/automations`.

## Verification
- Backend: syntax-checked, 12/12 tests pass.
- Frontend: `tsc --noEmit` clean; `vite build` succeeds (~102 kB gzip).

## Not yet done (future)
- Wiring the remaining triggers (`task_updated`, `date_reached` via cron, `form_submitted` once Forms ship), OR/grouped condition logic, multi-branch (if/else) flows, real email/SMS delivery, and an execution-history detail view.
