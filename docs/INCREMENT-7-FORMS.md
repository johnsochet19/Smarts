# Increment 7 — Forms (Phase 12)

Smart forms — public or internal — whose submissions store data, optionally
**create records** (punch item / task), and **fire the `form_submitted`
automation trigger** (now live end-to-end with Increment 6).

## Backend (`src/routes/forms.js`, migration `005`)
- `forms` (token, enabled, is_public, target_resource, fields JSONB, submission_count) + `form_submissions` (data JSONB, created_record_type/id).
- **Authenticated management**: list / create / update / delete / `GET /:id/submissions`. Mounted at `/api/projects/:id/forms` and `/api/forms`.
- **Public (no auth)**: `GET /forms/public/:token` (serves a safe projection) and `POST /forms/public/:token/submit` — server-side **required-field validation**, stores the submission, and if `target_resource` is `punch_item`/`task` **creates that record** (punch items get an auto punch number), then fires the `form_submitted` automation event.

## Frontend (`web/src/features/forms/`)
- **FormsPage** — list, enable/disable, **copy public link**, responses drawer (tabular view of submissions + which record each created), edit/delete.
- **FormBuilder** — name, description, "on submit" target, and a field editor (label→auto key, 7 field types, required/hidden, select options, reorder) with a **live preview** using the shared renderer.
- **FormRenderer** — schema-driven render with required validation and **conditional visibility** (`visibleIf`); shared by the builder preview and the public page.
- **PublicFormPage** — standalone, **unauthenticated** route `/f/:token` (registered outside the auth guard) with a success state.
- Nav: **Forms** added to the Automate group; routes `/forms` (internal) and `/f/:token` (public).

## Use cases delivered
Punchlist submission, issue reporting, service request — a public link that
non-users can fill out to create a punch item or task automatically.

## Verification
- Backend syntax-checked; suite still **12/12**.
- Frontend `tsc --noEmit` clean; `vite build` succeeds (~105 kB gzip).

## Not yet done (future)
- File-upload fields (needs object storage), multi-page forms, richer conditional logic (multiple rules / AND-OR), spam/captcha protection on public endpoints, per-form theming, and edit-existing-record forms.
