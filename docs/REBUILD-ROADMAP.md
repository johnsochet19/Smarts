# BuildForge → Enterprise Platform — Rebuild Roadmap

This roadmap turns the Phase 1 audit (`docs/PHASE-1-AUDIT.md`) into a sequenced plan. It is written to be **honest about scope** and to deliver **working software at every step** — no placeholder shells.

## Reality check on scope
The original brief (19 phases: Sheets engine with formulas, 6 view types, Gantt/critical-path, two-way Google **and** Outlook sync, no-code automation, forms builder, offline GPS mobile, AI assistant, MFA, audit logs, "scales to thousands") is **multi-month, multi-engineer work**. It cannot be delivered complete-and-working in a single pass. The plan below is therefore **incremental**: each increment is independently shippable and verifiable, and we preserve the working backend rather than rewriting blindly.

## Guiding principles
- **Keep the backend; harden it.** It is the strong half. Don't rewrite what works.
- **Rebuild the frontend, delete the codegen scripts.** The 2.4 MB `App.jsx` and 42 patch scripts are the root debt.
- **Responsive-first.** Every new screen ships mobile + desktop from day one.
- **Safety net before surgery.** Migrations + a thin test/CI layer before large refactors.
- **One source of truth** for schema, config (env), and design tokens.

---

## Increment 0 — Stabilize & secure (small, do first)
*Goal: stop the bleeding without changing features.*
- Add migration tooling; reconcile the divergent `tasks`/`changelog` schemas to one source of truth.
- Fix the 5 high/med security findings: remove/secure `/api/debug-report` (S1), lock CORS to allow-list (S2), rate-limit `/auth/login` (S3), flip permissions to deny-by-default (S4), require `JWT_SECRET` at boot + enable DB SSL verify (S5/S6).
- Move hardcoded prod URLs to env config (`VITE_API_BASE`).
- Add helmet, body-size limits, a central error handler.
- Add CI (lint + build + smoke) and a handful of backend route tests.
- Remove committed junk (`App.jsx.backup`, `app_b64.txt`, `h`, `test.jsx`, `*.ps1`, `fix*.js`).

## Increment 1 — Frontend foundation & design system
*Goal: a real architecture the rest is built on.*
- New app shell: Vite + React + **TypeScript**, file-per-component, lazy-loaded routes, React Query (or equivalent) data layer, single Axios client reading `VITE_API_BASE`.
- **Design system**: spacing/type/color **tokens**, one Button/Card/Input/Modal/Table/Badge set, light/dark themes, responsive breakpoints, keyboard-shortcut layer.
- Port **Login + Dashboard** first as the proof-of-architecture (responsive, fast, testable).

## Increment 2 — Punchlist (flagship vertical, end-to-end)
*Why first feature: it's the core business and the highest-value mobile workflow.*
- Full punch-item CRUD on the existing `punch-items` API, with **List / Board / Calendar / Map** views.
- **Mobile field workflow**: camera photo upload, voice notes, GPS tagging, offline queue.
- Status workflow (Open → In progress → Ready for review → Closed), assignees, priority, categories, comments, attachments.

## Increment 3 — Unified Views engine
- A reusable **view abstraction** (Grid/List/Kanban/Calendar/Gantt/Timeline) over any dataset, with instant switching and shared filter/sort/group state. Migrate Tasks + Schedule onto it.

## Increment 4 — Sheets module (Smartsheet spine)
- Spreadsheet grid: custom columns, the full column-type set, inline edit + validation, row hierarchy (parent/child, expand/collapse), freeze/lock/hide columns, conditional formatting, formulas, cell comments/mentions/attachments.

## Increment 5 — Projects, Tasks, Calendar depth
- Milestones, dependencies, critical path, baseline, budget, risk, health score, resource planning.
- Calendar: day/week/month/agenda/timeline, drag-drop, recurring, conflict detection, color coding; then **Google** two-way sync, then **Outlook**.

## Increment 6 — Platform services
- **Automation engine** (triggers → conditions → actions, multi-step).
- **Forms builder** (public/internal, conditional logic, file uploads, mobile).
- **Dashboards** (composable widget library + dashboard types).
- **Notifications** (in-app/email/push/SMS) unified; **Files** (version history + preview); **Analytics/Reports**; **AI assistant** consolidated to one implementation.

## Increment 7 — Enterprise hardening
- Workspaces/multi-tenancy, full RBAC (Owner/Admin/Manager/Member/Viewer), MFA, audit-log UI, encryption-at-rest review.
- Performance: code-splitting, list virtualization, pagination, caching, out-of-process cron, socket.io Redis adapter.
- QA pass: e2e tests across desktop + mobile, edge cases, bug-fix report.

---

## Recommended first action
**Increment 0 + the Increment 1 foundation**, landing as a working, deployable baseline (secure backend + new responsive shell with Login/Dashboard), then **Increment 2 (Punchlist)** as the first full vertical. This sequence gives you something real and usable fastest while paying down the debt that blocks everything else.

> Decision needed from you: confirm the target repo for the rebuild (the new platform), and whether to start with **Increment 0 (stabilize/secure)** or jump straight to the **Punchlist vertical**. The audit recommends Increment 0 first because the security fixes are small and the migration safety-net protects every later step.
