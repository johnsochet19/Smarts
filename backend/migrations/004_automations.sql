-- 004_automations.sql
-- No-code automation engine: rules (trigger + conditions + actions) per project,
-- plus a run log. Idempotent; the automations route also creates these at boot.

CREATE TABLE IF NOT EXISTS automations (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  enabled    BOOLEAN DEFAULT true,
  trigger    JSONB DEFAULT '{}'::jsonb,
  conditions JSONB DEFAULT '[]'::jsonb,
  actions    JSONB DEFAULT '[]'::jsonb,
  created_by INTEGER REFERENCES users(id),
  run_count  INTEGER DEFAULT 0,
  last_run   TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id            SERIAL PRIMARY KEY,
  automation_id INTEGER REFERENCES automations(id) ON DELETE CASCADE,
  event_type    VARCHAR(50),
  status        VARCHAR(20),
  detail        TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_project        ON automations(project_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id);
