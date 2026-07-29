const router = require('express').Router({ mergeParams: true });
const db = require('../db');

// ── Schema (table created in tasks.js IIFE, but ensure it exists) ─────
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS related_items (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(50) NOT NULL,
      source_id INTEGER NOT NULL,
      target_type VARCHAR(50) NOT NULL,
      target_id INTEGER NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(source_type, source_id, target_type, target_id)
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_related_items_source ON related_items(source_type, source_id)').catch(() => {});
    await db.query('CREATE INDEX IF NOT EXISTS idx_related_items_target ON related_items(target_type, target_id)').catch(() => {});
    console.log('[related_items] table ready');
  } catch (err) {
    console.error('[related_items] migration error:', err.message);
  }
})();

// ── Constants ─────────────────────────────────────────────────────────
const ENTITY_TYPES = [
  'task', 'rfi', 'submittal', 'inspection', 'change_order', 'invoice',
  'daily_log', 'permit', 'photo', 'document', 'meeting', 'incident',
  'equipment', 'observation', 'punch_item', 'drawing', 'specification',
  'correspondence', 'timesheet', 'company'
];

// ── Shared helper functions (importable by other routes) ──────────────

// Link any two entities together (idempotent via ON CONFLICT)
async function linkItems(sourceType, sourceId, targetType, targetId, userId) {
  try {
    const { rows } = await db.query(
      `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source_type, source_id, target_type, target_id) DO NOTHING
       RETURNING *`,
      [sourceType, sourceId, targetType, targetId, userId || null]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[related_items] linkItems error:', err.message);
    return null;
  }
}

// Get all related items for an entity (both directions)
async function getRelatedItems(entityType, entityId) {
  const { rows } = await db.query(
    `SELECT * FROM related_items
     WHERE (source_type = $1 AND source_id = $2)
        OR (target_type = $1 AND target_id = $2)
     ORDER BY created_at DESC`,
    [entityType, entityId]
  );
  return rows;
}

// Bulk get related items for multiple entities of the same type
async function getRelatedItemsBatch(entityType, entityIds) {
  if (!entityIds.length) return {};
  const { rows } = await db.query(
    `SELECT * FROM related_items
     WHERE (source_type = $1 AND source_id = ANY($2))
        OR (target_type = $1 AND target_id = ANY($2))
     ORDER BY created_at DESC`,
    [entityType, entityIds]
  );
  // Build map: entityId → [related_items]
  const map = {};
  for (const row of rows) {
    const key = (row.source_type === entityType && entityIds.includes(row.source_id))
      ? row.source_id : row.target_id;
    if (!map[key]) map[key] = [];
    map[key].push(row);
  }
  return map;
}

// Unlink two entities
async function unlinkItems(sourceType, sourceId, targetType, targetId) {
  const { rowCount } = await db.query(
    `DELETE FROM related_items
     WHERE (source_type = $1 AND source_id = $2 AND target_type = $3 AND target_id = $4)
        OR (source_type = $3 AND source_id = $4 AND target_type = $1 AND target_id = $2)`,
    [sourceType, sourceId, targetType, targetId]
  );
  return rowCount > 0;
}

// Replace all related items for an entity
async function replaceRelatedItems(entityType, entityId, items, userId) {
  await db.query(
    `DELETE FROM related_items WHERE source_type = $1 AND source_id = $2`,
    [entityType, entityId]
  );
  const created = [];
  for (const item of (items || [])) {
    const targetType = item.target_type || item.type;
    const targetId = item.target_id || item.id;
    if (!targetType || !targetId) continue;
    const linked = await linkItems(entityType, entityId, targetType, targetId, userId);
    if (linked) created.push(linked);
  }
  return created;
}

// ── Middleware: validate project ───────────────────────────────────────
async function validateProject(req, res, next) {
  const pid = req.params.id;
  if (!pid) return next();
  const { rows } = await db.query('SELECT id FROM projects WHERE id=$1', [pid]);
  if (!rows.length) return res.status(404).json({ error: 'Project not found' });
  req.projectId = Number(pid);
  next();
}

// ── Enrichment: add entity names/titles for display ───────────────────
async function enrichRelatedItems(rows) {
  if (!rows.length) return rows;

  // Collect all unique entity references
  const refs = {};
  for (const r of rows) {
    for (const [type, id] of [[r.source_type, r.source_id], [r.target_type, r.target_id]]) {
      if (!refs[type]) refs[type] = new Set();
      refs[type].add(id);
    }
  }

  // Fetch names/titles for each entity type
  const nameMap = {};
  const tableMap = {
    task: { table: 'tasks', nameCol: "COALESCE(title, name, 'Task #' || id)" },
    rfi: { table: 'rfis', nameCol: "'RFI #' || rfi_number || ': ' || subject" },
    submittal: { table: 'submittals', nameCol: "'Submittal #' || submittal_number || ': ' || title" },
    inspection: { table: 'inspections', nameCol: 'title' },
    change_order: { table: 'change_orders', nameCol: "'CO #' || COALESCE(number::text, id::text) || ': ' || title" },
    invoice: { table: 'invoices', nameCol: "'Invoice #' || COALESCE(number, id::text)" },
    daily_log: { table: 'daily_logs', nameCol: "'Daily Log ' || log_date" },
    permit: { table: 'permits', nameCol: "COALESCE(permit_number, '') || ' - ' || COALESCE(title, type)" },
    photo: { table: 'photos', nameCol: "COALESCE(caption, 'Photo #' || id)" },
    document: { table: 'documents', nameCol: 'name' },
    meeting: { table: 'meetings', nameCol: 'title' },
    incident: { table: 'incidents', nameCol: 'title' },
    equipment: { table: 'equipment', nameCol: 'name' },
    observation: { table: 'observations', nameCol: "COALESCE(title, 'Observation #' || id)" },
    punch_item: { table: 'punch_items', nameCol: "COALESCE(title, 'Punch #' || id)" },
    drawing: { table: 'drawings', nameCol: "COALESCE(title, drawing_number)" },
    specification: { table: 'specifications', nameCol: "COALESCE(title, section_number)" },
    correspondence: { table: 'correspondence', nameCol: 'subject' },
    timesheet: { table: 'timesheets', nameCol: "'Timesheet ' || work_date" },
    company: { table: 'companies', nameCol: 'name' },
  };

  for (const [entityType, ids] of Object.entries(refs)) {
    const config = tableMap[entityType];
    if (!config) continue;
    const idArr = [...ids];
    try {
      const { rows: entities } = await db.query(
        `SELECT id, ${config.nameCol} AS display_name FROM ${config.table} WHERE id = ANY($1)`,
        [idArr]
      );
      for (const e of entities) {
        nameMap[`${entityType}:${e.id}`] = e.display_name;
      }
    } catch (e) {
      // Table may not exist yet — skip
    }
  }

  // Attach display names
  return rows.map(r => ({
    ...r,
    source_display: nameMap[`${r.source_type}:${r.source_id}`] || `${r.source_type} #${r.source_id}`,
    target_display: nameMap[`${r.target_type}:${r.target_id}`] || `${r.target_type} #${r.target_id}`
  }));
}

// ── GET / — list all links for a project (or globally) ────────────────
router.get('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId;
    const { entity_type, entity_id, limit: lim, offset: off } = req.query;
    const limit = Math.min(parseInt(lim) || 100, 500);
    const offset = parseInt(off) || 0;

    if (entity_type && entity_id) {
      // Get all links for a specific entity
      const rows = await getRelatedItems(entity_type, Number(entity_id));
      const enriched = await enrichRelatedItems(rows);
      return res.json(enriched);
    }

    // Otherwise: list all (optionally project-scoped by matching entity IDs)
    // For simplicity, return recent links
    let sql = `SELECT * FROM related_items ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
    let params = [limit, offset];

    const { rows } = await db.query(sql, params);
    const enriched = await enrichRelatedItems(rows);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create a link between two entities ──────────────────────
router.post('/', validateProject, async (req, res) => {
  try {
    const { source_type, source_id, target_type, target_id } = req.body;

    if (!source_type || !source_id || !target_type || !target_id) {
      return res.status(400).json({ error: 'source_type, source_id, target_type, target_id required' });
    }
    if (!ENTITY_TYPES.includes(source_type) || !ENTITY_TYPES.includes(target_type)) {
      return res.status(400).json({ error: 'Invalid entity type. Must be one of: ' + ENTITY_TYPES.join(', ') });
    }
    if (source_type === target_type && Number(source_id) === Number(target_id)) {
      return res.status(400).json({ error: 'Cannot link an entity to itself' });
    }

    const userId = req.user?.id || req.body.created_by || null;
    const linked = await linkItems(source_type, Number(source_id), target_type, Number(target_id), userId);

    if (!linked) {
      // Already exists (ON CONFLICT DO NOTHING)
      const existing = await getRelatedItems(source_type, Number(source_id));
      const match = existing.find(r =>
        (r.target_type === target_type && r.target_id === Number(target_id)) ||
        (r.source_type === target_type && r.source_id === Number(target_id))
      );
      if (match) return res.json(match);
      return res.status(409).json({ error: 'Link already exists' });
    }

    const enriched = await enrichRelatedItems([linked]);
    res.status(201).json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:linkId — remove a specific link by ID ───────────────────
router.delete('/:linkId', validateProject, async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM related_items WHERE id = $1 RETURNING *', [req.params.linkId]);
    if (!rows.length) return res.status(404).json({ error: 'Link not found' });
    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE / — unlink two specific entities ───────────────────────────
router.delete('/', validateProject, async (req, res) => {
  try {
    const { source_type, source_id, target_type, target_id } = req.body;
    if (!source_type || !source_id || !target_type || !target_id) {
      return res.status(400).json({ error: 'source_type, source_id, target_type, target_id required' });
    }
    const removed = await unlinkItems(source_type, Number(source_id), target_type, Number(target_id));
    res.json({ deleted: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /types — list valid entity types ─────────────────────────────
router.get('/types', (req, res) => {
  res.json({ entity_types: ENTITY_TYPES });
});

module.exports = router;
module.exports.linkItems = linkItems;
module.exports.getRelatedItems = getRelatedItems;
module.exports.getRelatedItemsBatch = getRelatedItemsBatch;
module.exports.unlinkItems = unlinkItems;
module.exports.replaceRelatedItems = replaceRelatedItems;
module.exports.enrichRelatedItems = enrichRelatedItems;
