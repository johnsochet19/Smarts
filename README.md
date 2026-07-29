# BuildForge — Enterprise Project & Construction Operations Platform

Smartsheet-class project management built for construction operations: punchlists,
scheduling, sheets, dashboards, automation, forms, and AI-assisted insight —
responsive from desktop down to phones.

This repository is the **consolidated, clean platform**: the hardened backend and the
rebuilt TypeScript/React frontend, without the legacy monolith or code-generation
scripts that previously lived alongside them in `johnsochet19/scheduler`.

## Layout

| Path | What it is |
|---|---|
| `backend/` | Node/Express + PostgreSQL API — ~50 domain modules (projects, tasks, punch items, RFIs, submittals, daily logs, inspections, cost management, timesheets, meetings, permits, photos, documents, notifications, audit log, search, sheets, automations, forms, MFA, AI) |
| `backend/migrations/` | Forward-only SQL migrations (single source of truth for schema) |
| `backend/test/` | Unit tests (security, automation engine, TOTP) + live integration smoke |
| `web/` | Rebuilt frontend — Vite + React + TypeScript on a token-based design system; responsive with mobile bottom navigation |
| `docs/` | Full audit, increment logs, QA reports |
| `website/` | Unrelated static site (JR Fine Wood) preserved from this repo's earlier history |
| `.github/workflows/ci.yml` | CI: unit tests, syntax checks, typecheck, build, **live integration against Postgres 16** |

## Quick start (local)

```bash
# 1. Database
createdb buildforge

# 2. Backend
cd backend && npm install
DATABASE_URL=postgres://localhost/buildforge node migrate.js
DATABASE_URL=postgres://localhost/buildforge PGSSL=disable \
  JWT_SECRET=change-me ALLOWED_ORIGINS=http://localhost:5173 PORT=4000 npm start

# 3. First admin account
DATABASE_URL=postgres://localhost/buildforge ADMIN_EMAIL=you@example.com \
  ADMIN_PASSWORD=strong-password node createAdmin.js

# 4. Frontend
cd ../web && npm install
cp .env.example .env   # VITE_API_BASE defaults to http://localhost:4000/api
npm run dev            # http://localhost:5173
```

## Verification

- `cd backend && npm test` — unit tests
- `node backend/test/integration/smoke.js` — 40+ live API calls across every module
  (requires a running server; CI does this automatically against Postgres 16)
- `cd web && npm run typecheck && npm run build`

See `docs/QA-REPORT-LIVE.md` for the latest full end-to-end verification (real
database, real browser, desktop + mobile) and the bugs it found and fixed.

## Deployment

- Backend: Railway/Render/Fly-style Node host (`railway.json`, `backend/nixpacks.toml`).
  Required env: `DATABASE_URL`, `JWT_SECRET` (boot-enforced in production),
  `ALLOWED_ORIGINS`; optional `ANTHROPIC_API_KEY` (AI assistant), `PGSSL=verify`.
- Frontend: any static host (Vercel config in `web/vercel.json`); set `VITE_API_BASE`.
