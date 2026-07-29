const router = require('express').Router({ mergeParams: true });
const db = require('../db');

// ── Schema migration (IIFE) ───────────────────────────────────────────
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL DEFAULT 'info',
      entity_type VARCHAR(50),
      entity_id INTEGER,
      title TEXT,
      message TEXT DEFAULT '',
      link VARCHAR(255) DEFAULT '',
      read BOOLEAN DEFAULT false,
      read_at TIMESTAMP,
      sent_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Add columns that may be missing on older installs
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='notifications'`)).rows.map(r => r.column_name);
    const add = async (col, def) => { if (!cols.includes(col)) await db.query(`ALTER TABLE notifications ADD COLUMN ${col} ${def}`); };
    await add('project_id', 'INTEGER REFERENCES projects(id) ON DELETE CASCADE');
    await add('entity_type', 'VARCHAR(50)');
    await add('entity_id', 'INTEGER');
    await add('read', 'BOOLEAN DEFAULT false');
    await add('read_at', 'TIMESTAMP');
    await add('sent_at', 'TIMESTAMP DEFAULT NOW()');
    await add('title', 'TEXT');
    await add('link', 'VARCHAR(255) DEFAULT \'\'');

    // Legacy migration: is_read → read
    if (cols.includes('is_read') && cols.includes('read')) {
      await db.query(`UPDATE notifications SET read = is_read WHERE read IS NULL OR read != is_read`);
    } else if (cols.includes('is_read') && !cols.includes('read')) {
      // read column just added, copy from is_read
      await db.query(`UPDATE notifications SET read = is_read`);
    }

    console.log('[notifications] table ready');
  } catch (err) {
    console.error('[notifications] migration error:', err.message);
  }
})();

// ── Constants ─────────────────────────────────────────────────────────
const NOTIFICATION_TYPES = [
  'rfi_due', 'ball_in_court', 'submittal_returned', 'inspection_deficient',
  'change_order_approved', 'invoice_submitted', 'task_assigned', 'permit_expiring',
  'daily_log_due', 'meeting_scheduled', 'incident_reported', 'document_uploaded',
  'status_change', 'due_soon', 'overdue', 'mention', 'comment', 'info'
];

// ── Helpers ───────────────────────────────────────────────────────────
function readCol() {
  // Handle both 'read' and 'is_read' column names for backward compat
  return 'read';
}

async function enrichRows(rows) {
  if (!rows.length) return rows;
  const projectIds = [...new Set(rows.map(r => r.project_id).filter(Boolean))];
  let projMap = {};
  if (projectIds.length) {
    const { rows: projects } = await db.query('SELECT id, name FROM projects WHERE id = ANY($1)', [projectIds]);
    projects.forEach(p => { projMap[p.id] = p; });
  }
  return rows.map(r => ({
    ...r,
    is_read: r.read || r.is_read || false, // backward compat field
    project_name: projMap[r.project_id]?.name || null
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

// Helper: get user from auth header (lightweight, no middleware dep)
function getUserId(req) {
  // Try req.user first (from auth middleware), fall back to header
  if (req.user?.id) return req.user.id;
  try {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'secret');
      return decoded.id || decoded.userId;
    }
  } catch (e) {}
  return null;
}

// ── GET / — list notifications for current user ───────────────────────
router.get('/', validateProject, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const pid = req.projectId;
    const { type, entity_type, read: readFilter, limit: lim, offset: off } = req.query;
    const limit = Math.min(parseInt(lim) || 50, 500);
    const offset = parseInt(off) || 0;

    let where = ['n.user_id = $1'];
    let params = [userId];
    let idx = 2;

    if (pid) { where.push(`n.project_id = $${idx++}`); params.push(pid); }
    if (type) { where.push(`n.type = $${idx++}`); params.push(type); }
    if (entity_type) { where.push(`n.entity_type = $${idx++}`); params.push(entity_type); }
    if (readFilter === 'true') { where.push(`n.read = true`); }
    else if (readFilter === 'false') { where.push(`(n.read = false OR n.read IS NULL)`); }

    const sql = `SELECT n.* FROM notifications n WHERE ${where.join(' AND ')} ORDER BY n.sent_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const { rows } = await db.query(sql, params);
    const enriched = await enrichRows(rows);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /unread-count — count unread ──────────────────────────────────
router.get('/unread-count', validateProject, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const pid = req.projectId;
    let where = ['user_id = $1', '(read = false OR read IS NULL)'];
    let params = [userId];
    if (pid) { where.push('project_id = $2'); params.push(pid); }

    const { rows } = await db.query(`SELECT COUNT(*) as count FROM notifications WHERE ${where.join(' AND ')}`, params);
    res.json({ count: parseInt(rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /summary — notification stats ─────────────────────────────────
router.get('/summary', validateProject, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const pid = req.projectId;
    let base = 'user_id = $1';
    let params = [userId];
    if (pid) { base += ' AND project_id = $2'; params.push(pid); }

    const total = (await db.query(`SELECT COUNT(*) as c FROM notifications WHERE ${base}`, params)).rows[0].c;
    const unread = (await db.query(`SELECT COUNT(*) as c FROM notifications WHERE ${base} AND (read = false OR read IS NULL)`, params)).rows[0].c;
    const byType = (await db.query(`SELECT type, COUNT(*) as count FROM notifications WHERE ${base} GROUP BY type ORDER BY count DESC`, params)).rows;

    res.json({ total: Number(total), unread: Number(unread), by_type: byType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create notification ──────────────────────────────────────
router.post('/', validateProject, async (req, res) => {
  try {
    const { user_id, type, entity_type, entity_id, title, message, link } = req.body;
    const pid = req.projectId || req.body.project_id;
    const targetUser = user_id || getUserId(req);

    if (!targetUser) return res.status(400).json({ error: 'user_id required' });

    const { rows } = await db.query(
      `INSERT INTO notifications (user_id, project_id, type, entity_type, entity_id, title, message, link, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [targetUser, pid || null, type || 'info', entity_type || null, entity_id || null,
       title || message || '', message || '', link || '']
    );
    const enriched = await enrichRows(rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bulk — create notifications for multiple users ──────────────
router.post('/bulk', validateProject, async (req, res) => {
  try {
    const { user_ids, type, entity_type, entity_id, title, message, link } = req.body;
    const pid = req.projectId || req.body.project_id;

    if (!Array.isArray(user_ids) || !user_ids.length) return res.status(400).json({ error: 'user_ids array required' });

    const created = [];
    for (const uid of user_ids) {
      const { rows } = await db.query(
        `INSERT INTO notifications (user_id, project_id, type, entity_type, entity_id, title, message, link, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
        [uid, pid || null, type || 'info', entity_type || null, entity_id || null,
         title || message || '', message || '', link || '']
      );
      created.push(rows[0]);
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:notifId/read — mark one as read ─────────────────────────────
router.put('/:notifId/read', validateProject, async (req, res) => {
  try {
    const userId = getUserId(req);
    // Update both 'read' and 'is_read' for backward compat
    let setCols = 'read = true, read_at = NOW()';
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='notifications'`)).rows.map(r => r.column_name);
    if (cols.includes('is_read')) setCols += ', is_read = true';

    await db.query(`UPDATE notifications SET ${setCols} WHERE id = $1 AND user_id = $2`, [req.params.notifId, userId]);
    res.json({ read: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /read-all — mark all as read ──────────────────────────────────
router.put('/read-all', validateProject, async (req, res) => {
  try {
    const userId = getUserId(req);
    const pid = req.projectId;

    let setCols = 'read = true, read_at = NOW()';
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='notifications'`)).rows.map(r => r.column_name);
    if (cols.includes('is_read')) setCols += ', is_read = true';

    let where = 'user_id = $1';
    let params = [userId];
    if (pid) { where += ' AND project_id = $2'; params.push(pid); }

    await db.query(`UPDATE notifications SET ${setCols} WHERE ${where}`, params);
    res.json({ read: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:notifId — delete one ─────────────────────────────────────
router.delete('/:notifId', validateProject, async (req, res) => {
  try {
    const userId = getUserId(req);
    await db.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.notifId, userId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE / — clear read notifications ───────────────────────────────
router.delete('/', validateProject, async (req, res) => {
  try {
    const userId = getUserId(req);
    const pid = req.projectId;

    let where = 'user_id = $1 AND (read = true OR is_read = true)';
    let params = [userId];
    if (pid) { where += ' AND project_id = $2'; params.push(pid); }

    const { rowCount } = await db.query(`DELETE FROM notifications WHERE ${where}`, params);
    res.json({ cleared: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /types — available notification types ─────────────────────────
router.get('/types', (req, res) => {
  res.json({ types: NOTIFICATION_TYPES });
});

module.exports = router;
