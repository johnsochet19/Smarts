# Phase 19 — QA & Test Report

Final verification pass across the rebuilt platform.

## Automated checks (all passing)
| Check | Result |
|---|---|
| Backend syntax (`node --check` on all `src/**/*.js` + `migrate.js`) | ✅ all OK |
| Backend unit tests (`npm test`) | ✅ **18/18** (security middleware 6, automation engine 6, TOTP 6 incl. RFC 6238 vectors) |
| Web typecheck (`tsc --noEmit`) | ✅ clean |
| Web production build (`vite build`) | ✅ 122 modules, **116 kB gzip** JS |
| Migrations present & ordered | ✅ 000, 002–006 (see note) |
| Routes mounted | 51 route files, 76 `app.use` mounts |
| New-app routes/pages | 16 routes, 16 feature modules |

## Bugs found & fixed during the rebuild
1. **Unauthenticated debug endpoint writing JWTs to disk** — secured (auth+admin, stop persisting tokens). *(Increment 0)*
2. **Open CORS + no login rate-limit** — allow-list + limiter. *(Increment 0)*
3. **Schema drift** (tasks/changelog defined in ≥3 divergent places) — reconciled via a single migration + runner. *(Increment 0)*
4. **Missing `JWT_SECRET` not enforced** — server now refuses to boot in prod without it. *(Increment 0)*
5. **QA-pass find:** migration `002` ALTERed `punch_items` without creating it, so `npm run migrate` on a fresh DB failed before first boot — made `002` self-sufficient (CREATE TABLE IF NOT EXISTS first). *(Increment 15/QA)*

## Known limitations (documented, not defects)
- **Cannot run the app against a live DB/browser in this environment**, so verification is static (typecheck, build, unit tests, syntax) rather than click-through E2E. Real-device QA of camera/voice/GPS and the AI chat (needs `ANTHROPIC_API_KEY`) is the recommended next step.
- **Media stored as data URLs** (punch photos/voice, files) — fine for images/small docs; large binaries need object storage.
- **Deferred integrations**: Google/Outlook two-way calendar sync, real email/SMS delivery, WebAuthn/passkeys, backup codes.
- **Migration numbering** skips `001` (cosmetic gap; the runner orders lexically so it has no effect).
- Two behavior-changing items remain **config-gated pending sign-off**: deny-by-default permissions (`DEFAULT_TOOL_PERMISSION=none`) and deleting the 42 legacy codegen scripts.

## How to run end-to-end
```bash
# Backend
cd backend && npm install && npm run migrate   # against DATABASE_URL
JWT_SECRET=... ANTHROPIC_API_KEY=... ALLOWED_ORIGINS=http://localhost:5173 npm start
# New frontend
cd web && npm install && cp .env.example .env   # VITE_API_BASE -> backend
npm run dev
```
