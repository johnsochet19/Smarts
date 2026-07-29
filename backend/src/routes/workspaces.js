// Workspaces — the grouping layer above projects.
const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// Safety net for DBs that predate migration 009 (mirrors its DDL, idempotent).
(async function () {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      color VARCHAR(20) DEFAULT '#3b82f6',
      position DOUBLE PRECISION DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL`);
    console.log('Workspaces table ready');
  } catch (err) { console.error('workspaces migration error:', err.message); }
})();

// GET /api/workspaces — list with project counts
router.get('/', authenticate, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT w.*, (SELECT COUNT(*)::int FROM projects p WHERE p.workspace_id = w.id) AS project_count
       FROM workspaces w ORDER BY w.position, w.created_at`
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/workspaces
router.post('/', authenticate, requireRole('admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const { name, description, color, position } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const r = await db.query(
      `INSERT INTO workspaces (name, description, color, position, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [String(name).trim(), description || null, color || '#3b82f6', position || 0, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/workspaces/:id
router.put('/:id', authenticate, requireRole('admin', 'manager', 'superadmin'), async (req, res) => {
  try {
    const { name, description, color, position } = req.body;
    const r = await db.query(
      `UPDATE workspaces SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         color = COALESCE($3, color),
         position = COALESCE($4, position),
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name || null, description ?? null, color || null, position ?? null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Workspace not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/workspaces/:id — projects are kept (workspace_id set NULL by FK)
router.delete('/:id', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const r = await db.query('DELETE FROM workspaces WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Workspace not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
