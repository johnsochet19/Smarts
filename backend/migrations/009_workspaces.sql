-- Workspaces: the organizational layer above projects (Smartsheet-style).
-- Projects may belong to a workspace; ungrouped projects (workspace_id NULL)
-- remain valid so existing data needs no backfill.
CREATE TABLE IF NOT EXISTS workspaces (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  color       VARCHAR(20) DEFAULT '#3b82f6',
  position    DOUBLE PRECISION DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
