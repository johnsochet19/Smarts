const router = require('express').Router({ mergeParams: true });
const db = require('../db');

// ── Schema migration (IIFE) ───────────────────────────────────────────
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      entity_type VARCHAR(50) NOT NULL,
      entity_id INTEGER,
      action VARCHAR(50) NOT NULL,
      field_name VARCHAR(100),
      old_value TEXT,
      new_value TEXT,
      changed_by INTEGER REFERENCES users(id),
      changed_at TIMESTAMP DEFAULT NOW(),
      ip_address VARCHAR(45)
    )`);

    // Add columns that may be missing on older installs
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='audit_log'`)).rows.map(r => r.column_name);
    const add = async (col, def) => { if (!cols.includes(col)) await db.query(`ALTER TABLE audit_log ADD COLUMN ${col} ${def}`); };
    await add('ip_address', 'VARCHAR(45)');
    await add('entity_type', 'VARCHAR(50)');
    await add('entity_id', 'INTEGER');
    await add('action', 'VARCHAR(50)');
    await add('field_name', 'VARCHAR(100)');

    // Legacy migration: old changelog table → audit_log
    const clExists = (await db.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='changelog')`)).rows[0].exists;
    if (clExists) {
      const clCols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='changelog'`)).rows.map(r => r.column_name);
      // Map old columns → new: table_name→entity_type, record_id→entity_id, operation→action, field_changed→field_name
      const hasProjectId = clCols.includes('project_id');
      const timeCol = clCols.includes('changed_at') ? 'changed_at' : 'created_at';
      const userCol = clCols.includes('changed_by') ? 'changed_by' : 'user_id';

      // Only migrate rows that don't already exist (by checking max id)
      const maxMigrated = (await db.query(`SELECT COALESCE(MAX(id), 0) as m FROM audit_log WHERE entity_type IS NOT NULL`)).rows[0].m;
      const unmigrated = await db.query(`SELECT * FROM changelog WHERE id > $1 ORDER BY id LIMIT 5000`, [maxMigrated]);
      if (unmigrated.rows.length > 0) {
        for (const row of unmigrated.rows) {
          const actionMap = { CREATE: 'created', UPDATE: 'updated', DELETE: 'deleted', INSERT: 'created' };
          await db.query(
            `INSERT INTO audit_log (id, project_id, entity_type, entity_id, action, field_name, old_value, new_value, changed_by, changed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
            [
              row.id,
              hasProjectId ? row.project_id : null,
              (row.table_name || row.entity_type || 'unknown').toLowerCase(),
              row.record_id || row.entity_id || null,
              actionMap[(row.operation || row.action || '').toUpperCase()] || (row.operation || row.action || 'updated').toLowerCase(),
              row.field_changed || row.field_name || null,
              row.old_value || null,
              row.new_value || null,
              row[userCol] || null,
              row[timeCol] || new Date()
            ]
          );
        }
        // Reset sequence to max id
        await db.query(`SELECT setval('audit_log_id_seq', (SELECT COALESCE(MAX(id),1) FROM audit_log))`);
        console.log(`[audit_log] migrated ${unmigrated.rows.length} rows from changelog`);
      }
    }

    console.log('[audit_log] table ready');
  } catch (err) {
    console.error('[audit_log] migration error:', err.message);
  }
})();

// ── Constants ─────────────────────────────────────────────────────────
const ENTITY_TYPES = ['task', 'rfi', 'submittal', 'inspection', 'change_order', 'invoice', 'daily_log', 'permit', 'photo', 'document', 'meeting', 'incident', 'equipment', 'observation', 'punch_item', 'drawing', 'specification', 'correspondence', 'timesheet', 'company', 'user', 'project'];
const ACTIONS = ['created', 'updated', 'status_changed', 'deleted', 'commented', 'assigned', 'uploaded', 'approved', 'rejected', 'submitted'];

// ── Helpers ───────────────────────────────────────────────────────────
async function enrichRows(rows) {
  if (!rows.length) return rows;
  const userIds = [...new Set(rows.map(r => r.changed_by).filter(Boolean))];
  let userMap = {};
  if (userIds.length) {
    const { rows: users } = await db.query('SELECT id, name, email FROM users WHERE id = ANY($1)', [userIds]);
    users.forEach(u => { userMap[u.id] = u; });
  }
  return rows.map(r => ({
    ...r,
    changed_by_name: userMap[r.changed_by]?.name || null,
    changed_by_email: userMap[r.changed_by]?.email || null
  }));
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

// ── GET / — list audit log entries ────────────────────────────────────
router.get('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId;
    const { entity_type, action, entity_id, changed_by, from_date, to_date, search, limit: lim, offset: off } = req.query;
    const limit = Math.min(parseInt(lim) || 200, 1000);
    const offset = parseInt(off) || 0;

    let where = [];
    let params = [];
    let idx = 1;

    if (pid) { where.push(`a.project_id = $${idx++}`); params.push(pid); }
    if (entity_type) { where.push(`a.entity_type = $${idx++}`); params.push(entity_type.toLowerCase()); }
    if (action) { where.push(`a.action = $${idx++}`); params.push(action.toLowerCase()); }
    if (entity_id) { where.push(`a.entity_id = $${idx++}`); params.push(Number(entity_id)); }
    if (changed_by) { where.push(`a.changed_by = $${idx++}`); params.push(Number(changed_by)); }
    if (from_date) { where.push(`a.changed_at >= $${idx++}`); params.push(from_date); }
    if (to_date) { where.push(`a.changed_at <= $${idx++}::timestamp + interval '1 day'`); params.push(to_date); }
    if (search) {
      where.push(`(a.entity_type ILIKE $${idx} OR a.field_name ILIKE $${idx} OR a.old_value ILIKE $${idx} OR a.new_value ILIKE $${idx})`);
      params.push('%' + search + '%');
      idx++;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sql = `SELECT a.* FROM audit_log a ${whereClause} ORDER BY a.changed_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const { rows } = await db.query(sql, params);
    const enriched = await enrichRows(rows);

    // Total count for pagination
    const countSql = `SELECT COUNT(*) as total FROM audit_log a ${whereClause}`;
    const countParams = params.slice(0, params.length - 2); // Remove limit/offset
    const { rows: countRows } = await db.query(countSql, countParams);

    res.json({ rows: enriched, total: Number(countRows[0].total), limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /summary — audit stats ────────────────────────────────────────
router.get('/summary', validateProject, async (req, res) => {
  try {
    const pid = req.projectId;
    const pClause = pid ? 'WHERE project_id = $1' : '';
    const params = pid ? [pid] : [];

    const total = (await db.query(`SELECT COUNT(*) as c FROM audit_log ${pClause}`, params)).rows[0].c;
    const byEntity = (await db.query(`SELECT entity_type, COUNT(*) as count FROM audit_log ${pClause} GROUP BY entity_type ORDER BY count DESC`, params)).rows;
    const byAction = (await db.query(`SELECT action, COUNT(*) as count FROM audit_log ${pClause} GROUP BY action ORDER BY count DESC`, params)).rows;

    // Recent 7 days activity
    const pClause7 = pid ? 'WHERE project_id = $1 AND changed_at >= NOW() - interval \'7 days\'' : 'WHERE changed_at >= NOW() - interval \'7 days\'';
    const last7 = (await db.query(`SELECT COUNT(*) as c FROM audit_log ${pClause7}`, params)).rows[0].c;

    // Top contributors
    const topUsers = (await db.query(
      `SELECT a.changed_by, u.name, COUNT(*) as count FROM audit_log a LEFT JOIN users u ON a.changed_by = u.id ${pClause.replace('WHERE', 'WHERE a.')} ${pClause ? 'AND' : 'WHERE'} a.changed_by IS NOT NULL GROUP BY a.changed_by, u.name ORDER BY count DESC LIMIT 10`,
      params
    )).rows;

    res.json({ total: Number(total), last_7_days: Number(last7), by_entity: byEntity, by_action: byAction, top_contributors: topUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /entity/:entityType/:entityId — history for specific entity ───
router.get('/entity/:entityType/:entityId', validateProject, async (req, res) => {
  try {
    const pid = req.projectId;
    const { entityType, entityId } = req.params;
    let where = ['a.entity_type = $1', 'a.entity_id = $2'];
    let params = [entityType.toLowerCase(), Number(entityId)];
    let idx = 3;
    if (pid) { where.push(`a.project_id = $${idx++}`); params.push(pid); }

    const { rows } = await db.query(
      `SELECT a.* FROM audit_log a WHERE ${where.join(' AND ')} ORDER BY a.changed_at DESC LIMIT 500`,
      params
    );
    res.json(await enrichRows(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create audit log entry ──────────────────────────────────
router.post('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.body.project_id;
    const { entity_type, entity_id, action, field_name, old_value, new_value, changed_by } = req.body;

    if (!entity_type || !action) return res.status(400).json({ error: 'entity_type and action are required' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;

    const { rows } = await db.query(
      `INSERT INTO audit_log (project_id, entity_type, entity_id, action, field_name, old_value, new_value, changed_by, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [pid || null, entity_type.toLowerCase(), entity_id || null, action.toLowerCase(), field_name || null,
       old_value ? String(old_value) : null, new_value ? String(new_value) : null, changed_by || null, ip]
    );
    const enriched = await enrichRows(rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:logId — delete single entry (admin) ─────────────────────
router.delete('/:logId', validateProject, async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM audit_log WHERE id=$1 RETURNING id', [req.params.logId]);
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });
    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE / — bulk delete (admin) ───────────────────────────────────
router.delete('/', validateProject, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    const { rows } = await db.query('DELETE FROM audit_log WHERE id = ANY($1) RETURNING id', [ids]);
    res.json({ deleted: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /types — available entity types ──────────────────────────────
router.get('/types', (req, res) => {
  res.json({ entity_types: ENTITY_TYPES, actions: ACTIONS });
});

module.exports = router;
