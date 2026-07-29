# BuildForge — Rebuilt Platform Overview

The rebuild lives in **`web/`** (new TypeScript + React + Vite app on a design
system), backed by the existing hardened Express/Postgres API in **`backend/`**.
The legacy 2.4 MB `frontend/App.jsx` is preserved untouched; the new app is
decoupled and grows module by module.

## Increment log (all committed & pushed)
| # | Phase | Delivered |
|---|---|---|
| 0 | Audit + Security/Perf | Full audit; secured debug endpoint, CORS allow-list, login rate-limit, JWT-secret enforcement, DB TLS, migrations + schema-drift reconciliation, CI, tests |
| 1 | Redesign foundation | Design tokens, component library, responsive AppShell (sidebar + mobile bottom nav), typed API client, auth/theme/project contexts |
| 2 | Punchlist | List/Board/Calendar/Map views, mobile photo + voice + GPS, status workflow (+ backend GPS/media columns) |
| — | Modules engine (parallel) | Config-driven registry porting RFIs/Submittals/Daily-Logs, bridging the rest to classic |
| 4 | Sheets | Smartsheet-style grid: 14 column types, hierarchy, inline edit, formulas, conditional formatting |
| 5 | Views | Interactive Gantt + Timeline + List, drag-reschedule, dependency lines |
| 6 | Automation | No-code trigger→condition→action engine (pure core + tests), live on status/task events |
| 7 | Forms | Public/internal form builder, submissions create records, fires form_submitted |
| 8 | Notifications | In-app inbox + topbar bell + unread polling |
| 9 | AI assistant | Chat panel + floating FAB + data-driven insight cards |
| 10 | Analytics | Completion, aging, bottlenecks, workload — dependency-free charts |
| 11 | Projects | Portfolio health scores + CPM critical path in the Gantt |
| 12 | Calendar | Month/Week/Agenda over tasks + punch items, drag-reschedule |
| 13 | Files | Upload, image preview, download, version history |
| 14 | Security/MFA | RFC 6238 TOTP two-factor (verified vs RFC vectors) + Security settings |
| 15 | QA | Full verification pass; bug fixes; this report |

## Status vs the 19-phase brief
Delivered or substantially built: Audit, Redesign foundation, Core module
architecture, Sheets, Views, Tasks/Projects (+critical path), Calendar,
Punchlist, Dashboards/Analytics, Automation, Forms, Files, Notifications,
Analytics, AI, Permissions/MFA, Performance (indexes/bundles), QA.

Still partial / future: Google-Outlook two-way sync, richer dashboard widget
library, real email/SMS, baseline/budget/risk registers in the new UI,
click-through E2E on real hardware. See `QA-REPORT.md`.
