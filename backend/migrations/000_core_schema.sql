-- 000_core_schema.sql
-- Single source of truth for the core schema, reconciling the drift the audit
-- found (schema previously spread across setup-db.js, index.js migrate(), and
-- ALTER statements inside tasks.js / projects.js / migrate-projects.js).
-- Every statement is idempotent, so this is safe to run against the live DB.

-- ---- users ----
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  DEFAULT 'viewer',
  created_at    TIMESTAMP    DEFAULT NOW()
);

-- ---- projects ----
CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         DEFAULT '',
  status      VARCHAR(50)  DEFAULT 'active',
  start_date  DATE,
  end_date    DATE,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP    DEFAULT NOW(),
  updated_at  TIMESTAMP    DEFAULT NOW()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS address VARCHAR(500);

-- ---- tasks (reconciled superset of every column the code references) ----
CREATE TABLE IF NOT EXISTS tasks (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255),
  start_date      DATE,
  finish_date     DATE,
  duration        INTEGER,
  percent_complete INTEGER DEFAULT 0,
  status          VARCHAR(50) DEFAULT 'not_started',
  phase           VARCHAR(255),
  assigned_user_id INTEGER REFERENCES users(id),
  color           VARCHAR(50),
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title          VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority       VARCHAR(20) DEFAULT 'normal';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by     INTEGER REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to    INTEGER REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date       DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_date TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS private        BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order     INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id     INTEGER REFERENCES projects(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_days  INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS trade          VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMP DEFAULT NOW();

-- ---- dependencies ----
CREATE TABLE IF NOT EXISTS dependencies (
  id            SERIAL PRIMARY KEY,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE
);

-- ---- changelog (reconciled; index.js and setup-db.js disagreed on columns) ----
CREATE TABLE IF NOT EXISTS changelog (
  id            SERIAL PRIMARY KEY,
  table_name    VARCHAR(100),
  record_id     INTEGER,
  operation     VARCHAR(50),
  field_changed VARCHAR(100),
  old_value     TEXT,
  new_value     TEXT,
  changed_by    INTEGER REFERENCES users(id),
  changed_at    TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ---- per-tool permissions (referenced by middleware/auth.js) ----
CREATE TABLE IF NOT EXISTS user_tool_permissions (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tool             VARCHAR(100) NOT NULL,
  permission_level VARCHAR(20)  DEFAULT 'standard',
  granular_perms   JSONB        DEFAULT '{}'::jsonb,
  UNIQUE (project_id, user_id, tool)
);

-- ---- performance indexes (audit §3.5: none existed beyond PK/FK) ----
CREATE INDEX IF NOT EXISTS idx_tasks_project_id     ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to    ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date       ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_dependencies_task    ON dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_dep     ON dependencies(depends_on_id);
CREATE INDEX IF NOT EXISTS idx_changelog_record     ON changelog(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_utp_lookup           ON user_tool_permissions(project_id, user_id, tool);
