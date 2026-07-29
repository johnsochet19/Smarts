const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate: auth } = require('../middleware/auth');

(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      remind_at TIMESTAMP NOT NULL,
      message TEXT DEFAULT '',
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Reminders table ready');
  } catch(e) { console.error('Reminders migration error:', e.message); }
})();

router.get('/', auth, async (req, res) => {
  try {
    var r = await db.query(
      `SELECT r.*, t.title as task_title FROM reminders r
       LEFT JOIN tasks t ON r.task_id = t.id
       WHERE r.user_id = $1 ORDER BY r.remind_at ASC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/pending', auth, async (req, res) => {
  try {
    var r = await db.query(
      `SELECT r.*, t.title as task_title FROM reminders r
       LEFT JOIN tasks t ON r.task_id = t.id
       WHERE r.user_id = $1 AND r.is_read = FALSE AND r.remind_at <= NOW()
       ORDER BY r.remind_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    var { task_id, remind_at, message } = req.body;
    var r = await db.query(
      'INSERT INTO reminders (task_id, user_id, remind_at, message) VALUES ($1,$2,$3,$4) RETURNING *',
      [task_id, req.user.id, remind_at, message || '']
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/read', auth, async (req, res) => {
  try {
    await db.query('UPDATE reminders SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ read: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/read-all', auth, async (req, res) => {
  try {
    await db.query('UPDATE reminders SET is_read = TRUE WHERE user_id = $1', [req.user.id]);
    res.json({ read: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
