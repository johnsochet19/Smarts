const express = require('express');
const router = express.Router();
const db = require('../db');

// Ensure schedules table exists
async function ensureTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT 'Untitled Schedule',
    filename VARCHAR(255),
    source VARCHAR(100),
    tasks JSONB DEFAULT '[]',
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
}
ensureTable().catch(err => console.error('schedules table migration error:', err.message));

// GET /api/schedules?project_id=X  - list all schedules for a project
router.get('/', async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });
    const result = await db.query(
      'SELECT id, project_id, name, filename, source, created_by, created_at, updated_at, array_length(ARRAY(SELECT jsonb_array_elements(tasks)), 1) as task_count FROM schedules WHERE project_id = $1 ORDER BY updated_at DESC',
      [project_id]
    );
    res.json(result.rows);
  } catch (e) {
    // Fallback if array_length query fails
    try {
      const { project_id } = req.query;
      const result = await db.query(
        'SELECT id, project_id, name, filename, source, created_by, created_at, updated_at FROM schedules WHERE project_id = $1 ORDER BY updated_at DESC',
        [project_id]
      );
      const rows = result.rows.map(r => ({ ...r, task_count: 0 }));
      res.json(rows);
    } catch (e2) {
      console.error('List schedules error:', e2);
      res.status(500).json({ error: e2.message });
    }
  }
});

// GET /api/schedules/:id  - get a single schedule with tasks
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Get schedule error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/schedules  - create a new schedule
router.post('/', async (req, res) => {
  try {
    const { project_id, name, filename, source, tasks, created_by } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });
    const result = await db.query(
      'INSERT INTO schedules (project_id, name, filename, source, tasks, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [project_id, name || 'Untitled Schedule', filename || '', source || '', JSON.stringify(tasks || []), created_by || null]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Create schedule error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/schedules/:id  - update a schedule (rename, update tasks)
router.put('/:id', async (req, res) => {
  try {
    const { name, tasks, filename, source } = req.body;
    const sets = ['updated_at = NOW()'];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { sets.push('name = $' + idx); vals.push(name); idx++; }
    if (tasks !== undefined) { sets.push('tasks = $' + idx); vals.push(JSON.stringify(tasks)); idx++; }
    if (filename !== undefined) { sets.push('filename = $' + idx); vals.push(filename); idx++; }
    if (source !== undefined) { sets.push('source = $' + idx); vals.push(source); idx++; }
    vals.push(req.params.id);
    const result = await db.query(
      'UPDATE schedules SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING *',
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Update schedule error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/schedules/:id  - delete a schedule
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM schedules WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (e) {
    console.error('Delete schedule error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
