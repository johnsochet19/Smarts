const router = require('express').Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  var limit = parseInt(req.query.limit) || 200;
  var offset = parseInt(req.query.offset) || 0;
  try {
    var cols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'changelog'");
    var colNames = cols.rows.map(r => r.column_name);
    var timeCol = colNames.includes('changed_at') ? 'changed_at' : 'created_at';
    var userCol = colNames.includes('changed_by') ? 'changed_by' : 'user_id';
    var result = await db.query(
      'SELECT c.*, u.name as changed_by_name, u.email as changed_by_email FROM changelog c LEFT JOIN users u ON c.' + userCol + ' = u.id ORDER BY c.' + timeCol + ' DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/task/:taskId', authenticate, async (req, res) => {
  try {
    var cols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'changelog'");
    var colNames = cols.rows.map(r => r.column_name);
    var timeCol = colNames.includes('changed_at') ? 'changed_at' : 'created_at';
    var userCol = colNames.includes('changed_by') ? 'changed_by' : 'user_id';
    var result = await db.query(
      'SELECT c.*, u.name as changed_by_name, u.email as changed_by_email FROM changelog c LEFT JOIN users u ON c.' + userCol + ' = u.id WHERE c.table_name = $1 AND c.record_id = $2 ORDER BY c.' + timeCol + ' DESC',
      ['tasks', parseInt(req.params.taskId)]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
