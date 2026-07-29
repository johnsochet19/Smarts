const router = require('express').Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const { q, status, phase, assigned_to, date_from, date_to } = req.query;
  let where = [], vals = [];
  if (q) {
    where.push('(t.name ILIKE $' + (vals.length + 1) + ' OR t.phase ILIKE $' + (vals.length + 1) + ' OR t.notes ILIKE $' + (vals.length + 1) + ' OR t.status ILIKE $' + (vals.length + 1) + ' OR u.name ILIKE $' + (vals.length + 1) + ')');
    vals.push('%' + q + '%');
  }
  if (status) { where.push('t.status = $' + (vals.length + 1)); vals.push(status); }
  if (phase) { where.push('t.phase ILIKE $' + (vals.length + 1)); vals.push('%' + phase + '%'); }
  if (assigned_to) { where.push('t.assigned_to = $' + (vals.length + 1)); vals.push(assigned_to); }
  if (date_from) { where.push('t.start_date >= $' + (vals.length + 1)); vals.push(date_from); }
  if (date_to) { where.push('t.finish_date <= $' + (vals.length + 1)); vals.push(date_to); }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const result = await db.query('SELECT t.*, u.name as assigned_user_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id ' + whereClause + ' ORDER BY t.start_date ASC', vals);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;