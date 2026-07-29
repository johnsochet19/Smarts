-- 003_sheets.sql
-- Sheets module: generic Smartsheet-style grid (sheets, typed columns, rows
-- with hierarchy + JSONB cell map). Idempotent; the sheets route also creates
-- these at boot.

CREATE TABLE IF NOT EXISTS sheets (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sheet_columns (
  id         SERIAL PRIMARY KEY,
  sheet_id   INTEGER REFERENCES sheets(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  type       VARCHAR(30) NOT NULL DEFAULT 'text',
  position   DOUBLE PRECISION DEFAULT 0,
  width      INTEGER DEFAULT 180,
  options    JSONB DEFAULT '{}'::jsonb,
  is_primary BOOLEAN DEFAULT false,
  hidden     BOOLEAN DEFAULT false,
  locked     BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sheet_rows (
  id         SERIAL PRIMARY KEY,
  sheet_id   INTEGER REFERENCES sheets(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES sheet_rows(id) ON DELETE CASCADE,
  position   DOUBLE PRECISION DEFAULT 0,
  cells      JSONB DEFAULT '{}'::jsonb,
  locked     BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sheet_columns_sheet ON sheet_columns(sheet_id);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet    ON sheet_rows(sheet_id);
CREATE INDEX IF NOT EXISTS idx_sheet_rows_parent   ON sheet_rows(parent_id);
