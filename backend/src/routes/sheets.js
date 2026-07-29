// Sheets module — a generic Smartsheet-style grid engine.
// Data model: sheets -> columns (typed) + rows (JSONB cell map keyed by column id).
// Row hierarchy via parent_id; ordering via fractional `position`.
var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { authenticate } = require('../middleware/auth');

var COLUMN_TYPES = [
  'text', 'number', 'currency', 'percent', 'dropdown', 'multi_select',
  'status', 'priority', 'date', 'time', 'checkbox', 'contact',
  'formula', 'auto_number',
];

/* ── auto-migrate ─────────────────────────────────────── */
(async function () {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS sheets (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS sheet_columns (
      id SERIAL PRIMARY KEY,
      sheet_id INTEGER REFERENCES sheets(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(30) NOT NULL DEFAULT 'text',
      position DOUBLE PRECISION DEFAULT 0,
      width INTEGER DEFAULT 180,
      options JSONB DEFAULT '{}'::jsonb,
      is_primary BOOLEAN DEFAULT false,
      hidden BOOLEAN DEFAULT false,
      locked BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS sheet_rows (
      id SERIAL PRIMARY KEY,
      sheet_id INTEGER REFERENCES sheets(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES sheet_rows(id) ON DELETE CASCADE,
      position DOUBLE PRECISION DEFAULT 0,
      cells JSONB DEFAULT '{}'::jsonb,
      locked BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sheet_columns_sheet ON sheet_columns(sheet_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet ON sheet_rows(sheet_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sheet_rows_parent ON sheet_rows(parent_id)`);
    console.log('Sheets tables ready');
  } catch (err) {
    console.error('Sheets migration note:', err.message);
  }
})();

/* ── helpers ──────────────────────────────────────────── */
function getProjectId(req) {
  return req.params.id || req.params.projectId || req.query.project_id || (req.body && req.body.project_id);
}

var DEFAULT_COLUMNS = [
  { name: 'Task Name', type: 'text', is_primary: true, width: 260 },
  { name: 'Status', type: 'status', width: 150, options: { choices: [
    { value: 'open', label: 'Open', color: '#3b82f6' },
    { value: 'in_progress', label: 'In Progress', color: '#f59e0b' },
    { value: 'blocked', label: 'Blocked', color: '#ef4444' },
    { value: 'done', label: 'Done', color: '#22c55e' },
  ] } },
  { name: 'Priority', type: 'priority', width: 130, options: { choices: [
    { value: 'low', label: 'Low', color: '#64748b' },
    { value: 'normal', label: 'Normal', color: '#3b82f6' },
    { value: 'high', label: 'High', color: '#ef4444' },
  ] } },
  { name: 'Assignee', type: 'contact', width: 170 },
  { name: 'Start', type: 'date', width: 130 },
  { name: 'Due', type: 'date', width: 130 },
  { name: '% Done', type: 'percent', width: 110 },
];

async function loadFullSheet(sheetId) {
  var sheet = await db.query('SELECT * FROM sheets WHERE id = $1', [sheetId]);
  if (!sheet.rows.length) return null;
  var columns = await db.query('SELECT * FROM sheet_columns WHERE sheet_id = $1 ORDER BY position, id', [sheetId]);
  var rows = await db.query('SELECT * FROM sheet_rows WHERE sheet_id = $1 ORDER BY position, id', [sheetId]);
  return { sheet: sheet.rows[0], columns: columns.rows, rows: rows.rows };
}

/* ── sheet CRUD ───────────────────────────────────────── */

// GET /  — list sheets for a project
router.get('/', authenticate, async function (req, res) {
  try {
    var projectId = getProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    var result = await db.query(
      `SELECT s.*, (SELECT COUNT(*) FROM sheet_rows r WHERE r.sheet_id = s.id) AS row_count
       FROM sheets s WHERE s.project_id = $1 ORDER BY s.created_at DESC`,
      [projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /  — create a sheet with default columns + one empty row
router.post('/', authenticate, async function (req, res) {
  var client = await db.pool.connect();
  try {
    var projectId = getProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    var { name, description } = req.body;
    await client.query('BEGIN');
    var s = await client.query(
      'INSERT INTO sheets (project_id, name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [projectId, name || 'Untitled Sheet', description || null, req.user.id]
    );
    var sheetId = s.rows[0].id;
    for (var i = 0; i < DEFAULT_COLUMNS.length; i++) {
      var c = DEFAULT_COLUMNS[i];
      await client.query(
        'INSERT INTO sheet_columns (sheet_id, name, type, position, width, options, is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [sheetId, c.name, c.type, i, c.width || 180, JSON.stringify(c.options || {}), !!c.is_primary]
      );
    }
    for (var r = 0; r < 3; r++) {
      await client.query('INSERT INTO sheet_rows (sheet_id, position, cells) VALUES ($1,$2,$3)', [sheetId, r, '{}']);
    }
    await client.query('COMMIT');
    var full = await loadFullSheet(sheetId);
    res.status(201).json(full);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// GET /:sheetId — full sheet
router.get('/:sheetId', authenticate, async function (req, res) {
  try {
    var full = await loadFullSheet(req.params.sheetId);
    if (!full) return res.status(404).json({ error: 'Sheet not found' });
    res.json(full);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:sheetId — rename / describe
router.put('/:sheetId', authenticate, async function (req, res) {
  try {
    var { name, description } = req.body;
    var result = await db.query(
      'UPDATE sheets SET name = COALESCE($1,name), description = COALESCE($2,description), updated_at = NOW() WHERE id = $3 RETURNING *',
      [name || null, description !== undefined ? description : null, req.params.sheetId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Sheet not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:sheetId
router.delete('/:sheetId', authenticate, async function (req, res) {
  try {
    await db.query('DELETE FROM sheets WHERE id = $1', [req.params.sheetId]);
    res.json({ message: 'Sheet deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── columns ──────────────────────────────────────────── */

// POST /:sheetId/columns
router.post('/:sheetId/columns', authenticate, async function (req, res) {
  try {
    var { name, type, options, width, position } = req.body;
    if (type && COLUMN_TYPES.indexOf(type) === -1) return res.status(400).json({ error: 'Invalid column type' });
    if (position === undefined) {
      var max = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sheet_columns WHERE sheet_id = $1', [req.params.sheetId]);
      position = max.rows[0].p;
    }
    var result = await db.query(
      'INSERT INTO sheet_columns (sheet_id, name, type, position, width, options) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.sheetId, name || 'Column', type || 'text', position, width || 180, JSON.stringify(options || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:sheetId/columns/:colId
router.put('/:sheetId/columns/:colId', authenticate, async function (req, res) {
  try {
    var { name, type, options, width, position, hidden, locked } = req.body;
    if (type && COLUMN_TYPES.indexOf(type) === -1) return res.status(400).json({ error: 'Invalid column type' });
    var result = await db.query(
      `UPDATE sheet_columns SET
         name = COALESCE($1,name), type = COALESCE($2,type),
         options = COALESCE($3,options), width = COALESCE($4,width),
         position = COALESCE($5,position), hidden = COALESCE($6,hidden), locked = COALESCE($7,locked)
       WHERE id = $8 AND sheet_id = $9 RETURNING *`,
      [name || null, type || null, options !== undefined ? JSON.stringify(options) : null,
       width || null, position !== undefined ? position : null,
       hidden !== undefined ? hidden : null, locked !== undefined ? locked : null,
       req.params.colId, req.params.sheetId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Column not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:sheetId/columns/:colId
router.delete('/:sheetId/columns/:colId', authenticate, async function (req, res) {
  try {
    await db.query('DELETE FROM sheet_columns WHERE id = $1 AND sheet_id = $2', [req.params.colId, req.params.sheetId]);
    res.json({ message: 'Column deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── rows ─────────────────────────────────────────────── */

// POST /:sheetId/rows
router.post('/:sheetId/rows', authenticate, async function (req, res) {
  try {
    var { parent_id, position, cells } = req.body;
    if (position === undefined) {
      var max = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sheet_rows WHERE sheet_id = $1', [req.params.sheetId]);
      position = max.rows[0].p;
    }
    var result = await db.query(
      'INSERT INTO sheet_rows (sheet_id, parent_id, position, cells) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.sheetId, parent_id || null, position, JSON.stringify(cells || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:sheetId/rows/:rowId — merge cells + move/indent/lock
router.put('/:sheetId/rows/:rowId', authenticate, async function (req, res) {
  try {
    var { cells, parent_id, position, locked } = req.body;
    var existing = await db.query('SELECT * FROM sheet_rows WHERE id = $1 AND sheet_id = $2', [req.params.rowId, req.params.sheetId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Row not found' });
    var merged = existing.rows[0].cells || {};
    if (cells && typeof cells === 'object') {
      for (var k in cells) {
        if (cells[k] === null) delete merged[k];
        else merged[k] = cells[k];
      }
    }
    var result = await db.query(
      `UPDATE sheet_rows SET cells = $1,
         parent_id = $2,
         position = COALESCE($3, position),
         locked = COALESCE($4, locked),
         updated_at = NOW()
       WHERE id = $5 AND sheet_id = $6 RETURNING *`,
      [JSON.stringify(merged),
       parent_id !== undefined ? parent_id : existing.rows[0].parent_id,
       position !== undefined ? position : null,
       locked !== undefined ? locked : null,
       req.params.rowId, req.params.sheetId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:sheetId/rows/:rowId/duplicate
router.post('/:sheetId/rows/:rowId/duplicate', authenticate, async function (req, res) {
  try {
    var src = await db.query('SELECT * FROM sheet_rows WHERE id = $1 AND sheet_id = $2', [req.params.rowId, req.params.sheetId]);
    if (!src.rows.length) return res.status(404).json({ error: 'Row not found' });
    var row = src.rows[0];
    var result = await db.query(
      'INSERT INTO sheet_rows (sheet_id, parent_id, position, cells) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.sheetId, row.parent_id, (row.position || 0) + 0.5, JSON.stringify(row.cells || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:sheetId/rows/:rowId (cascades to children via FK)
router.delete('/:sheetId/rows/:rowId', authenticate, async function (req, res) {
  try {
    await db.query('DELETE FROM sheet_rows WHERE id = $1 AND sheet_id = $2', [req.params.rowId, req.params.sheetId]);
    res.json({ message: 'Row deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
