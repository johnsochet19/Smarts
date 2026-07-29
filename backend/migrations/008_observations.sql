-- Observations had no table definition anywhere (routes/observations.js was
-- written against a hand-mutated production DB), so every observations
-- endpoint 500'd on a fresh install. Columns match the route's queries.
CREATE TABLE IF NOT EXISTS observations (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  type        VARCHAR(50)  DEFAULT 'quality',
  priority    VARCHAR(20)  DEFAULT 'normal',
  status      VARCHAR(30)  DEFAULT 'open',
  location    VARCHAR(255),
  due_date    DATE,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project_id);
CREATE INDEX IF NOT EXISTS idx_observations_status  ON observations(status);
