const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate: auth } = require('../middleware/auth');

router.get('/schedule/:projectId', auth, async (req, res) => {
  try {
    var r = await db.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY sort_order ASC, id ASC',
      [req.params.projectId]
    );
    res.json({ tasks: r.rows, project_id: req.params.projectId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
