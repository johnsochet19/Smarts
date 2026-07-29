# Increment 8 — Notifications hub (Phase 14)

A real in-app notification inbox surfacing the events already written to the
`notifications` table by punch items, tasks, **automations**, and **forms**.

## Backend
No changes needed — the existing `routes/notifications.js` already provides
list (with filters), `unread-count`, `summary`, mark-read, mark-all-read,
delete, and clear-read. This increment consumes it.

## Frontend (`web/src/features/notifications/`)
- **NotificationsProvider** (context) — holds the unread count, polls every 45s, refreshes on tab focus, and exposes optimistic `markRead` / `markAllRead`.
- **NotificationBell** — topbar bell with an **unread badge** and a dropdown of recent items; click marks read and navigates (with a legacy→new route map so old links resolve); "Mark all read" and "See all".
- **NotificationsPage** (`/notifications`) — full inbox with All/Unread filter, per-item delete, mark-all-read, and clear-read.
- Type-aware icon + color per notification (`notificationVisual`), compact relative timestamps (`timeAgo`).
- Wired into the shared `AppShell` topbar and the Overview nav group; provider mounts inside the auth guard so it only runs when signed in.

## Result
The automation `notify` action and form/assignment events now have a visible
home — the loop from *trigger → notify → inbox* is complete.

## Verification
- Web `tsc --noEmit` clean; `vite build` succeeds (~107 kB gzip).

## Not yet done (future)
- Real-time push over the existing socket.io channel (currently 45s poll + focus refresh), email/SMS delivery, per-user notification preferences, and grouping/threading.
