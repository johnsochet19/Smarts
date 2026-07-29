const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM dependencies');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  const { task_id, depends_on_id } = req.body;
  if (!task_id || !depends_on_id) return res.status(400).json({ error: 'task_id and depends_on_id required' });
  try {
    const result = await db.query(
      'INSERT INTO dependencies (task_id, depends_on_id) VALUES ($1, $2) RETURNING *',
      [task_id, depends_on_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'editor'), async (req, res) => {
  try {
    await db.query('DELETE FROM dependencies WHERE id = $1', [req.params.id]);
    res.json({ message: 'Dependency deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
