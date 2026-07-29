var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { logChange } = require('../db/changelog');
var { authenticate, requireRole } = require('../middleware/auth');

/* ── constants ───────────────────────────────────────── */
var DISCIPLINES = ['architectural','structural','mechanical','electrical','plumbing','civil','landscape','fire_protection','other'];
var DRAWING_STATUSES = ['current', 'superseded', 'void'];

/* ── auto-migrate ────────────────────────────────────── */
(async function () {
  try {
    /* drawing_sets */
    await db.query(`CREATE TABLE IF NOT EXISTS drawing_sets (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      set_name VARCHAR(255),
      publish_date DATE,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    /* drawings */
    await db.query(`CREATE TABLE IF NOT EXISTS drawings (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      drawing_set_id INTEGER REFERENCES drawing_sets(id),
      number VARCHAR(50),
      title VARCHAR(255) NOT NULL,
      discipline VARCHAR(50),
      revision VARCHAR(20) DEFAULT '0',
      status VARCHAR(20) DEFAULT 'current',
      publish_date DATE,
      file_url VARCHAR(500),
      thumbnail_url VARCHAR(500),
      file_size INTEGER,
      ocr_text TEXT,
      superseded_by_id INTEGER,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    /* drawing_markups */
    await db.query(`CREATE TABLE IF NOT EXISTS drawing_markups (
      id SERIAL PRIMARY KEY,
      drawing_id INTEGER REFERENCES drawings(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      markup_data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    /* ── legacy migrations ── */
    // Add new columns
    await db.query(`ALTER TABLE drawings ADD COLUMN IF NOT EXISTS drawing_set_id INTEGER`).catch(function(){});
    await db.query(`ALTER TABLE drawings ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500)`).catch(function(){});
    await db.query(`ALTER TABLE drawings ADD COLUMN IF NOT EXISTS file_size INTEGER`).catch(function(){});
    await db.query(`ALTER TABLE drawings ADD COLUMN IF NOT EXISTS ocr_text TEXT`).catch(function(){});
    await db.query(`ALTER TABLE drawings ADD COLUMN IF NOT EXISTS superseded_by_id INTEGER`).catch(function(){});
    await db.query(`ALTER TABLE drawings ADD COLUMN IF NOT EXISTS publish_date DATE`).catch(function(){});

    // Migrate date_published → publish_date
    await db.query(`UPDATE drawings SET publish_date = date_published WHERE publish_date IS NULL AND date_published IS NOT NULL`).catch(function(){});
    await db.query(`ALTER TABLE drawings DROP COLUMN IF EXISTS date_published`).catch(function(){});

    // Migrate set_name → drawing_sets + drawing_set_id
    var setsToMigrate = await db.query(`SELECT DISTINCT project_id, set_name FROM drawings WHERE set_name IS NOT NULL AND set_name != '' AND drawing_set_id IS NULL`).catch(function() { return { rows: [] }; });
    for (var s of setsToMigrate.rows) {
      var existing = await db.query('SELECT id FROM drawing_sets WHERE project_id = $1 AND set_name = $2', [s.project_id, s.set_name]);
      var setId;
      if (existing.rows.length) {
        setId = existing.rows[0].id;
      } else {
        var ins = await db.query('INSERT INTO drawing_sets (project_id, set_name) VALUES ($1, $2) RETURNING id', [s.project_id, s.set_name]);
        setId = ins.rows[0].id;
      }
      await db.query('UPDATE drawings SET drawing_set_id = $1 WHERE project_id = $2 AND set_name = $3 AND drawing_set_id IS NULL', [setId, s.project_id, s.set_name]);
    }
    await db.query(`ALTER TABLE drawings DROP COLUMN IF EXISTS set_name`).catch(function(){});

    // Migrate JSONB markup_layers → drawing_markups
    var hasMarkupCol = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'drawings' AND column_name = 'markup_layers'`);
    if (hasMarkupCol.rows.length) {
      var markupRows = await db.query(`SELECT id, markup_layers, uploaded_by FROM drawings WHERE markup_layers IS NOT NULL AND markup_layers != '[]'::jsonb`).catch(function() { return { rows: [] }; });
      for (var mr of markupRows.rows) {
        var existMarkup = await db.query('SELECT id FROM drawing_markups WHERE drawing_id = $1 LIMIT 1', [mr.id]);
        if (existMarkup.rows.length) continue;
        var layers = typeof mr.markup_layers === 'string' ? JSON.parse(mr.markup_layers) : (mr.markup_layers || []);
        if (layers.length > 0) {
          await db.query('INSERT INTO drawing_markups (drawing_id, user_id, markup_data) VALUES ($1, $2, $3)',
            [mr.id, mr.uploaded_by, JSON.stringify(layers)]).catch(function(){});
        }
      }
      await db.query('ALTER TABLE drawings DROP COLUMN IF EXISTS markup_layers').catch(function(){});
    }

    // Drop legacy JSONB columns
    await db.query('ALTER TABLE drawings DROP COLUMN IF EXISTS linked_rfis').catch(function(){});
    await db.query('ALTER TABLE drawings DROP COLUMN IF EXISTS linked_submittals').catch(function(){});
    await db.query('ALTER TABLE drawings DROP COLUMN IF EXISTS linked_observations').catch(function(){});
    await db.query('ALTER TABLE drawings DROP COLUMN IF EXISTS uploaded_at').catch(function(){});
    await db.query('ALTER TABLE drawings DROP COLUMN IF EXISTS created_by').catch(function(){});
    await db.query('ALTER TABLE drawings DROP COLUMN IF EXISTS updated_at').catch(function(){});

    // Migrate status/discipline to lowercase
    await db.query(`UPDATE drawings SET status = LOWER(status) WHERE status != LOWER(status)`).catch(function(){});
    await db.query(`UPDATE drawings SET discipline = LOWER(REPLACE(discipline, ' ', '_')) WHERE discipline IS NOT NULL AND discipline != LOWER(REPLACE(discipline, ' ', '_'))`).catch(function(){});

    console.log('Drawing tables ready');
  } catch (err) {
    console.error('Drawing migration note:', err.message);
  }
})();

/* ── helpers ──────────────────────────────────────────── */
function validateProject(req, res, next) {
  var projectId = req.params.id || req.params.projectId || req.query.project_id;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(projectId);
  next();
}

async function enrichDrawings(drawings) {
  if (!drawings.length) return drawings;
  var ids = drawings.map(function(d) { return d.id; });
  var markupsResult = await db.query(
    'SELECT m.*, u.name AS user_name FROM drawing_markups m LEFT JOIN users u ON u.id = m.user_id WHERE m.drawing_id = ANY($1) ORDER BY m.created_at DESC', [ids]
  );
  var markupMap = {};
  markupsResult.rows.forEach(function(m) {
    if (!markupMap[m.drawing_id]) markupMap[m.drawing_id] = [];
    markupMap[m.drawing_id].push(m);
  });
  // Load set info
  var setIds = drawings.map(function(d) { return d.drawing_set_id; }).filter(Boolean);
  var setMap = {};
  if (setIds.length) {
    var setsResult = await db.query('SELECT * FROM drawing_sets WHERE id = ANY($1)', [setIds]);
    setsResult.rows.forEach(function(s) { setMap[s.id] = s; });
  }
  return drawings.map(function(d) {
    d.markups = markupMap[d.id] || [];
    d.drawing_set = d.drawing_set_id ? (setMap[d.drawing_set_id] || null) : null;
    d.set_name = d.drawing_set ? d.drawing_set.set_name : null;
    return d;
  });
}

/* ══════════════════════════════════════════════════════
   DRAWING SETS
   ══════════════════════════════════════════════════════ */

// GET /sets
router.get('/sets', authenticate, validateProject, async function(req, res) {
  try {
    var result = await db.query(
      'SELECT ds.*, u.name AS uploaded_by_name, (SELECT COUNT(*) FROM drawings WHERE drawing_set_id = ds.id) AS drawing_count FROM drawing_sets ds LEFT JOIN users u ON u.id = ds.uploaded_by WHERE ds.project_id = $1 ORDER BY ds.publish_date DESC NULLS LAST, ds.created_at DESC',
      [req.projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /sets
router.post('/sets', authenticate, validateProject, async function(req, res) {
  try {
    var { set_name, publish_date } = req.body;
    if (!set_name) return res.status(400).json({ error: 'set_name required' });
    var result = await db.query(
      'INSERT INTO drawing_sets (project_id, set_name, publish_date, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.projectId, set_name, publish_date || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /sets/:setId
router.delete('/sets/:setId', authenticate, requireRole('admin'), async function(req, res) {
  try {
    // Unlink drawings from set, don't delete them
    await db.query('UPDATE drawings SET drawing_set_id = NULL WHERE drawing_set_id = $1', [req.params.setId]);
    var result = await db.query('DELETE FROM drawing_sets WHERE id = $1 RETURNING id', [req.params.setId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Drawing set not found' });
    res.json({ message: 'Drawing set deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   DRAWINGS
   ══════════════════════════════════════════════════════ */

// GET / — list drawings for project
router.get('/', authenticate, validateProject, async function(req, res) {
  try {
    var { discipline, status, drawing_set_id, search } = req.query;
    var where = 'WHERE d.project_id = $1';
    var params = [req.projectId];
    if (discipline) { params.push(discipline); where += ' AND d.discipline = $' + params.length; }
    if (status) { params.push(status); where += ' AND d.status = $' + params.length; }
    if (drawing_set_id) { params.push(drawing_set_id); where += ' AND d.drawing_set_id = $' + params.length; }
    if (search) { params.push('%' + search.toLowerCase() + '%'); where += ' AND (LOWER(d.title) LIKE $' + params.length + ' OR LOWER(d.number) LIKE $' + params.length + ' OR LOWER(d.ocr_text) LIKE $' + params.length + ')'; }
    var result = await db.query(
      'SELECT d.*, u.name AS uploaded_by_name FROM drawings d LEFT JOIN users u ON u.id = d.uploaded_by ' +
      where + ' ORDER BY d.discipline, d.number, d.revision DESC',
      params
    );
    var enriched = await enrichDrawings(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — create drawing
router.post('/', authenticate, validateProject, async function(req, res) {
  try {
    var { title, number, discipline, revision, drawing_set_id, publish_date, file_url, thumbnail_url, file_size, ocr_text } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    if (discipline && DISCIPLINES.indexOf(discipline) === -1) {
      return res.status(400).json({ error: 'Invalid discipline. Must be one of: ' + DISCIPLINES.join(', ') });
    }
    var result = await db.query(
      `INSERT INTO drawings (project_id, drawing_set_id, number, title, discipline, revision, status, publish_date, file_url, thumbnail_url, file_size, ocr_text, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.projectId, drawing_set_id || null, number || null, title, discipline || null, revision || '0', 'current',
       publish_date || null, file_url || null, thumbnail_url || null, file_size || null, ocr_text || null, req.user.id]
    );
    var dwg = result.rows[0];
    await logChange({ tableName: 'drawings', recordId: dwg.id, operation: 'CREATE', newValue: JSON.stringify({ title: title, number: number, revision: revision }), userId: req.user.id });
    var enriched = await enrichDrawings([dwg]);
    res.status(201).json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:dwgId
router.get('/:dwgId', authenticate, async function(req, res) {
  try {
    var result = await db.query(
      'SELECT d.*, u.name AS uploaded_by_name FROM drawings d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = $1',
      [req.params.dwgId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Drawing not found' });
    var enriched = await enrichDrawings(result.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:dwgId — update drawing
router.put('/:dwgId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM drawings WHERE id = $1', [req.params.dwgId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Drawing not found' });
    var { title, number, discipline, revision, status, drawing_set_id, publish_date, file_url, thumbnail_url, file_size, ocr_text } = req.body;
    if (discipline && DISCIPLINES.indexOf(discipline) === -1) {
      return res.status(400).json({ error: 'Invalid discipline' });
    }
    if (status && DRAWING_STATUSES.indexOf(status) === -1) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: ' + DRAWING_STATUSES.join(', ') });
    }
    await db.query(
      `UPDATE drawings SET title = COALESCE($1, title), number = COALESCE($2, number), discipline = COALESCE($3, discipline),
       revision = COALESCE($4, revision), status = COALESCE($5, status), drawing_set_id = COALESCE($6, drawing_set_id),
       publish_date = COALESCE($7, publish_date), file_url = COALESCE($8, file_url), thumbnail_url = COALESCE($9, thumbnail_url),
       file_size = COALESCE($10, file_size), ocr_text = COALESCE($11, ocr_text) WHERE id = $12`,
      [title || null, number !== undefined ? number : null, discipline || null, revision || null,
       status || null, drawing_set_id !== undefined ? drawing_set_id : null, publish_date !== undefined ? publish_date : null,
       file_url !== undefined ? file_url : null, thumbnail_url !== undefined ? thumbnail_url : null,
       file_size !== undefined ? file_size : null, ocr_text !== undefined ? ocr_text : null, req.params.dwgId]
    );
    await logChange({ tableName: 'drawings', recordId: req.params.dwgId, operation: 'UPDATE', userId: req.user.id });
    var updated = await db.query('SELECT d.*, u.name AS uploaded_by_name FROM drawings d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = $1', [req.params.dwgId]);
    var enriched = await enrichDrawings(updated.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:dwgId/revision — create new revision, supersede old
router.post('/:dwgId/revision', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM drawings WHERE id = $1', [req.params.dwgId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Drawing not found' });
    var old = existing.rows[0];
    if (old.status !== 'current') {
      return res.status(400).json({ error: 'Can only create revisions from current drawings' });
    }

    var oldRev = parseInt(old.revision) || 0;
    var newRev = req.body.revision || String(oldRev + 1);

    // Create new revision
    var result = await db.query(
      `INSERT INTO drawings (project_id, drawing_set_id, number, title, discipline, revision, status, publish_date, file_url, thumbnail_url, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [old.project_id, req.body.drawing_set_id || old.drawing_set_id, old.number,
       req.body.title || old.title, old.discipline, newRev, 'current',
       req.body.publish_date || new Date().toISOString().substring(0, 10),
       req.body.file_url || old.file_url, req.body.thumbnail_url || old.thumbnail_url, req.user.id]
    );
    var newDwg = result.rows[0];

    // Mark old as superseded and link
    await db.query('UPDATE drawings SET status = $1, superseded_by_id = $2 WHERE id = $3', ['superseded', newDwg.id, old.id]);

    await logChange({ tableName: 'drawings', recordId: newDwg.id, operation: 'CREATE',
      newValue: JSON.stringify({ title: old.title, number: old.number, revision: newRev, supersedes: old.id }), userId: req.user.id });

    var enriched = await enrichDrawings([newDwg]);
    res.status(201).json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:dwgId
router.delete('/:dwgId', authenticate, requireRole('admin'), async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM drawings WHERE id = $1', [req.params.dwgId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Drawing not found' });
    await logChange({ tableName: 'drawings', recordId: req.params.dwgId, operation: 'DELETE',
      oldValue: JSON.stringify({ title: existing.rows[0].title, number: existing.rows[0].number }), userId: req.user.id });
    await db.query('DELETE FROM drawings WHERE id = $1', [req.params.dwgId]);
    res.json({ message: 'Drawing deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   DRAWING MARKUPS
   ══════════════════════════════════════════════════════ */

// GET /:dwgId/markups
router.get('/:dwgId/markups', authenticate, async function(req, res) {
  try {
    var result = await db.query(
      'SELECT m.*, u.name AS user_name FROM drawing_markups m LEFT JOIN users u ON u.id = m.user_id WHERE m.drawing_id = $1 ORDER BY m.created_at DESC',
      [req.params.dwgId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:dwgId/markups
router.post('/:dwgId/markups', authenticate, async function(req, res) {
  try {
    var dwg = await db.query('SELECT id FROM drawings WHERE id = $1', [req.params.dwgId]);
    if (!dwg.rows.length) return res.status(404).json({ error: 'Drawing not found' });
    var { markup_data } = req.body;
    if (!markup_data) return res.status(400).json({ error: 'markup_data required' });
    var result = await db.query(
      'INSERT INTO drawing_markups (drawing_id, user_id, markup_data) VALUES ($1, $2, $3) RETURNING *',
      [req.params.dwgId, req.user.id, JSON.stringify(markup_data)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:dwgId/markups/:markupId
router.put('/:dwgId/markups/:markupId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM drawing_markups WHERE id = $1 AND drawing_id = $2', [req.params.markupId, req.params.dwgId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Markup not found' });
    // Only the author can edit
    if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only the markup author or an admin can edit' });
    }
    var { markup_data } = req.body;
    var result = await db.query(
      'UPDATE drawing_markups SET markup_data = $1 WHERE id = $2 RETURNING *',
      [JSON.stringify(markup_data), req.params.markupId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:dwgId/markups/:markupId
router.delete('/:dwgId/markups/:markupId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM drawing_markups WHERE id = $1 AND drawing_id = $2', [req.params.markupId, req.params.dwgId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Markup not found' });
    if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only the markup author or an admin can delete' });
    }
    await db.query('DELETE FROM drawing_markups WHERE id = $1', [req.params.markupId]);
    res.json({ message: 'Markup deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
