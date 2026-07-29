const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM color_themes ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, colors } = req.body;
  if (!name || !colors) return res.status(400).json({ error: 'name and colors required' });
  try {
    const result = await db.query(
      'INSERT INTO color_themes (name, colors) VALUES ($1, $2) RETURNING *',
      [name, JSON.stringify(colors)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM color_themes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Theme deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
