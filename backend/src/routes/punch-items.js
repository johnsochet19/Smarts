var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { logChange } = require('../db/changelog');
var { authenticate, requireRole } = require('../middleware/auth');
var { runAutomationsForEvent } = require('../automation/runner');

/* ── constants ───────────────────────────────────────── */
var PUNCH_TYPES = ['quality', 'safety', 'commissioning', 'warranty', 'general'];
var PUNCH_STATUSES = ['draft', 'open', 'in_progress', 'ready_for_review', 'closed'];
var PUNCH_PRIORITIES = ['low', 'normal', 'high'];

var STATUS_TRANSITIONS = {
  draft:            ['open'],
  open:             ['in_progress', 'closed'],            // admin can skip to closed
  in_progress:      ['ready_for_review'],
  ready_for_review: ['closed', 'in_progress'],            // approver sends back or closes
  closed:           []
};

/* ── auto-migrate ────────────────────────────────────── */
(async function () {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS punch_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      punch_number INTEGER,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      type VARCHAR(50) DEFAULT 'general',
      status VARCHAR(30) DEFAULT 'open',
      priority VARCHAR(20) DEFAULT 'normal',
      assignee_id INTEGER REFERENCES users(id),
      trade VARCHAR(100),
      location VARCHAR(255),
      due_date DATE,
      closed_date TIMESTAMP,
      final_approver_id INTEGER REFERENCES users(id),
      cost_impact BOOLEAN DEFAULT false,
      cost_amount DECIMAL(12,2),
      linked_inspection_id INTEGER,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS punch_item_photos (
      id SERIAL PRIMARY KEY,
      punch_item_id INTEGER REFERENCES punch_items(id) ON DELETE CASCADE,
      photo_url VARCHAR(500),
      caption TEXT,
      taken_at TIMESTAMP,
      uploaded_by INTEGER REFERENCES users(id)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS punch_item_comments (
      id SERIAL PRIMARY KEY,
      punch_item_id INTEGER REFERENCES punch_items(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    /* ── legacy migrations from old punch_list table ── */
    var hasOld = await db.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'punch_list')`);
    if (hasOld.rows[0].exists) {
      var oldRows = await db.query('SELECT * FROM punch_list').catch(function() { return { rows: [] }; });
      for (var row of oldRows.rows) {
        var exists = await db.query('SELECT id FROM punch_items WHERE id = $1', [row.id]);
        if (exists.rows.length) continue;
        // Map status/type/priority to lowercase
        var st = (row.status || 'Draft').toLowerCase().replace(/\s+/g, '_');
        if (PUNCH_STATUSES.indexOf(st) === -1) st = 'open';
        var tp = (row.type || 'Quality').toLowerCase();
        if (PUNCH_TYPES.indexOf(tp) === -1) tp = 'general';
        var pr = (row.priority || 'Normal').toLowerCase();
        if (PUNCH_PRIORITIES.indexOf(pr) === -1) pr = 'normal';
        await db.query(
          `INSERT INTO punch_items (id, project_id, title, description, type, status, priority, assignee_id, trade, location, due_date, closed_date, final_approver_id, cost_impact, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [row.id, row.project_id, row.title, row.description, tp, st, pr, row.assignee_id, row.trade, row.location, row.due_date,
           row.closed_date ? new Date(row.closed_date) : null, row.final_approver_id, row.cost_impact || false, row.created_by, row.created_at, row.updated_at]
        ).catch(function(){});
      }
      await db.query(`SELECT setval('punch_items_id_seq', (SELECT COALESCE(MAX(id), 0) FROM punch_items))`).catch(function(){});
    }

    // Add new columns to punch_items if missing
    await db.query(`ALTER TABLE punch_items ADD COLUMN IF NOT EXISTS punch_number INTEGER`).catch(function(){});
    await db.query(`ALTER TABLE punch_items ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(12,2)`).catch(function(){});
    await db.query(`ALTER TABLE punch_items ADD COLUMN IF NOT EXISTS linked_inspection_id INTEGER`).catch(function(){});
    // Field-team features: GPS tagging on items, voice/photo media type on attachments
    await db.query(`ALTER TABLE punch_items ADD COLUMN IF NOT EXISTS gps_lat DECIMAL(10,7)`).catch(function(){});
    await db.query(`ALTER TABLE punch_items ADD COLUMN IF NOT EXISTS gps_lng DECIMAL(10,7)`).catch(function(){});
    await db.query(`ALTER TABLE punch_item_photos ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'photo'`).catch(function(){});

    // Backfill punch_number for existing rows
    await db.query(`
      UPDATE punch_items SET punch_number = sub.rn
      FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY id) AS rn FROM punch_items WHERE punch_number IS NULL) sub
      WHERE punch_items.id = sub.id
    `).catch(function(){});

    // Migrate status/type/priority to lowercase
    await db.query(`UPDATE punch_items SET status = LOWER(REPLACE(status, ' ', '_')) WHERE status != LOWER(REPLACE(status, ' ', '_'))`).catch(function(){});
    await db.query(`UPDATE punch_items SET type = LOWER(type) WHERE type != LOWER(type)`).catch(function(){});
    await db.query(`UPDATE punch_items SET priority = LOWER(priority) WHERE priority != LOWER(priority)`).catch(function(){});

    console.log('Punch items tables ready');
  } catch (err) {
    console.error('Punch items migration note:', err.message);
  }
})();

/* ── helpers ──────────────────────────────────────────── */
function validateProject(req, res, next) {
  var projectId = req.params.id || req.params.projectId || req.query.project_id;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(projectId);
  next();
}

async function getNextPunchNumber(projectId) {
  var result = await db.query('SELECT COALESCE(MAX(punch_number), 0) + 1 AS next FROM punch_items WHERE project_id = $1', [projectId]);
  return result.rows[0].next;
}

async function enrichPunchItems(items) {
  if (!items.length) return items;
  var ids = items.map(function(i) { return i.id; });
  var photosResult = await db.query(
    'SELECT * FROM punch_item_photos WHERE punch_item_id = ANY($1) ORDER BY id', [ids]
  );
  var photoMap = {};
  photosResult.rows.forEach(function(p) {
    if (!photoMap[p.punch_item_id]) photoMap[p.punch_item_id] = [];
    photoMap[p.punch_item_id].push(p);
  });
  // related_items from universal table
  var relResult = await db.query(
    `SELECT * FROM related_items WHERE (source_type = 'punch_item' AND source_id = ANY($1)) OR (target_type = 'punch_item' AND target_id = ANY($1))`, [ids]
  ).catch(function() { return { rows: [] }; });
  var relMap = {};
  relResult.rows.forEach(function(r) {
    var key = r.source_type === 'punch_item' ? r.source_id : r.target_id;
    if (!relMap[key]) relMap[key] = [];
    relMap[key].push(r);
  });
  return items.map(function(item) {
    item.photos = photoMap[item.id] || [];
    item.related_items = relMap[item.id] || [];
    return item;
  });
}

async function notify(userId, type, title, message, link) {
  try {
    if (userId) await db.query('INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)', [userId, type, title, message || '', link || '']);
  } catch(e) {}
}

/* ── routes ───────────────────────────────────────────── */

// GET / — list punch items for project
router.get('/', authenticate, validateProject, async function(req, res) {
  try {
    var { status, priority, assignee_id, trade, linked_inspection_id } = req.query;
    var where = 'WHERE p.project_id = $1';
    var params = [req.projectId];
    if (status) { params.push(status); where += ' AND p.status = $' + params.length; }
    if (priority) { params.push(priority); where += ' AND p.priority = $' + params.length; }
    if (assignee_id) { params.push(assignee_id); where += ' AND p.assignee_id = $' + params.length; }
    if (trade) { params.push(trade); where += ' AND p.trade = $' + params.length; }
    if (linked_inspection_id) { params.push(linked_inspection_id); where += ' AND p.linked_inspection_id = $' + params.length; }
    var result = await db.query(
      'SELECT p.*, u.name AS assignee_name, a.name AS approver_name, c.name AS created_by_name FROM punch_items p ' +
      'LEFT JOIN users u ON u.id = p.assignee_id LEFT JOIN users a ON a.id = p.final_approver_id LEFT JOIN users c ON c.id = p.created_by ' +
      where + ' ORDER BY p.punch_number DESC NULLS LAST, p.created_at DESC',
      params
    );
    var enriched = await enrichPunchItems(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — create punch item
router.post('/', authenticate, validateProject, async function(req, res) {
  try {
    var { title, description, type, priority, assignee_id, trade, location, due_date,
          final_approver_id, cost_impact, cost_amount, linked_inspection_id, gps_lat, gps_lng } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    if (type && PUNCH_TYPES.indexOf(type) === -1) {
      return res.status(400).json({ error: 'Invalid type. Must be one of: ' + PUNCH_TYPES.join(', ') });
    }
    if (priority && PUNCH_PRIORITIES.indexOf(priority) === -1) {
      return res.status(400).json({ error: 'Invalid priority. Must be one of: ' + PUNCH_PRIORITIES.join(', ') });
    }
    var punchNumber = await getNextPunchNumber(req.projectId);
    var result = await db.query(
      `INSERT INTO punch_items (project_id, punch_number, title, description, type, status, priority,
       assignee_id, trade, location, due_date, final_approver_id, cost_impact, cost_amount, linked_inspection_id, created_by, gps_lat, gps_lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [req.projectId, punchNumber, title, description || null, type || 'general', 'open',
       priority || 'normal', assignee_id || null, trade || null, location || null, due_date || null,
       final_approver_id || null, cost_impact || false, cost_amount || null, linked_inspection_id || null, req.user.id,
       (gps_lat !== undefined && gps_lat !== null && gps_lat !== '') ? gps_lat : null,
       (gps_lng !== undefined && gps_lng !== null && gps_lng !== '') ? gps_lng : null]
    );
    var item = result.rows[0];
    await logChange({ tableName: 'punch_items', recordId: item.id, operation: 'CREATE', newValue: JSON.stringify({ title: title, punch_number: punchNumber }), userId: req.user.id });
    if (assignee_id && assignee_id !== req.user.id) {
      notify(assignee_id, 'punch_assigned', 'Punch Item Assigned', 'You were assigned: #' + punchNumber + ' ' + title, '/punch-list');
    }
    var enriched = await enrichPunchItems([item]);
    res.status(201).json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:punchId
router.get('/:punchId', authenticate, async function(req, res) {
  try {
    var result = await db.query(
      'SELECT p.*, u.name AS assignee_name, a.name AS approver_name, c.name AS created_by_name FROM punch_items p ' +
      'LEFT JOIN users u ON u.id = p.assignee_id LEFT JOIN users a ON a.id = p.final_approver_id LEFT JOIN users c ON c.id = p.created_by WHERE p.id = $1',
      [req.params.punchId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Punch item not found' });
    var enriched = await enrichPunchItems(result.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:punchId — update punch item (header fields only, not status)
router.put('/:punchId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM punch_items WHERE id = $1', [req.params.punchId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Punch item not found' });
    var old = existing.rows[0];
    var { title, description, type, priority, assignee_id, trade, location, due_date,
          final_approver_id, cost_impact, cost_amount, linked_inspection_id, gps_lat, gps_lng } = req.body;
    if (type && PUNCH_TYPES.indexOf(type) === -1) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    if (priority && PUNCH_PRIORITIES.indexOf(priority) === -1) {
      return res.status(400).json({ error: 'Invalid priority' });
    }
    await db.query(
      `UPDATE punch_items SET
       title = COALESCE($1, title), description = COALESCE($2, description), type = COALESCE($3, type),
       priority = COALESCE($4, priority), assignee_id = COALESCE($5, assignee_id), trade = COALESCE($6, trade),
       location = COALESCE($7, location), due_date = COALESCE($8, due_date), final_approver_id = COALESCE($9, final_approver_id),
       cost_impact = COALESCE($10, cost_impact), cost_amount = COALESCE($11, cost_amount),
       linked_inspection_id = COALESCE($12, linked_inspection_id),
       gps_lat = COALESCE($14, gps_lat), gps_lng = COALESCE($15, gps_lng),
       updated_at = NOW() WHERE id = $13`,
      [title || null, description !== undefined ? description : null, type || null,
       priority || null, assignee_id !== undefined ? assignee_id : null, trade !== undefined ? trade : null,
       location !== undefined ? location : null, due_date !== undefined ? due_date : null,
       final_approver_id !== undefined ? final_approver_id : null,
       cost_impact !== undefined ? cost_impact : null, cost_amount !== undefined ? cost_amount : null,
       linked_inspection_id !== undefined ? linked_inspection_id : null, req.params.punchId,
       (gps_lat !== undefined && gps_lat !== null && gps_lat !== '') ? gps_lat : null,
       (gps_lng !== undefined && gps_lng !== null && gps_lng !== '') ? gps_lng : null]
    );
    if (assignee_id && assignee_id !== old.assignee_id && assignee_id !== req.user.id) {
      notify(assignee_id, 'punch_assigned', 'Punch Item Assigned', 'You were assigned: #' + old.punch_number + ' ' + (title || old.title), '/punch-list');
    }
    await logChange({ tableName: 'punch_items', recordId: req.params.punchId, operation: 'UPDATE', userId: req.user.id });
    var updated = await db.query(
      'SELECT p.*, u.name AS assignee_name, a.name AS approver_name FROM punch_items p LEFT JOIN users u ON u.id = p.assignee_id LEFT JOIN users a ON a.id = p.final_approver_id WHERE p.id = $1',
      [req.params.punchId]
    );
    var enriched = await enrichPunchItems(updated.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:punchId/status — status transition with validation
router.put('/:punchId/status', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM punch_items WHERE id = $1', [req.params.punchId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Punch item not found' });
    var old = existing.rows[0];
    var { status } = req.body;
    if (!status || PUNCH_STATUSES.indexOf(status) === -1) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: ' + PUNCH_STATUSES.join(', ') });
    }
    var allowed = STATUS_TRANSITIONS[old.status] || [];
    if (allowed.indexOf(status) === -1) {
      return res.status(400).json({ error: 'Cannot transition from ' + old.status + ' to ' + status + '. Allowed: ' + allowed.join(', ') });
    }

    // Validate: ready_for_review → closed requires final_approver_id match or admin
    if (status === 'closed' && old.status === 'ready_for_review') {
      if (old.final_approver_id && old.final_approver_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Only the final approver or an admin can close this item' });
      }
    }

    var updates = { status: status, updated_at: new Date() };
    if (status === 'closed') {
      updates.closed_date = new Date();
    }
    if (status !== 'closed' && old.status === 'closed') {
      updates.closed_date = null;
    }

    var keys = Object.keys(updates);
    var setClause = keys.map(function(k, i) { return k + ' = $' + (i + 1); }).join(', ');
    var values = keys.map(function(k) { return updates[k]; });
    values.push(req.params.punchId);
    await db.query('UPDATE punch_items SET ' + setClause + ' WHERE id = $' + values.length, values);

    await logChange({ tableName: 'punch_items', recordId: req.params.punchId, operation: 'UPDATE', field_changed: 'status',
      oldValue: old.status, newValue: status, userId: req.user.id });

    // Notify final approver when item is ready for review
    if (status === 'ready_for_review' && old.final_approver_id && old.final_approver_id !== req.user.id) {
      notify(old.final_approver_id, 'punch_review', 'Punch Item Ready for Review', '#' + old.punch_number + ' ' + old.title + ' is ready for your review', '/punch-list');
    }
    // Notify assignee when sent back
    if (status === 'in_progress' && old.status === 'ready_for_review' && old.assignee_id && old.assignee_id !== req.user.id) {
      notify(old.assignee_id, 'punch_returned', 'Punch Item Returned', '#' + old.punch_number + ' ' + old.title + ' was sent back for corrections', '/punch-list');
    }

    // Fire automations for the status change (non-blocking, never breaks the flow)
    runAutomationsForEvent(old.project_id, { type: 'status_changed', resource: 'punch_item' },
      { record: { ...old, status: status }, oldRecord: old });

    var updated = await db.query(
      'SELECT p.*, u.name AS assignee_name, a.name AS approver_name FROM punch_items p LEFT JOIN users u ON u.id = p.assignee_id LEFT JOIN users a ON a.id = p.final_approver_id WHERE p.id = $1',
      [req.params.punchId]
    );
    var enriched = await enrichPunchItems(updated.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:punchId
router.delete('/:punchId', authenticate, requireRole('admin'), async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM punch_items WHERE id = $1', [req.params.punchId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Punch item not found' });
    await logChange({ tableName: 'punch_items', recordId: req.params.punchId, operation: 'DELETE',
      oldValue: JSON.stringify({ title: existing.rows[0].title, punch_number: existing.rows[0].punch_number }), userId: req.user.id });
    await db.query('DELETE FROM punch_items WHERE id = $1', [req.params.punchId]);
    res.json({ message: 'Punch item deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── punch_item_photos sub-resource ──────────────────── */

// POST /:punchId/photos
router.post('/:punchId/photos', authenticate, async function(req, res) {
  try {
    var insp = await db.query('SELECT id FROM punch_items WHERE id = $1', [req.params.punchId]);
    if (!insp.rows.length) return res.status(404).json({ error: 'Punch item not found' });
    var { photo_url, caption, taken_at, media_type } = req.body;
    if (!photo_url) return res.status(400).json({ error: 'photo_url required' });
    var mediaType = (media_type === 'voice') ? 'voice' : 'photo';
    var result = await db.query(
      'INSERT INTO punch_item_photos (punch_item_id, photo_url, caption, taken_at, uploaded_by, media_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.punchId, photo_url, caption || null, taken_at || null, req.user.id, mediaType]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:punchId/photos/:photoId
router.delete('/:punchId/photos/:photoId', authenticate, async function(req, res) {
  try {
    var result = await db.query('DELETE FROM punch_item_photos WHERE id = $1 AND punch_item_id = $2 RETURNING id', [req.params.photoId, req.params.punchId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Photo not found' });
    res.json({ message: 'Photo deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── comments sub-resource ───────────────────────────── */

// GET /:punchId/comments
router.get('/:punchId/comments', authenticate, async function(req, res) {
  try {
    var result = await db.query(
      `SELECT c.*, u.name AS user_name FROM punch_item_comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.punch_item_id = $1 ORDER BY c.created_at ASC`,
      [req.params.punchId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:punchId/comments
router.post('/:punchId/comments', authenticate, async function(req, res) {
  try {
    var item = await db.query('SELECT id FROM punch_items WHERE id = $1', [req.params.punchId]);
    if (!item.rows.length) return res.status(404).json({ error: 'Punch item not found' });
    var comment = req.body && req.body.comment;
    if (!comment || !String(comment).trim()) return res.status(400).json({ error: 'comment required' });
    var result = await db.query(
      'INSERT INTO punch_item_comments (punch_item_id, user_id, comment) VALUES ($1,$2,$3) RETURNING *',
      [req.params.punchId, req.user.id, String(comment).trim()]
    );
    var row = result.rows[0];
    row.user_name = req.user.name || null;
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:punchId/comments/:commentId — author or admin only
router.delete('/:punchId/comments/:commentId', authenticate, async function(req, res) {
  try {
    var isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    var result = isAdmin
      ? await db.query('DELETE FROM punch_item_comments WHERE id = $1 AND punch_item_id = $2 RETURNING id', [req.params.commentId, req.params.punchId])
      : await db.query('DELETE FROM punch_item_comments WHERE id = $1 AND punch_item_id = $2 AND user_id = $3 RETURNING id', [req.params.commentId, req.params.punchId, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Comment not found' });
    res.json({ message: 'Comment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
