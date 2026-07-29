# Increment 11 — Projects portfolio + Critical Path (Phase 7)

## Critical Path (Gantt)
- **`cpm.ts`** — full CPM: forward/backward pass over the dependency DAG with
  durations from date-span (or `duration_days`), zero-slack = critical. Cycles
  are detected (Kahn topo) and handled safely (no critical set rather than a crash).
- Gantt gets a **"Critical path" toggle**; critical bars/milestones get a red ring,
  and the toolbar shows the critical-task count.

## Projects portfolio (`web/src/features/projects/`)
- **ProjectsPage** (`/projects`) — every project with a computed **health score**
  (0–100 ring: 50% task completion + 50% on-schedule), portfolio KPIs (avg health,
  at-risk count, active), completion %, and overdue badges. Click sets the active project.
- Health color-coded (green ≥80, amber ≥55, red below).

## Verification
- `tsc --noEmit` clean; `vite build` ~111 kB gzip.

## Not yet done
- Baseline vs actual variance, resource leveling, budget/risk registers surfaced per project (budget API exists in backend but isn't yet in the new UI).
