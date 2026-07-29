var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { logChange } = require('../db/changelog');
var { authenticate, requireRole } = require('../middleware/auth');

/* ── constants ───────────────────────────────────────── */
var SI_TYPES = ['task', 'milestone', 'summary', 'phase'];
var DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];

/* ── auto-migrate ────────────────────────────────────── */
(async function () {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS schedule_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      name VARCHAR(255) NOT NULL,
      wbs_code VARCHAR(50),
      type VARCHAR(20) DEFAULT 'task',
      start_date DATE,
      finish_date DATE,
      duration_days INTEGER,
      percent_complete DECIMAL(5,2) DEFAULT 0,
      baseline_start DATE,
      baseline_finish DATE,
      actual_start DATE,
      actual_finish DATE,
      float_days INTEGER,
      critical_path BOOLEAN DEFAULT false,
      assignee_id INTEGER REFERENCES users(id),
      assignee_company VARCHAR(255),
      location VARCHAR(255),
      notes TEXT,
      parent_id INTEGER REFERENCES schedule_items(id),
      sort_order INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS schedule_dependencies (
      id SERIAL PRIMARY KEY,
      predecessor_id INTEGER REFERENCES schedule_items(id) ON DELETE CASCADE,
      successor_id INTEGER REFERENCES schedule_items(id) ON DELETE CASCADE,
      dependency_type VARCHAR(5) DEFAULT 'FS',
      lag_days INTEGER DEFAULT 0,
      UNIQUE(predecessor_id, successor_id)
    )`);
    console.log('Schedule tables ready');
  } catch (err) {
    console.error('Schedule migration note:', err.message);
  }

  /* ── legacy migration ── */
  var legacyCols = [
    'ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS type VARCHAR(20)',
    'ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS duration_days INTEGER',
    'ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS assignee_id INTEGER',
    'ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS assignee_company VARCHAR(255)',
    'ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS parent_id INTEGER',
    'ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS sort_order INTEGER',
  ];
  for (var i = 0; i < legacyCols.length; i++) { await db.query(legacyCols[i]).catch(function () {}); }

  /* Migrate item_type → type (lowercase) */
  await db.query("UPDATE schedule_items SET type = 'task' WHERE type IS NULL AND (item_type IS NULL OR item_type ILIKE 'task')").catch(function(){});
  await db.query("UPDATE schedule_items SET type = 'milestone' WHERE type IS NULL AND item_type ILIKE 'milestone'").catch(function(){});
  await db.query("UPDATE schedule_items SET type = 'summary' WHERE type IS NULL AND item_type ILIKE 'summary'").catch(function(){});
  await db.query("UPDATE schedule_items SET type = 'phase' WHERE type IS NULL AND item_type ILIKE 'phase'").catch(function(){});
  /* Migrate duration → duration_days */
  await db.query("UPDATE schedule_items SET duration_days = duration WHERE duration_days IS NULL AND duration IS NOT NULL AND duration > 0").catch(function(){});

  /* Migrate old JSONB predecessors into schedule_dependencies */
  try {
    var oldItems = await db.query("SELECT id, predecessors FROM schedule_items WHERE predecessors IS NOT NULL AND predecessors != '[]'::jsonb");
    for (var j = 0; j < oldItems.rows.length; j++) {
      var item = oldItems.rows[j];
      var preds = typeof item.predecessors === 'string' ? JSON.parse(item.predecessors) : (item.predecessors || []);
      for (var k = 0; k < preds.length; k++) {
        var p = preds[k];
        var predId = p.schedule_item_id || p.predecessor_id;
        if (!predId) continue;
        var exists = await db.query('SELECT id FROM schedule_dependencies WHERE predecessor_id = $1 AND successor_id = $2', [predId, item.id]);
        if (exists.rows.length === 0) {
          var dt = (p.type || p.dependency_type || 'FS').toUpperCase();
          if (!DEP_TYPES.includes(dt)) dt = 'FS';
          await db.query('INSERT INTO schedule_dependencies (predecessor_id, successor_id, dependency_type, lag_days) VALUES ($1,$2,$3,$4)',
            [predId, item.id, dt, Number(p.lag_days) || 0]);
        }
      }
    }
  } catch(e) { /* predecessors col may not exist */ }

  /* Migrate old JSONB assignees → assignee_id / assignee_company */
  try {
    var oldAssign = await db.query("SELECT id, assignees FROM schedule_items WHERE assignees IS NOT NULL AND assignees != '[]'::jsonb AND assignee_id IS NULL AND assignee_company IS NULL");
    for (var m = 0; m < oldAssign.rows.length; m++) {
      var row = oldAssign.rows[m];
      var assigns = typeof row.assignees === 'string' ? JSON.parse(row.assignees) : (row.assignees || []);
      if (assigns.length > 0) {
        var first = assigns[0];
        if (first.type === 'Company' || first.type === 'company') {
          await db.query('UPDATE schedule_items SET assignee_company = $1 WHERE id = $2', [first.name, row.id]);
        } else if (first.name) {
          /* try to find user by name */
          var userMatch = await db.query("SELECT id FROM users WHERE name ILIKE $1 OR email ILIKE $1 LIMIT 1", [first.name]);
          if (userMatch.rows.length > 0) {
            await db.query('UPDATE schedule_items SET assignee_id = $1 WHERE id = $2', [userMatch.rows[0].id, row.id]);
          } else {
            await db.query('UPDATE schedule_items SET assignee_company = $1 WHERE id = $2', [first.name, row.id]);
          }
        }
      }
    }
  } catch(e) { /* assignees col may not exist */ }
})();

/* ── helpers ─────────────────────────────────────────── */
function validateProject(req, res, next) {
  var pid = req.params.id || req.query.project_id;
  if (!pid) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(pid);
  next();
}

async function enrichItem(row) {
  var deps = await db.query(
    'SELECT * FROM schedule_dependencies WHERE successor_id = $1 ORDER BY id', [row.id]);
  row.dependencies = deps.rows;
  return row;
}

async function enrichItems(rows) {
  if (rows.length === 0) return rows;
  var ids = rows.map(function(r) { return r.id; });
  var deps = await db.query(
    'SELECT * FROM schedule_dependencies WHERE successor_id = ANY($1) ORDER BY id', [ids]);
  var depMap = {};
  deps.rows.forEach(function(d) {
    if (!depMap[d.successor_id]) depMap[d.successor_id] = [];
    depMap[d.successor_id].push(d);
  });
  rows.forEach(function(r) { r.dependencies = depMap[r.id] || []; });
  return rows;
}

/* build hierarchical tree from flat list */
function buildTree(rows) {
  var map = {};
  var roots = [];
  rows.forEach(function(r) { r.children = []; map[r.id] = r; });
  rows.forEach(function(r) {
    if (r.parent_id && map[r.parent_id]) {
      map[r.parent_id].children.push(r);
    } else {
      roots.push(r);
    }
  });
  return roots;
}

/* ── CRUD routes ─────────────────────────────────────── */

router.get('/', authenticate, validateProject, async function (req, res) {
  try {
    var result = await db.query(
      'SELECT * FROM schedule_items WHERE project_id = $1 ORDER BY sort_order NULLS LAST, wbs_code ASC, id ASC',
      [req.projectId]);
    var enriched = await enrichItems(result.rows);
    if (req.query.tree === 'true') {
      res.json(buildTree(enriched));
    } else {
      res.json(enriched);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:siId', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM schedule_items WHERE id = $1', [req.params.siId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Schedule item not found' });
    var enriched = await enrichItem(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name required' });
    var tp = (b.type || 'task').toLowerCase();
    if (!SI_TYPES.includes(tp)) return res.status(400).json({ error: 'Invalid type. Allowed: ' + SI_TYPES.join(', ') });
    /* auto-increment sort_order */
    var soResult = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_so FROM schedule_items WHERE project_id = $1' + (b.parent_id ? ' AND parent_id = $2' : ' AND parent_id IS NULL'),
      b.parent_id ? [req.projectId, b.parent_id] : [req.projectId]);
    var nextSO = b.sort_order != null ? b.sort_order : soResult.rows[0].next_so;
    var result = await db.query(
      `INSERT INTO schedule_items (
        project_id, name, wbs_code, type, start_date, finish_date, duration_days,
        percent_complete, baseline_start, baseline_finish, actual_start, actual_finish,
        float_days, critical_path, assignee_id, assignee_company, location, notes,
        parent_id, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [
        req.projectId, b.name, b.wbs_code || null, tp,
        b.start_date || null, b.finish_date || null, b.duration_days != null ? b.duration_days : null,
        Number(b.percent_complete) || 0,
        b.baseline_start || null, b.baseline_finish || null,
        b.actual_start || null, b.actual_finish || null,
        b.float_days != null ? b.float_days : null, b.critical_path || false,
        b.assignee_id || null, b.assignee_company || null,
        b.location || null, b.notes || null,
        b.parent_id || null, nextSO
      ]
    );
    var itemId = result.rows[0].id;
    /* insert dependencies */
    var deps = b.dependencies || [];
    for (var i = 0; i < deps.length; i++) {
      var d = deps[i];
      if (!d.predecessor_id) continue;
      var dt = (d.dependency_type || 'FS').toUpperCase();
      if (!DEP_TYPES.includes(dt)) dt = 'FS';
      await db.query(
        'INSERT INTO schedule_dependencies (predecessor_id, successor_id, dependency_type, lag_days) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [d.predecessor_id, itemId, dt, Number(d.lag_days) || 0]
      );
    }
    await logChange({ tableName: 'schedule_items', recordId: itemId, operation: 'CREATE',
      newValue: JSON.stringify({ name: b.name }), userId: req.user.id });
    var enriched = await enrichItem(result.rows[0]);
    res.status(201).json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:siId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM schedule_items WHERE id = $1', [req.params.siId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Schedule item not found' });
    var b = req.body;
    var fields = ['name', 'wbs_code', 'type', 'start_date', 'finish_date', 'duration_days',
      'percent_complete', 'baseline_start', 'baseline_finish', 'actual_start', 'actual_finish',
      'float_days', 'critical_path', 'assignee_id', 'assignee_company', 'location', 'notes',
      'parent_id', 'sort_order'];
    var updates = { updated_at: new Date() };
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (b[f] !== undefined) {
        updates[f] = b[f] === '' ? null : b[f];
      }
    }
    if (updates.type && !SI_TYPES.includes(updates.type)) return res.status(400).json({ error: 'Invalid type' });
    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.siId);
    var result = await db.query('UPDATE schedule_items SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    /* replace dependencies if provided */
    if (b.dependencies !== undefined) {
      await db.query('DELETE FROM schedule_dependencies WHERE successor_id = $1', [req.params.siId]);
      var deps = b.dependencies || [];
      for (var j = 0; j < deps.length; j++) {
        var d = deps[j];
        if (!d.predecessor_id) continue;
        var dt = (d.dependency_type || 'FS').toUpperCase();
        if (!DEP_TYPES.includes(dt)) dt = 'FS';
        await db.query(
          'INSERT INTO schedule_dependencies (predecessor_id, successor_id, dependency_type, lag_days) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [d.predecessor_id, req.params.siId, dt, Number(d.lag_days) || 0]
        );
      }
    }
    await logChange({ tableName: 'schedule_items', recordId: req.params.siId, operation: 'UPDATE',
      newValue: JSON.stringify({ name: result.rows[0].name }), userId: req.user.id });
    var enriched = await enrichItem(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:siId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM schedule_items WHERE id = $1', [req.params.siId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Schedule item not found' });
    /* re-parent children to deleted item's parent */
    await db.query('UPDATE schedule_items SET parent_id = $1 WHERE parent_id = $2',
      [existing.rows[0].parent_id || null, req.params.siId]);
    await logChange({ tableName: 'schedule_items', recordId: req.params.siId, operation: 'DELETE',
      oldValue: JSON.stringify({ name: existing.rows[0].name }), userId: req.user.id });
    /* cascade deletes dependencies */
    await db.query('DELETE FROM schedule_items WHERE id = $1', [req.params.siId]);
    res.json({ message: 'Schedule item deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Bulk reorder ── */
router.put('/reorder', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var items = req.body.items || [];
    for (var i = 0; i < items.length; i++) {
      await db.query('UPDATE schedule_items SET sort_order = $1, parent_id = $2 WHERE id = $3',
        [items[i].sort_order || (i + 1), items[i].parent_id || null, items[i].id]);
    }
    res.json({ message: 'Reordered ' + items.length + ' items' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
