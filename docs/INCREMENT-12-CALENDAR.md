# Increment 12 — Calendar (Phase 8)

A unified project calendar over tasks + punch items, with month / week / agenda
views and drag-to-reschedule.

## Frontend (`web/src/features/calendar/`)
- **CalendarPage** aggregates events from tasks (start/finish/due) and punch
  items (due date), color-coded by status.
- **Month view** — full grid, today marker, up to 4 events per day, and
  **drag an event to another day to reschedule** (updates the task's start/finish
  keeping duration, or the punch item's due date, optimistically via the APIs).
- **Week view** — 7 day columns listing that day's events.
- **Agenda view** — upcoming events grouped by day.
- Click an event to jump to its module (Punchlist / Schedule).

## Google / Outlook sync — status
Not implemented in this increment. Two-way sync requires OAuth app credentials
and consent flow; the backend has a Google route stub but wiring real,
verified two-way sync needs provider setup. Documented as the next calendar step.

## Verification
- `tsc --noEmit` clean; `vite build` ~113 kB gzip.

## Not yet done
- Google/Outlook two-way sync, timed (hourly) events + day view, recurring events, multi-calendar overlays and conflict detection.
