# BuildForge Web — rebuilt frontend

The new enterprise platform frontend (Increments 1 + 2 of the rebuild roadmap).
Built clean in TypeScript + React + Vite, **fully decoupled** from the legacy
2.4 MB `frontend/src/App.jsx` monolith (which is preserved, untouched).

## What's here

**Increment 1 — Foundation & design system**
- Design tokens (`src/styles/tokens.css`): spacing, type, color scales; light + dark themes.
- Component library (`src/components/ui/`): Button, Badge, Card, Input/Select/Textarea, Avatar, Spinner, EmptyState, Modal, Drawer, SegmentedControl, Toast, icon set — all dependency-free.
- Responsive app shell (`src/components/layout/`): desktop sidebar, mobile drawer + bottom nav, topbar, theme toggle, project picker.
- Typed API client (`src/lib/api.ts`) reading `VITE_API_BASE` — no hardcoded URLs.
- Auth, theme, and project contexts; `useMediaQuery`/responsive hooks.

**Increment 2 — Punchlist vertical (end-to-end on the existing `punch-items` API)**
- Four instant-switch views: **List, Board (drag-and-drop status), Calendar (month), Map (GPS plot)**.
- Create modal, detail drawer with the backend-validated status workflow (draft → open → in_progress → ready_for_review → closed).
- **Field-team features**: camera photo upload, **voice notes** (MediaRecorder), **GPS tagging** (Geolocation) — persisted via the extended backend (`gps_lat`/`gps_lng`, `media_type`).
- Filters, search, KPI strip, optimistic status moves, toasts.
- Data-driven Dashboard (KPIs, status breakdown, due-soon, recent activity).

## Run

```bash
npm install
cp .env.example .env        # set VITE_API_BASE to your backend, e.g. http://localhost:4000/api
npm run dev                 # http://localhost:5173
npm run typecheck           # tsc --noEmit (clean)
npm run build               # production bundle (~86 kB gzip)
```

The backend must have the Increment 0 + punch field-feature changes applied
(`cd ../backend && npm run migrate`).

## Notes
- Photos/voice are stored as data URLs via the existing `punch_item_photos` table
  for this increment; a future increment should move binary media to object storage.
- Mobile-first: every screen is responsive; the bottom nav, mobile drawer, and
  full-width modals/drawers kick in under 768px.
