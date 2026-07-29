# Increment 13 — File management (Phase 13)

Consumes the existing documents backend (folders + **versioning**) with a new
Files UI in the rebuilt app.

## Frontend (`web/src/features/files/`)
- **FilesPage** — drag-and-drop or click **upload** (multi-file), grid of files
  with image thumbnails, size, and version badge. Shows only the latest version
  per name (grouped) with a version count.
- **FilePreview** drawer — inline image preview (or type/size/version metadata),
  **download**, **upload new version** (increments version on the backend), and
  **version history** with per-version download.
- Route `/files`; added to the Field nav group.

## Backend
Uses the existing `project-documents` route (list / create / `:id/version` /
get-with-versions / delete). Files are stored as data URLs for this increment
(same approach as punch photos).

## Verification
- `tsc --noEmit` clean; `vite build` ~115 kB gzip.

## Not yet done
- Object storage for large binaries (data URLs are fine for images/small docs but not big files), folder tree UI, in-browser PDF preview, and file comments.
