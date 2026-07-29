# Increment 9 — AI assistant (Phase 16)

Wires the existing `/api/ai/chat` (Anthropic-backed) into the new app as a
first-class assistant, plus deterministic data-driven insights.

## Frontend (`web/src/features/ai/`)
- **AIChat** — conversation UI (message history sent to `/ai/chat` with the active `project_id`), suggested prompts ("Which punch items are overdue?", "Where are the bottlenecks?", …), typing indicator, and a graceful message when `ANTHROPIC_API_KEY` isn't configured.
- **AIAssistant** — a global floating action button + slide-over drawer, available on **every** authenticated page.
- **AIPage** (`/assistant`) — full-page chat plus **deterministic insight cards** (overdue punch items, tasks behind schedule, open punch items, unscheduled tasks) computed client-side from real data, so it's useful even before the API key is set.
- Wired into the AppShell (FAB) and Overview nav.

## Backend
Uses the existing `/api/ai/chat` route (no change). Answer quality depends on
`ANTHROPIC_API_KEY` being set on the backend.

## Verification
- Web `tsc --noEmit` clean; `vite build` succeeds (~108 kB gzip).

## Not yet done
- Streaming responses, tool-use so the model can query live data itself (today context is pre-summarized server-side), and per-answer source citations.
