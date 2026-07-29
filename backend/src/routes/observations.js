const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate: auth } = require('../middleware/auth');

router.get('/projects/:id/observations', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM observations WHERE project_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/projects/:id/observations', auth, async (req, res) => {
  try {
    const { title, description, type, priority, location, due_date, assignee_id } = req.body;
    const result = await pool.query('INSERT INTO observations (project_id, title, description, type, priority, location, due_date, assignee_id, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING *', [req.params.id, title, description, type, priority, location, due_date, assignee_id, req.user.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/observations/:id', auth, async (req, res) => {
  try {
    const { title, description, type, priority, status, location, due_date, assignee_id } = req.body;
    const result = await pool.query('UPDATE observations SET title=$1, description=$2, type=$3, priority=$4, status=$5, location=$6, due_date=$7, assignee_id=$8, updated_at=NOW() WHERE id=$9 RETURNING *', [title, description, type, priority, status, location, due_date, assignee_id, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/observations/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM observations WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;