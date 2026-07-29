-- Comments on punch items (the one piece of the punchlist spec that had no
-- backing implementation).
CREATE TABLE IF NOT EXISTS punch_item_comments (
  id            SERIAL PRIMARY KEY,
  punch_item_id INTEGER REFERENCES punch_items(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment       TEXT NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_punch_comments_item ON punch_item_comments(punch_item_id);
