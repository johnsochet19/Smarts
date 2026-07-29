var express = require('express');
var router = express.Router();
var db = require('../db');
var { authenticate: auth, requireRole } = require('../middleware/auth');

(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS drafts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER,
      draft_type VARCHAR(50) NOT NULL,
      form_data JSONB NOT NULL DEFAULT '{}',
      title VARCHAR(255) DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    // Add unique constraint if not exists
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_user_project_type_unique') THEN
        ALTER TABLE drafts ADD CONSTRAINT drafts_user_project_type_unique UNIQUE (user_id, project_id, draft_type);
      END IF;
    END $$`);
    console.log('Drafts table ready');
  } catch(e) { console.error('Drafts migration error:', e.message); }
})();

// Get current user's drafts for a project
router.get('/', auth, async (req, res) => {
  try {
    var pid = req.query.project_id;
    var r;
    if (pid) {
      r = await db.query(
        'SELECT * FROM drafts WHERE user_id = $1 AND project_id = $2 ORDER BY updated_at DESC',
        [req.user.id, pid]
      );
    } else {
      r = await db.query(
        'SELECT * FROM drafts WHERE user_id = $1 ORDER BY updated_at DESC',
        [req.user.id]
      );
    }
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: get drafts for any user (or all users)
router.get('/admin', auth, requireRole('admin'), async (req, res) => {
  try {
    var uid = req.query.user_id || null;
    var pid = req.query.project_id || null;
    var sql = `SELECT d.*, u.name as user_name, u.email as user_email
      FROM drafts d LEFT JOIN users u ON d.user_id = u.id
      WHERE ($1::int IS NULL OR d.user_id = $1)
      AND ($2::int IS NULL OR d.project_id = $2)
      ORDER BY d.updated_at DESC`;
    var r = await db.query(sql, [uid, pid]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Upsert a draft (auto-save endpoint)
router.put('/', auth, async (req, res) => {
  try {
    var { project_id, draft_type, form_data, title } = req.body;
    if (!draft_type) return res.status(400).json({ error: 'draft_type required' });
    var r = await db.query(
      `INSERT INTO drafts (user_id, project_id, draft_type, form_data, title, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT ON CONSTRAINT drafts_user_project_type_unique
       DO UPDATE SET form_data = $4, title = $5, updated_at = NOW()
       RETURNING *`,
      [req.user.id, project_id, draft_type, JSON.stringify(form_data || {}), (title || '').substring(0, 255)]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Clear a draft by project + type (called after successful form save)
router.delete('/clear', auth, async (req, res) => {
  try {
    var { project_id, draft_type } = req.body;
    await db.query(
      'DELETE FROM drafts WHERE user_id = $1 AND project_id = $2 AND draft_type = $3',
      [req.user.id, project_id, draft_type]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete a specific draft by id
router.delete('/:id', auth, async (req, res) => {
  try {
    var id = req.params.id;
    var sql, params;
    if (req.user.role === 'admin') {
      sql = 'DELETE FROM drafts WHERE id = $1 RETURNING *';
      params = [id];
    } else {
      sql = 'DELETE FROM drafts WHERE id = $1 AND user_id = $2 RETURNING *';
      params = [id, req.user.id];
    }
    var r = await db.query(sql, params);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Draft not found' });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
