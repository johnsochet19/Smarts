# Increment 5 — Views: Schedule (Gantt / Timeline / List)

Fills the "Views" phase for scheduling by adding a real, interactive Gantt built
on the existing tasks + dependencies API — no backend changes required.

## Frontend (`web/src/features/schedule/`)
- **`SchedulePage`** — view switcher (**Gantt / Timeline / List**), zoom controls, "New task", and a task drawer for editing start/finish/% complete.
- **`GanttChart`** — the engine:
  - Two-pane layout: sticky task list (hierarchical, parent/child indent) + horizontally-scrollable timeline with synced vertical scroll.
  - Month + day axis, weekend shading, **today line**.
  - Task **bars** colored by status (or task color) with **% complete fill**; zero-duration tasks render as **milestone diamonds**.
  - **Drag to reschedule** (move) and **drag edges to resize** duration — snaps to days, commits `start_date`/`finish_date` via the tasks API with optimistic UI.
  - **Dependency connectors** (finish-to-start) drawn as elbowed SVG paths with arrowheads.
  - Timeline view = the same engine at a compact (month-overview) zoom; List view = a flat status/date table.
- Wiring: `schedule` module in the registry is marked **ported**; `App.tsx` routes `/schedule` to this bespoke page ahead of the generic module map (and excludes `schedule` from it) so no duplicate route.

## API used (unchanged backend)
- `GET /projects/:id/tasks`, `PUT /projects/:id/tasks/:taskId` (dates, % complete)
- `GET /dependencies` (filtered to loaded tasks), `POST/DELETE /dependencies`

## Verification
- `tsc --noEmit` clean; `vite build` succeeds (~99 kB gzip).

## Not yet done (future)
- Critical-path computation & highlighting, baseline overlay, creating dependencies by dragging between bars, resource/assignee swimlanes, working-calendar (skip weekends) scheduling, and applying the same view switcher to non-task modules.
