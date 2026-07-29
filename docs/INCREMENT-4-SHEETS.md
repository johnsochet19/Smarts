# Increment 4 — Sheets module (the Smartsheet spine)

A generic Smartsheet-style grid engine, built end-to-end (backend + UI) and
wired into the rebuilt `web/` app.

## Backend (`backend/src/routes/sheets.js`, migration `003_sheets.sql`)
Data model — three tables, JSONB cell map on rows:
- `sheets` (project-scoped), `sheet_columns` (typed, ordered, options JSONB, hidden/locked/primary), `sheet_rows` (`parent_id` hierarchy, fractional `position`, `cells` JSONB keyed by column id, `locked`).

Endpoints (mounted at `/api/projects/:id/sheets` and `/api/sheets`):
- Sheets: list, create (seeds default columns + rows), get full sheet, rename, delete.
- Columns: add, update (name/type/options/width/position/hidden/locked), delete.
- Rows: add, update (merge cells / reparent / move / lock), duplicate, delete (subtree cascade).

## Frontend (`web/src/features/sheets/`)
- **`SheetsPage`** — sheet gallery + create/open/delete.
- **`SheetGrid`** — the grid: sticky header + row gutter, horizontal scroll, frozen first column.
  - **Column types**: text, number, currency, percent, dropdown, status, priority, date, time, checkbox, contact, **formula**, **auto-number**.
  - **Columns**: inline rename (double-click), drag-resize, change type, hide, lock, delete, add.
  - **Rows**: inline cell editing per type, add / add-child / duplicate / delete / lock, **hierarchy** (indent/outdent, expand/collapse).
  - **Conditional formatting** by type: colored status/priority chips, percent progress bars, contact avatars.
  - **Formulas** (`web/src/features/sheets/formula.ts`): `=[Col]*[Col]`, `SUM/AVG/MIN/MAX([A],[B])`; safe evaluator that rejects anything but numbers/operators after column substitution (no identifier ever reaches `Function`).
  - Optimistic edits with server sync + toasts.

## Verification
- `tsc --noEmit` clean; `vite build` succeeds (~91 kB gzip).
- Backend routes syntax-checked; existing tests still 6/6.
- Run: `cd backend && npm run migrate` (creates the sheet tables), then use the **Sheets** tab in `web/`.

## Not yet done (future increments)
- Cross-sheet Reports, cell-level comments/mentions/attachments, drag-reorder of columns/rows (menu indent works today), multi-select cell range + copy/paste, saved views/filters per sheet, real object-storage for attachments.
