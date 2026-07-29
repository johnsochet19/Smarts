-- 005_forms.sql
-- Forms module: public/internal forms and their submissions. A submission can
-- create a target record (punch item / task) and fire form_submitted automations.
-- Idempotent; the forms route also creates these at boot.

CREATE TABLE IF NOT EXISTS forms (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  token            VARCHAR(40) UNIQUE,
  enabled          BOOLEAN DEFAULT true,
  is_public        BOOLEAN DEFAULT true,
  target_resource  VARCHAR(30) DEFAULT 'none',
  fields           JSONB DEFAULT '[]'::jsonb,
  settings         JSONB DEFAULT '{}'::jsonb,
  created_by       INTEGER REFERENCES users(id),
  submission_count INTEGER DEFAULT 0,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id                  SERIAL PRIMARY KEY,
  form_id             INTEGER REFERENCES forms(id) ON DELETE CASCADE,
  project_id          INTEGER,
  data                JSONB DEFAULT '{}'::jsonb,
  created_record_type VARCHAR(30),
  created_record_id   INTEGER,
  submitted_by        INTEGER REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forms_project  ON forms(project_id);
CREATE INDEX IF NOT EXISTS idx_form_subs_form ON form_submissions(form_id);
