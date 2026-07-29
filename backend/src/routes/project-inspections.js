var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { logChange } = require('../db/changelog');
var { authenticate, requireRole } = require('../middleware/auth');
var { onStatusChange } = require('../notification-triggers');

/* ── constants ───────────────────────────────────────── */
var INSPECTION_STATUSES = ['pending', 'in_progress', 'deficient', 'closed', 'passed'];
var ITEM_TYPES = ['yes_no', 'text', 'multiple_choice', 'number', 'photo_required', 'signature'];

var STATUS_TRANSITIONS = {
  pending:     ['in_progress'],
  in_progress: ['passed', 'deficient'],
  deficient:   ['in_progress', 'closed'],
  passed:      ['closed'],
  closed:      []
};

/* ── auto-migrate ────────────────────────────────────── */
(async function () {
  try {
    /* templates — company-level (no project_id) */
    await db.query(`CREATE TABLE IF NOT EXISTS inspection_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      trade VARCHAR(100),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    /* template items — replaces JSONB checklist_items */
    await db.query(`CREATE TABLE IF NOT EXISTS inspection_template_items (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES inspection_templates(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      item_type VARCHAR(30) DEFAULT 'yes_no',
      options JSONB,
      requires_photo BOOLEAN DEFAULT false,
      "order" INTEGER,
      section VARCHAR(100)
    )`);
    /* inspections — replaces project_inspections */
    await db.query(`CREATE TABLE IF NOT EXISTS inspections (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      template_id INTEGER REFERENCES inspection_templates(id),
      title VARCHAR(255) NOT NULL,
      description TEXT,
      type VARCHAR(100),
      status VARCHAR(30) DEFAULT 'pending',
      inspector_id INTEGER REFERENCES users(id),
      trade VARCHAR(100),
      location VARCHAR(255),
      scheduled_date DATE,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      deficiency_count INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    /* inspection items — replaces JSONB checklist */
    await db.query(`CREATE TABLE IF NOT EXISTS inspection_items (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER REFERENCES inspections(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      item_type VARCHAR(30) DEFAULT 'yes_no',
      options JSONB,
      "order" INTEGER,
      section VARCHAR(100),
      response TEXT,
      deficient BOOLEAN DEFAULT false,
      deficiency_notes TEXT,
      requires_correction BOOLEAN DEFAULT false,
      corrected_at TIMESTAMP,
      photo_url VARCHAR(500)
    )`);

    /* ── legacy migrations ── */
    // Drop project_id from templates (was company-level in old schema too, just unused)
    await db.query(`ALTER TABLE inspection_templates DROP COLUMN IF EXISTS project_id`).catch(function(){});
    // Remove old type column from templates (no longer needed)
    await db.query(`ALTER TABLE inspection_templates DROP COLUMN IF EXISTS type`).catch(function(){});

    // Migrate old JSONB checklist_items → inspection_template_items
    var oldTemplates = await db.query(`SELECT id, checklist_items FROM inspection_templates WHERE checklist_items IS NOT NULL AND checklist_items != '[]'::jsonb`).catch(function() { return { rows: [] }; });
    for (var tmpl of oldTemplates.rows) {
      var existingItems = await db.query('SELECT id FROM inspection_template_items WHERE template_id = $1 LIMIT 1', [tmpl.id]);
      if (existingItems.rows.length) continue; // already migrated
      var items = typeof tmpl.checklist_items === 'string' ? JSON.parse(tmpl.checklist_items) : (tmpl.checklist_items || []);
      for (var idx = 0; idx < items.length; idx++) {
        var item = items[idx];
        var desc = typeof item === 'string' ? item : (item.description || '');
        var itemType = (item.type || 'Yes/No').toLowerCase().replace(/[\s\/]+/g, '_');
        if (ITEM_TYPES.indexOf(itemType) === -1) itemType = 'yes_no';
        await db.query(
          'INSERT INTO inspection_template_items (template_id, description, item_type, "order") VALUES ($1, $2, $3, $4)',
          [tmpl.id, desc, itemType, idx + 1]
        ).catch(function(){});
      }
    }
    await db.query(`ALTER TABLE inspection_templates DROP COLUMN IF EXISTS checklist_items`).catch(function(){});

    // Migrate project_inspections → inspections
    var hasOld = await db.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'project_inspections')`);
    if (hasOld.rows[0].exists) {
      var oldRows = await db.query('SELECT * FROM project_inspections').catch(function() { return { rows: [] }; });
      for (var row of oldRows.rows) {
        var exists = await db.query('SELECT id FROM inspections WHERE id = $1', [row.id]);
        if (exists.rows.length) continue;
        // Map status to lowercase
        var st = (row.status || 'Pending').toLowerCase().replace(/\s+/g, '_');
        if (INSPECTION_STATUSES.indexOf(st) === -1) st = 'pending';
        await db.query(
          `INSERT INTO inspections (id, project_id, template_id, title, description, type, status, inspector_id, trade, location, scheduled_date, completed_at, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [row.id, row.project_id, row.template_id, row.title, row.description, row.type, st, row.inspector_id, row.trade, row.location, row.scheduled_date,
           row.completed_date ? new Date(row.completed_date) : null, row.created_by, row.created_at, row.updated_at]
        ).catch(function(){});
        // Migrate JSONB checklist → inspection_items
        var cl = [];
        try { cl = typeof row.checklist === 'string' ? JSON.parse(row.checklist) : (row.checklist || []); } catch(e) {}
        for (var ci = 0; ci < cl.length; ci++) {
          var cItem = cl[ci];
          var cType = (cItem.type || 'Yes/No').toLowerCase().replace(/[\s\/]+/g, '_');
          if (ITEM_TYPES.indexOf(cType) === -1) cType = 'yes_no';
          await db.query(
            `INSERT INTO inspection_items (inspection_id, description, item_type, "order", response, deficient, deficiency_notes, requires_correction)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [row.id, cItem.description || '', cType, ci + 1, cItem.response || null,
             cItem.requires_correction || false, cItem.deficiency_notes || null, cItem.requires_correction || false]
          ).catch(function(){});
        }
      }
      // Update sequence
      await db.query(`SELECT setval('inspections_id_seq', (SELECT COALESCE(MAX(id), 0) FROM inspections))`).catch(function(){});
    }

    console.log('Inspection tables ready');
  } catch (err) {
    console.error('Inspection migration note:', err.message);
  }
})();

/* ── helpers ──────────────────────────────────────────── */
function validateProject(req, res, next) {
  var projectId = req.params.id || req.params.projectId || req.query.project_id;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(projectId);
  next();
}

async function enrichInspections(inspections) {
  if (!inspections.length) return inspections;
  var ids = inspections.map(function(i) { return i.id; });
  var itemsResult = await db.query(
    'SELECT * FROM inspection_items WHERE inspection_id = ANY($1) ORDER BY "order", id', [ids]
  );
  var itemMap = {};
  itemsResult.rows.forEach(function(item) {
    if (!itemMap[item.inspection_id]) itemMap[item.inspection_id] = [];
    itemMap[item.inspection_id].push(item);
  });
  return inspections.map(function(insp) {
    insp.items = itemMap[insp.id] || [];
    insp.deficiency_count = insp.items.filter(function(it) { return it.deficient || it.requires_correction; }).length;
    return insp;
  });
}

async function enrichTemplates(templates) {
  if (!templates.length) return templates;
  var ids = templates.map(function(t) { return t.id; });
  var itemsResult = await db.query(
    'SELECT * FROM inspection_template_items WHERE template_id = ANY($1) ORDER BY "order", id', [ids]
  );
  var itemMap = {};
  itemsResult.rows.forEach(function(item) {
    if (!itemMap[item.template_id]) itemMap[item.template_id] = [];
    itemMap[item.template_id].push(item);
  });
  return templates.map(function(tmpl) {
    tmpl.items = itemMap[tmpl.id] || [];
    return tmpl;
  });
}

async function computeDeficiencyCount(inspectionId) {
  var result = await db.query(
    'SELECT COUNT(*) AS cnt FROM inspection_items WHERE inspection_id = $1 AND (deficient = true OR requires_correction = true)',
    [inspectionId]
  );
  var count = Number(result.rows[0].cnt);
  await db.query('UPDATE inspections SET deficiency_count = $1 WHERE id = $2', [count, inspectionId]);
  return count;
}

async function notify(userId, type, title, message, link) {
  try {
    if (userId) await db.query('INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)', [userId, type, title, message || '', link || '']);
  } catch(e) {}
}

/* ══════════════════════════════════════════════════════
   INSPECTION TEMPLATES (company-level, no project scope)
   ══════════════════════════════════════════════════════ */

// GET /templates
router.get('/templates', authenticate, async function(req, res) {
  try {
    var result = await db.query('SELECT * FROM inspection_templates ORDER BY name');
    var enriched = await enrichTemplates(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /templates/:templateId
router.get('/templates/:templateId', authenticate, async function(req, res) {
  try {
    var result = await db.query('SELECT * FROM inspection_templates WHERE id = $1', [req.params.templateId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Template not found' });
    var enriched = await enrichTemplates(result.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /templates
router.post('/templates', authenticate, async function(req, res) {
  try {
    var { name, description, trade, items } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    var result = await db.query(
      'INSERT INTO inspection_templates (name, description, trade, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, description || null, trade || null, req.user.id]
    );
    var tmpl = result.rows[0];
    if (Array.isArray(items)) {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        await db.query(
          'INSERT INTO inspection_template_items (template_id, description, item_type, options, requires_photo, "order", section) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [tmpl.id, it.description, it.item_type || 'yes_no', it.options ? JSON.stringify(it.options) : null, it.requires_photo || false, it.order || i + 1, it.section || null]
        );
      }
    }
    var enriched = await enrichTemplates([tmpl]);
    res.status(201).json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /templates/:templateId
router.put('/templates/:templateId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM inspection_templates WHERE id = $1', [req.params.templateId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Template not found' });
    var { name, description, trade, items } = req.body;
    await db.query(
      'UPDATE inspection_templates SET name = COALESCE($1, name), description = COALESCE($2, description), trade = COALESCE($3, trade) WHERE id = $4',
      [name || null, description !== undefined ? description : null, trade !== undefined ? trade : null, req.params.templateId]
    );
    if (Array.isArray(items)) {
      await db.query('DELETE FROM inspection_template_items WHERE template_id = $1', [req.params.templateId]);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        await db.query(
          'INSERT INTO inspection_template_items (template_id, description, item_type, options, requires_photo, "order", section) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [req.params.templateId, it.description, it.item_type || 'yes_no', it.options ? JSON.stringify(it.options) : null, it.requires_photo || false, it.order || i + 1, it.section || null]
        );
      }
    }
    var updated = await db.query('SELECT * FROM inspection_templates WHERE id = $1', [req.params.templateId]);
    var enriched = await enrichTemplates(updated.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /templates/:templateId
router.delete('/templates/:templateId', authenticate, requireRole('admin'), async function(req, res) {
  try {
    var result = await db.query('DELETE FROM inspection_templates WHERE id = $1 RETURNING id', [req.params.templateId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ message: 'Template deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   INSPECTIONS (project-scoped)
   ══════════════════════════════════════════════════════ */

// GET / — list inspections for project
router.get('/', authenticate, validateProject, async function(req, res) {
  try {
    var { status, inspector_id, trade } = req.query;
    var where = 'WHERE i.project_id = $1';
    var params = [req.projectId];
    if (status) { params.push(status); where += ' AND i.status = $' + params.length; }
    if (inspector_id) { params.push(inspector_id); where += ' AND i.inspector_id = $' + params.length; }
    if (trade) { params.push(trade); where += ' AND i.trade = $' + params.length; }
    var result = await db.query(
      'SELECT i.*, u.name AS inspector_name, c.name AS created_by_name FROM inspections i ' +
      'LEFT JOIN users u ON u.id = i.inspector_id LEFT JOIN users c ON c.id = i.created_by ' +
      where + ' ORDER BY i.scheduled_date DESC NULLS LAST, i.created_at DESC',
      params
    );
    var enriched = await enrichInspections(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — create inspection (optionally from template)
router.post('/', authenticate, validateProject, async function(req, res) {
  try {
    var { title, description, type, template_id, inspector_id, trade, location, scheduled_date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });

    var result = await db.query(
      `INSERT INTO inspections (project_id, template_id, title, description, type, inspector_id, trade, location, scheduled_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.projectId, template_id || null, title, description || null, type || null,
       inspector_id || null, trade || null, location || null, scheduled_date || null, req.user.id]
    );
    var insp = result.rows[0];

    // If template_id, snapshot template items → inspection_items
    if (template_id) {
      var tmplItems = await db.query(
        'SELECT * FROM inspection_template_items WHERE template_id = $1 ORDER BY "order", id', [template_id]
      );
      for (var ti of tmplItems.rows) {
        await db.query(
          `INSERT INTO inspection_items (inspection_id, description, item_type, options, "order", section)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [insp.id, ti.description, ti.item_type, ti.options, ti.order, ti.section]
        );
      }
    }

    // If inline items provided (without template)
    if (!template_id && Array.isArray(req.body.items)) {
      for (var idx = 0; idx < req.body.items.length; idx++) {
        var it = req.body.items[idx];
        await db.query(
          `INSERT INTO inspection_items (inspection_id, description, item_type, options, "order", section)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [insp.id, it.description, it.item_type || 'yes_no', it.options ? JSON.stringify(it.options) : null, it.order || idx + 1, it.section || null]
        );
      }
    }

    await logChange({ tableName: 'inspections', recordId: insp.id, operation: 'CREATE', newValue: JSON.stringify({ title: title, type: type }), userId: req.user.id });
    if (inspector_id && inspector_id !== req.user.id) {
      notify(inspector_id, 'inspection_assigned', 'Inspection Assigned', 'You were assigned: ' + title, '/inspections');
    }
    var enriched = await enrichInspections([insp]);
    res.status(201).json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /bulk — bulk create from template
router.post('/bulk', authenticate, validateProject, async function(req, res) {
  try {
    var { template_id, copies, title, description, type, inspector_id, trade, location, scheduled_date } = req.body;
    if (!template_id || !copies || copies < 1) return res.status(400).json({ error: 'template_id and copies (>=1) required' });
    if (!title) return res.status(400).json({ error: 'title required' });
    if (copies > 50) return res.status(400).json({ error: 'Maximum 50 copies per bulk create' });

    var tmplItems = await db.query(
      'SELECT * FROM inspection_template_items WHERE template_id = $1 ORDER BY "order", id', [template_id]
    );

    var inspections = [];
    for (var c = 0; c < copies; c++) {
      var inspTitle = copies > 1 ? title + ' (' + (c + 1) + ' of ' + copies + ')' : title;
      var result = await db.query(
        `INSERT INTO inspections (project_id, template_id, title, description, type, inspector_id, trade, location, scheduled_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.projectId, template_id, inspTitle, description || null, type || null,
         inspector_id || null, trade || null, location || null, scheduled_date || null, req.user.id]
      );
      var insp = result.rows[0];
      for (var ti of tmplItems.rows) {
        await db.query(
          `INSERT INTO inspection_items (inspection_id, description, item_type, options, "order", section)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [insp.id, ti.description, ti.item_type, ti.options, ti.order, ti.section]
        );
      }
      inspections.push(insp);
    }
    var enriched = await enrichInspections(inspections);
    res.status(201).json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:inspId — single inspection
router.get('/:inspId', authenticate, async function(req, res) {
  try {
    var result = await db.query(
      'SELECT i.*, u.name AS inspector_name, c.name AS created_by_name FROM inspections i ' +
      'LEFT JOIN users u ON u.id = i.inspector_id LEFT JOIN users c ON c.id = i.created_by WHERE i.id = $1',
      [req.params.inspId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Inspection not found' });
    var enriched = await enrichInspections(result.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:inspId — update inspection header
router.put('/:inspId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM inspections WHERE id = $1', [req.params.inspId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Inspection not found' });
    var old = existing.rows[0];
    var { title, description, type, inspector_id, trade, location, scheduled_date } = req.body;
    await db.query(
      `UPDATE inspections SET title = COALESCE($1, title), description = COALESCE($2, description),
       type = COALESCE($3, type), inspector_id = COALESCE($4, inspector_id), trade = COALESCE($5, trade),
       location = COALESCE($6, location), scheduled_date = COALESCE($7, scheduled_date), updated_at = NOW() WHERE id = $8`,
      [title || null, description !== undefined ? description : null, type !== undefined ? type : null,
       inspector_id !== undefined ? inspector_id : null, trade !== undefined ? trade : null,
       location !== undefined ? location : null, scheduled_date !== undefined ? scheduled_date : null, req.params.inspId]
    );
    if (inspector_id && inspector_id !== old.inspector_id && inspector_id !== req.user.id) {
      notify(inspector_id, 'inspection_assigned', 'Inspection Assigned', 'You were assigned: ' + (title || old.title), '/inspections');
    }
    await logChange({ tableName: 'inspections', recordId: req.params.inspId, operation: 'UPDATE', userId: req.user.id });
    var updated = await db.query(
      'SELECT i.*, u.name AS inspector_name, c.name AS created_by_name FROM inspections i LEFT JOIN users u ON u.id = i.inspector_id LEFT JOIN users c ON c.id = i.created_by WHERE i.id = $1',
      [req.params.inspId]
    );
    var enriched = await enrichInspections(updated.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:inspId/status — status transition with validation
router.put('/:inspId/status', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM inspections WHERE id = $1', [req.params.inspId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Inspection not found' });
    var old = existing.rows[0];
    var { status } = req.body;
    if (!status || INSPECTION_STATUSES.indexOf(status) === -1) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: ' + INSPECTION_STATUSES.join(', ') });
    }
    var allowed = STATUS_TRANSITIONS[old.status] || [];
    if (allowed.indexOf(status) === -1) {
      return res.status(400).json({ error: 'Cannot transition from ' + old.status + ' to ' + status + '. Allowed: ' + allowed.join(', ') });
    }

    var updates = { status: status, updated_at: new Date() };

    // Auto-set timestamps
    if (status === 'in_progress' && !old.started_at) {
      updates.started_at = new Date();
    }
    if (status === 'passed' || status === 'closed') {
      updates.completed_at = new Date();
    }
    if (status === 'in_progress' && old.status === 'deficient') {
      updates.completed_at = null; // re-opened
    }

    // Validate: in_progress → passed requires all items non-deficient
    if (status === 'passed') {
      var defCount = await db.query(
        'SELECT COUNT(*) AS cnt FROM inspection_items WHERE inspection_id = $1 AND (deficient = true OR requires_correction = true) AND corrected_at IS NULL',
        [req.params.inspId]
      );
      if (Number(defCount.rows[0].cnt) > 0) {
        return res.status(400).json({ error: 'Cannot mark as passed — ' + defCount.rows[0].cnt + ' deficient items remain uncorrected' });
      }
    }

    var keys = Object.keys(updates);
    var setClause = keys.map(function(k, i) { return '"' + k + '" = $' + (i + 1); }).join(', ');
    var values = keys.map(function(k) { return updates[k]; });
    values.push(req.params.inspId);
    await db.query('UPDATE inspections SET ' + setClause + ' WHERE id = $' + values.length, values);

    await logChange({ tableName: 'inspections', recordId: req.params.inspId, operation: 'UPDATE', field_changed: 'status',
      oldValue: old.status, newValue: status, userId: req.user.id });
    await onStatusChange('inspection', req.params.inspId, status, req.projectId, req.user.id);

    var updated = await db.query(
      'SELECT i.*, u.name AS inspector_name FROM inspections i LEFT JOIN users u ON u.id = i.inspector_id WHERE i.id = $1',
      [req.params.inspId]
    );
    var enriched = await enrichInspections(updated.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:inspId/items/:itemId — record response for an inspection item
router.put('/:inspId/items/:itemId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM inspection_items WHERE id = $1 AND inspection_id = $2', [req.params.itemId, req.params.inspId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Inspection item not found' });
    var { response, deficient, deficiency_notes, requires_correction, corrected_at, photo_url } = req.body;
    await db.query(
      `UPDATE inspection_items SET
       response = COALESCE($1, response),
       deficient = COALESCE($2, deficient),
       deficiency_notes = COALESCE($3, deficiency_notes),
       requires_correction = COALESCE($4, requires_correction),
       corrected_at = COALESCE($5, corrected_at),
       photo_url = COALESCE($6, photo_url)
       WHERE id = $7`,
      [response !== undefined ? response : null, deficient !== undefined ? deficient : null,
       deficiency_notes !== undefined ? deficiency_notes : null, requires_correction !== undefined ? requires_correction : null,
       corrected_at !== undefined ? corrected_at : null, photo_url !== undefined ? photo_url : null, req.params.itemId]
    );
    // Recompute deficiency count
    await computeDeficiencyCount(req.params.inspId);
    var result = await db.query('SELECT * FROM inspection_items WHERE id = $1', [req.params.itemId]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:inspId/items — add ad-hoc item to inspection
router.post('/:inspId/items', authenticate, async function(req, res) {
  try {
    var insp = await db.query('SELECT id FROM inspections WHERE id = $1', [req.params.inspId]);
    if (!insp.rows.length) return res.status(404).json({ error: 'Inspection not found' });
    var { description, item_type, options, order, section } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });
    // Get next order
    if (!order) {
      var maxOrder = await db.query('SELECT COALESCE(MAX("order"), 0) + 1 AS next FROM inspection_items WHERE inspection_id = $1', [req.params.inspId]);
      order = maxOrder.rows[0].next;
    }
    var result = await db.query(
      'INSERT INTO inspection_items (inspection_id, description, item_type, options, "order", section) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.inspId, description, item_type || 'yes_no', options ? JSON.stringify(options) : null, order, section || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:inspId/items/:itemId
router.delete('/:inspId/items/:itemId', authenticate, async function(req, res) {
  try {
    var result = await db.query('DELETE FROM inspection_items WHERE id = $1 AND inspection_id = $2 RETURNING id', [req.params.itemId, req.params.inspId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });
    await computeDeficiencyCount(req.params.inspId);
    res.json({ message: 'Item deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:inspId
router.delete('/:inspId', authenticate, requireRole('admin'), async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM inspections WHERE id = $1', [req.params.inspId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Inspection not found' });
    await logChange({ tableName: 'inspections', recordId: req.params.inspId, operation: 'DELETE',
      oldValue: JSON.stringify({ title: existing.rows[0].title }), userId: req.user.id });
    await db.query('DELETE FROM inspections WHERE id = $1', [req.params.inspId]);
    res.json({ message: 'Inspection deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
