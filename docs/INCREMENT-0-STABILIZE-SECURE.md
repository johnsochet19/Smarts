# Increment 0 — Stabilize & Secure

Additive, low-risk hardening of the existing backend. **No features removed, no
behavior broken by default.** Every change is either a security fix, a safety
net, or made configurable to preserve current production behavior.

## What changed

### Security
| Audit ref | Fix |
|---|---|
| S1 — unauthenticated debug file-write | `POST /api/debug-report` now requires `authenticate` + admin/superadmin. It **no longer writes the caller's JWT to disk** — it records the reporting user id/email instead. (`src/index.js`) |
| S2 — open CORS | CORS + socket.io now driven by `ALLOWED_ORIGINS` allow-list (`src/middleware/security.js`). Unset = permissive + a logged warning, so dev is unaffected. |
| S3 — login brute force | Dependency-free in-memory rate limiter on `/api/auth/login` (10 / 15 min / IP). (`src/middleware/security.js`, wired in `src/index.js`) |
| S6 — missing JWT secret | Server now **refuses to boot in production without `JWT_SECRET`**; dev gets a clearly-logged insecure fallback. (`src/index.js`) |
| S5 — DB TLS | `src/db/index.js` TLS is now explicit/configurable via `PGSSL` (`disable`/`verify`/default). |
| S9 — headers/limits | Security headers middleware + JSON body limit (`JSON_BODY_LIMIT`, default 10mb) + central error handler that hides stack traces in prod. |

### Stability
- **Migration framework** (`migrate.js` + `migrations/000_core_schema.sql`, `npm run migrate`). Idempotent, forward-only, tracked in `schema_migrations`. The first migration **reconciles the schema drift** the audit found — consolidating the `tasks`/`changelog`/`projects` columns that were previously scattered across `setup-db.js`, `index.js`, and ALTER statements inside `tasks.js`/`projects.js` — and adds the missing performance indexes.
- **Tests + CI**: `npm test` (Node built-in runner, 6 passing tests for the security middleware) and `.github/workflows/ci.yml` (backend syntax-check + tests, frontend lint + build).
- **`backend/.env.example`** documents every config var.

## Deferred — needs your sign-off (would change current behavior)
These are recommended but **intentionally not enabled by default**, because flipping
them blindly could disrupt your live users:

1. **Deny-by-default permissions (S4).** The permissive `standard` fallback is now
   controlled by `DEFAULT_TOOL_PERMISSION`. To go secure, populate per-user
   permission rows, then set `DEFAULT_TOOL_PERMISSION=none`.
2. **Deleting the 42 codegen/patch scripts** (`*.ps1`, `fix*.js`, `update*.js`) and
   committed junk (`App.jsx.backup`, `app_b64.txt`, `h`, `test.jsx`). These are the
   root of the frontend debt but I left them so nothing you rely on disappears
   without confirmation. They should be removed as part of the frontend rebuild.

## How to verify
```bash
cd backend
npm install
npm test                 # 6 passing
npm run migrate          # against a DATABASE_URL — idempotent, safe to re-run
# Boot check:
JWT_SECRET=test ALLOWED_ORIGINS=http://localhost:5173 npm start
```
Set in production: `JWT_SECRET`, `ALLOWED_ORIGINS`, and (optionally) `PGSSL`,
`DEFAULT_TOOL_PERMISSION`, `JSON_BODY_LIMIT`.
