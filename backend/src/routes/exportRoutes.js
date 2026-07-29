const router = require('express').Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.get('/csv', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tasks ORDER BY start_date ASC');
    const tasks = result.rows;
    const headers = ['id','name','start_date','finish_date','duration_days','phase','status','assigned_to','color','notes'];
    let csv = headers.join(',') + '\n';
    tasks.forEach(t => {
      csv += headers.map(h => '"' + (t[h] || '') + '"').join(',') + '\n';
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tasks.csv');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/json', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tasks ORDER BY start_date ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
