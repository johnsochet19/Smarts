-- 002_punch_field_features.sql
-- Field-team punchlist features: GPS tagging on items, and a media_type
-- discriminator on attachments so voice notes and photos share one table.
-- Idempotent AND self-sufficient (creates the base tables if a fresh DB runs
-- migrations before the app's boot-time auto-migration has run).

CREATE TABLE IF NOT EXISTS punch_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  punch_number INTEGER,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) DEFAULT 'general',
  status VARCHAR(30) DEFAULT 'open',
  priority VARCHAR(20) DEFAULT 'normal',
  assignee_id INTEGER REFERENCES users(id),
  trade VARCHAR(100),
  location VARCHAR(255),
  due_date DATE,
  closed_date TIMESTAMP,
  final_approver_id INTEGER REFERENCES users(id),
  cost_impact BOOLEAN DEFAULT false,
  cost_amount DECIMAL(12,2),
  linked_inspection_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS punch_item_photos (
  id SERIAL PRIMARY KEY,
  punch_item_id INTEGER REFERENCES punch_items(id) ON DELETE CASCADE,
  photo_url VARCHAR(500),
  caption TEXT,
  taken_at TIMESTAMP,
  uploaded_by INTEGER REFERENCES users(id)
);

ALTER TABLE punch_items ADD COLUMN IF NOT EXISTS gps_lat DECIMAL(10,7);
ALTER TABLE punch_items ADD COLUMN IF NOT EXISTS gps_lng DECIMAL(10,7);

ALTER TABLE punch_item_photos ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'photo';

CREATE INDEX IF NOT EXISTS idx_punch_items_project   ON punch_items(project_id);
CREATE INDEX IF NOT EXISTS idx_punch_items_status    ON punch_items(status);
CREATE INDEX IF NOT EXISTS idx_punch_items_assignee  ON punch_items(assignee_id);
CREATE INDEX IF NOT EXISTS idx_punch_photos_item     ON punch_item_photos(punch_item_id);
