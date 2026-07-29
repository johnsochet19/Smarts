# Increment 10 — Analytics (Phase 15)

An analytics dashboard computed from live punch + task data, with
dependency-free SVG/CSS charts (no charting library added).

## Frontend (`web/src/features/analytics/`)
- **KPIs**: punchlist completion %, overdue items, task completion %, tasks behind.
- **Charts** (`charts.tsx`): a donut for punch-items-by-status and horizontal bars for aging + workload — pure SVG/CSS.
- **Insights**:
  - Punch items by status (donut).
  - Open punch-item **aging** buckets (0–7 / 8–14 / 15–30 / 30+ days).
  - **Bottlenecks by trade** (open + overdue table).
  - **Team workload** (open items per assignee).
- Route `/analytics`; added to Overview nav.

## Verification
- `tsc --noEmit` clean; `vite build` ~110 kB gzip.

## Not yet done
- Historical trend lines (needs snapshotting over time), cross-project rollups, exportable/scheduled reports.
