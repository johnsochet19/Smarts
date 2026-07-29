var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { logChange } = require('../db/changelog');
var { authenticate, requireRole } = require('../middleware/auth');

/* ── auto-migrate ────────────────────────────────────── */
(async function () {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS specifications (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      division_number VARCHAR(10),
      division_name VARCHAR(100),
      section_number VARCHAR(20),
      section_title VARCHAR(255) NOT NULL,
      revision_date DATE,
      file_url VARCHAR(500),
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Specifications table ready');
  } catch (err) {
    console.error('Specs migration note:', err.message);
  }

  /* legacy column migrations */
  var cols = [
    'ALTER TABLE specifications ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id)',
    'ALTER TABLE specifications DROP COLUMN IF EXISTS updated_at',
  ];
  for (var i = 0; i < cols.length; i++) {
    await db.query(cols[i]).catch(function () {});
  }

  /* migrate created_by → uploaded_by where uploaded_by is null */
  await db.query(`
    UPDATE specifications SET uploaded_by = created_by
    WHERE uploaded_by IS NULL AND created_by IS NOT NULL
  `).catch(function () {});
})();

/* ── helpers ─────────────────────────────────────────── */
function validateProject(req, res, next) {
  var pid = req.params.id || req.query.project_id;
  if (!pid) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(pid);
  next();
}

/* ── routes ──────────────────────────────────────────── */

/* GET /  — list all specs for project */
router.get('/', authenticate, validateProject, async function (req, res) {
  try {
    var result = await db.query(
      'SELECT s.*, u.name AS uploaded_by_name FROM specifications s LEFT JOIN users u ON u.id = s.uploaded_by WHERE s.project_id = $1 ORDER BY s.division_number, s.section_number',
      [req.projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /:specId — single spec */
router.get('/:specId', authenticate, async function (req, res) {
  try {
    var result = await db.query(
      'SELECT s.*, u.name AS uploaded_by_name FROM specifications s LEFT JOIN users u ON u.id = s.uploaded_by WHERE s.id = $1',
      [req.params.specId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Specification not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST / — create */
router.post('/', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (!b.section_title) return res.status(400).json({ error: 'section_title required' });

    var result = await db.query(
      `INSERT INTO specifications (project_id, division_number, division_name, section_number, section_title, revision_date, file_url, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.projectId, b.division_number || null, b.division_name || null, b.section_number || null,
       b.section_title, b.revision_date || null, b.file_url || null, req.user.id]
    );
    await logChange({ tableName: 'specifications', recordId: result.rows[0].id, operation: 'CREATE',
      newValue: JSON.stringify({ section_title: b.section_title, division_number: b.division_number }), userId: req.user.id });
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /bulk — bulk create (up to 50) */
router.post('/bulk', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var items = req.body.items;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array required' });
    if (items.length > 50) return res.status(400).json({ error: 'Max 50 items per bulk request' });

    var created = [];
    for (var i = 0; i < items.length; i++) {
      var b = items[i];
      if (!b.section_title) continue;
      var result = await db.query(
        `INSERT INTO specifications (project_id, division_number, division_name, section_number, section_title, revision_date, file_url, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.projectId, b.division_number || null, b.division_name || null, b.section_number || null,
         b.section_title, b.revision_date || null, b.file_url || null, req.user.id]
      );
      created.push(result.rows[0]);
      await logChange({ tableName: 'specifications', recordId: result.rows[0].id, operation: 'CREATE',
        newValue: JSON.stringify({ section_title: b.section_title }), userId: req.user.id });
    }
    res.status(201).json(created);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* PUT /:specId — update */
router.put('/:specId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM specifications WHERE id = $1', [req.params.specId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Specification not found' });
    var old = existing.rows[0];

    var allowed = ['division_number', 'division_name', 'section_number', 'section_title', 'revision_date', 'file_url'];
    var updates = {};
    for (var i = 0; i < allowed.length; i++) {
      var field = allowed[i];
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field] === '' ? null : req.body[field];
      }
    }
    if (Object.keys(updates).length === 0) return res.json(old);

    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.specId);

    var result = await db.query('UPDATE specifications SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    await logChange({ tableName: 'specifications', recordId: req.params.specId, operation: 'UPDATE',
      oldValue: JSON.stringify({ section_title: old.section_title }), newValue: JSON.stringify({ section_title: result.rows[0].section_title }), userId: req.user.id });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /:specId */
router.delete('/:specId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM specifications WHERE id = $1', [req.params.specId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Specification not found' });
    await logChange({ tableName: 'specifications', recordId: req.params.specId, operation: 'DELETE',
      oldValue: JSON.stringify({ section_title: existing.rows[0].section_title }), userId: req.user.id });
    await db.query('DELETE FROM specifications WHERE id = $1', [req.params.specId]);
    res.json({ message: 'Specification deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
