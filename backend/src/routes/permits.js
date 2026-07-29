const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { onStatusChange } = require('../notification-triggers');

// ── Constants ──────────────────────────────────────────────────────────
const PERMIT_TYPES = ['building', 'electrical', 'plumbing', 'mechanical', 'demolition', 'fire', 'elevator', 'zoning', 'other'];
const PERMIT_STATUSES = ['pending', 'submitted', 'under_review', 'approved', 'rejected', 'expired', 'renewed', 'closed'];
const PERMIT_TRANSITIONS = {
  pending:      ['submitted'],
  submitted:    ['under_review'],
  under_review: ['approved', 'rejected'],
  approved:     ['expired', 'renewed', 'closed'],
  rejected:     ['pending'],
  expired:      ['renewed'],
  renewed:      ['expired', 'closed'],
  closed:       []
};

const PERMIT_TYPE_LABELS = {
  building: 'Building', electrical: 'Electrical', plumbing: 'Plumbing',
  mechanical: 'Mechanical', demolition: 'Demolition', fire: 'Fire',
  elevator: 'Elevator', zoning: 'Zoning', other: 'Other'
};
const PERMIT_STATUS_LABELS = {
  pending: 'Pending', submitted: 'Submitted', under_review: 'Under Review',
  approved: 'Approved', rejected: 'Rejected', expired: 'Expired',
  renewed: 'Renewed', closed: 'Closed'
};

// ── Schema migration (IIFE) ───────────────────────────────────────────
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS permits (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      permit_number VARCHAR(100),
      type VARCHAR(50) NOT NULL DEFAULT 'building',
      title VARCHAR(255),
      description TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      issuing_authority VARCHAR(255),
      applied_date DATE,
      approved_date DATE,
      expiration_date DATE,
      renewal_date DATE,
      fee_amount NUMERIC(12,2) DEFAULT 0,
      fee_paid NUMERIC(12,2) DEFAULT 0,
      fee_paid_date DATE,
      inspector_name VARCHAR(255),
      inspector_phone VARCHAR(50),
      conditions TEXT,
      notes TEXT,
      assigned_to_id INTEGER REFERENCES users(id),
      box_file_id VARCHAR(255),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Add columns that may be missing on older installs
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='permits'`)).rows.map(r => r.column_name);
    const add = async (col, def) => { if (!cols.includes(col)) await db.query(`ALTER TABLE permits ADD COLUMN ${col} ${def}`); };
    await add('title', "VARCHAR(255)");
    await add('description', "TEXT");
    await add('issuing_authority', "VARCHAR(255)");
    await add('applied_date', "DATE");
    await add('approved_date', "DATE");
    await add('expiration_date', "DATE");
    await add('renewal_date', "DATE");
    await add('fee_amount', "NUMERIC(12,2) DEFAULT 0");
    await add('fee_paid', "NUMERIC(12,2) DEFAULT 0");
    await add('fee_paid_date', "DATE");
    await add('inspector_name', "VARCHAR(255)");
    await add('inspector_phone', "VARCHAR(50)");
    await add('conditions', "TEXT");
    await add('assigned_to_id', "INTEGER REFERENCES users(id)");
    await add('box_file_id', "VARCHAR(255)");
    await add('created_by', "INTEGER REFERENCES users(id)");

    // Legacy migration: uppercase types → lowercase
    for (const t of PERMIT_TYPES) {
      const upper = t.charAt(0).toUpperCase() + t.slice(1);
      await db.query(`UPDATE permits SET type = $1 WHERE type = $2`, [t, upper]);
    }
    // Map old status values
    await db.query(`UPDATE permits SET status = 'under_review' WHERE LOWER(status) IN ('in_review', 'in review', 'under review')`);
    await db.query(`UPDATE permits SET status = LOWER(status) WHERE status != LOWER(status)`);

    // Map old column names if they exist
    if (cols.includes('filed_date') && !cols.includes('applied_date')) {
      await db.query(`ALTER TABLE permits RENAME COLUMN filed_date TO applied_date`);
    } else if (cols.includes('filed_date')) {
      await db.query(`UPDATE permits SET applied_date = filed_date WHERE applied_date IS NULL AND filed_date IS NOT NULL`);
    }
    if (cols.includes('expiry_date') && !cols.includes('expiration_date')) {
      await db.query(`ALTER TABLE permits RENAME COLUMN expiry_date TO expiration_date`);
    } else if (cols.includes('expiry_date')) {
      await db.query(`UPDATE permits SET expiration_date = expiry_date WHERE expiration_date IS NULL AND expiry_date IS NOT NULL`);
    }

    console.log('[permits] table ready');
  } catch (err) {
    console.error('[permits] migration error:', err.message);
  }
})();

// ── Middleware: validate project ───────────────────────────────────────
async function validateProject(req, res, next) {
  const pid = req.params.id;
  if (!pid) return next();
  const { rows } = await db.query('SELECT id FROM projects WHERE id=$1', [pid]);
  if (!rows.length) return res.status(404).json({ error: 'Project not found' });
  req.projectId = Number(pid);
  next();
}

// ── Enrich helpers ────────────────────────────────────────────────────
async function enrichPermits(rows) {
  if (!rows.length) return rows;
  // Load assignee names
  const userIds = [...new Set(rows.map(r => r.assigned_to_id).concat(rows.map(r => r.created_by)).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const { rows: users } = await db.query(`SELECT id, name, email FROM users WHERE id = ANY($1)`, [userIds]);
    users.forEach(u => { userMap[u.id] = u; });
  }
  const today = new Date(); today.setHours(0,0,0,0);
  return rows.map(r => {
    const assigned = userMap[r.assigned_to_id];
    const creator = userMap[r.created_by];
    // Compute effective status: auto-expire if past expiration
    let effective_status = r.status;
    let days_until_expiration = null;
    if (r.expiration_date) {
      const exp = new Date(r.expiration_date); exp.setHours(0,0,0,0);
      days_until_expiration = Math.ceil((exp - today) / 86400000);
      if (days_until_expiration < 0 && r.status === 'approved') {
        effective_status = 'expired';
      }
    }
    const fee_remaining = Number(r.fee_amount || 0) - Number(r.fee_paid || 0);
    return {
      ...r,
      assigned_to_name: assigned ? assigned.name : null,
      created_by_name: creator ? creator.name : null,
      effective_status,
      days_until_expiration,
      fee_remaining: Math.max(0, fee_remaining),
      is_expiring_soon: days_until_expiration !== null && days_until_expiration >= 0 && days_until_expiration <= 30 && r.status === 'approved'
    };
  });
}

// ── GET / ─ list permits ──────────────────────────────────────────────
router.get('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    let where = 'WHERE p.project_id=$1';
    const params = [pid];
    let idx = 2;
    if (req.query.status) { where += ` AND p.status=$${idx++}`; params.push(req.query.status); }
    if (req.query.type) { where += ` AND p.type=$${idx++}`; params.push(req.query.type); }
    if (req.query.assigned_to_id) { where += ` AND p.assigned_to_id=$${idx++}`; params.push(req.query.assigned_to_id); }
    const { rows } = await db.query(`SELECT p.* FROM permits p ${where} ORDER BY p.created_at DESC`, params);
    const enriched = await enrichPermits(rows);
    res.json(enriched);
  } catch (err) {
    console.error('[permits] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /constants ────────────────────────────────────────────────────
router.get('/constants', (req, res) => {
  res.json({
    types: PERMIT_TYPES,
    type_labels: PERMIT_TYPE_LABELS,
    statuses: PERMIT_STATUSES,
    status_labels: PERMIT_STATUS_LABELS,
    transitions: PERMIT_TRANSITIONS
  });
});

// ── GET /summary ──────────────────────────────────────────────────────
router.get('/summary', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const { rows } = await db.query(`SELECT p.* FROM permits p WHERE p.project_id=$1`, [pid]);
    const enriched = await enrichPermits(rows);
    const by_status = {};
    PERMIT_STATUSES.forEach(s => { by_status[s] = 0; });
    const by_type = {};
    PERMIT_TYPES.forEach(t => { by_type[t] = 0; });
    let total_fees = 0, total_paid = 0, expiring_count = 0, expired_count = 0;
    enriched.forEach(p => {
      by_status[p.effective_status] = (by_status[p.effective_status] || 0) + 1;
      by_type[p.type] = (by_type[p.type] || 0) + 1;
      total_fees += Number(p.fee_amount || 0);
      total_paid += Number(p.fee_paid || 0);
      if (p.is_expiring_soon) expiring_count++;
      if (p.effective_status === 'expired') expired_count++;
    });
    res.json({ total: rows.length, by_status, by_type, total_fees, total_paid, fee_remaining: total_fees - total_paid, expiring_count, expired_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:permitId ────────────────────────────────────────────────────
router.get('/:permitId', validateProject, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM permits WHERE id=$1', [req.params.permitId]);
    if (!rows.length) return res.status(404).json({ error: 'Permit not found' });
    const enriched = await enrichPermits(rows);
    res.json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ─ create permit ────────────────────────────────────────────
router.post('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.body.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const b = req.body;
    const type = (b.type || 'building').toLowerCase();
    if (!PERMIT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type: ' + type });
    const status = (b.status || 'pending').toLowerCase();
    if (!PERMIT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status: ' + status });
    const { rows } = await db.query(
      `INSERT INTO permits (project_id, permit_number, type, title, description, status,
        issuing_authority, applied_date, approved_date, expiration_date, renewal_date,
        fee_amount, fee_paid, fee_paid_date, inspector_name, inspector_phone,
        conditions, notes, assigned_to_id, box_file_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *`,
      [pid, b.permit_number || null, type, b.title || null, b.description || null, status,
        b.issuing_authority || null, b.applied_date || null, b.approved_date || null,
        b.expiration_date || null, b.renewal_date || null,
        b.fee_amount || 0, b.fee_paid || 0, b.fee_paid_date || null,
        b.inspector_name || null, b.inspector_phone || null,
        b.conditions || null, b.notes || null, b.assigned_to_id || null,
        b.box_file_id || null, b.created_by || null]
    );
    const enriched = await enrichPermits(rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    console.error('[permits] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:permitId ─ update permit (with status machine) ──────────────
router.put('/:permitId', validateProject, async (req, res) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM permits WHERE id=$1', [req.params.permitId]);
    if (!existing.length) return res.status(404).json({ error: 'Permit not found' });
    const old = existing[0];
    const b = req.body;

    // Validate status transition
    if (b.status && b.status !== old.status) {
      const allowed = PERMIT_TRANSITIONS[old.status] || [];
      if (!allowed.includes(b.status)) {
        return res.status(400).json({ error: `Cannot transition from '${old.status}' to '${b.status}'. Allowed: ${allowed.join(', ') || 'none'}` });
      }
    }
    if (b.type && !PERMIT_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type' });

    const status = b.status || old.status;
    // Auto-set approved_date when transitioning to approved
    let approved_date = b.approved_date !== undefined ? b.approved_date : old.approved_date;
    if (b.status === 'approved' && !approved_date) approved_date = new Date().toISOString().slice(0, 10);

    const { rows } = await db.query(
      `UPDATE permits SET permit_number=$1, type=$2, title=$3, description=$4, status=$5,
        issuing_authority=$6, applied_date=$7, approved_date=$8, expiration_date=$9, renewal_date=$10,
        fee_amount=$11, fee_paid=$12, fee_paid_date=$13, inspector_name=$14, inspector_phone=$15,
        conditions=$16, notes=$17, assigned_to_id=$18, box_file_id=$19, updated_at=NOW()
      WHERE id=$20 RETURNING *`,
      [
        b.permit_number !== undefined ? b.permit_number : old.permit_number,
        b.type || old.type, b.title !== undefined ? b.title : old.title,
        b.description !== undefined ? b.description : old.description, status,
        b.issuing_authority !== undefined ? b.issuing_authority : old.issuing_authority,
        b.applied_date !== undefined ? b.applied_date : old.applied_date,
        approved_date,
        b.expiration_date !== undefined ? b.expiration_date : old.expiration_date,
        b.renewal_date !== undefined ? b.renewal_date : old.renewal_date,
        b.fee_amount !== undefined ? b.fee_amount : old.fee_amount,
        b.fee_paid !== undefined ? b.fee_paid : old.fee_paid,
        b.fee_paid_date !== undefined ? b.fee_paid_date : old.fee_paid_date,
        b.inspector_name !== undefined ? b.inspector_name : old.inspector_name,
        b.inspector_phone !== undefined ? b.inspector_phone : old.inspector_phone,
        b.conditions !== undefined ? b.conditions : old.conditions,
        b.notes !== undefined ? b.notes : old.notes,
        b.assigned_to_id !== undefined ? b.assigned_to_id : old.assigned_to_id,
        b.box_file_id !== undefined ? b.box_file_id : old.box_file_id,
        req.params.permitId
      ]
    );
    if (b.status && b.status !== old.status) {
      await onStatusChange('permit', Number(req.params.permitId), b.status, req.projectId, null);
    }
    const enriched = await enrichPermits(rows);
    res.json(enriched[0]);
  } catch (err) {
    console.error('[permits] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:permitId ─────────────────────────────────────────────────
router.delete('/:permitId', validateProject, async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM permits WHERE id=$1', [req.params.permitId]);
    if (!rowCount) return res.status(404).json({ error: 'Permit not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
