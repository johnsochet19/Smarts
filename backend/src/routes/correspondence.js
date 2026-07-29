const router = require('express').Router();
const db = require('../db');
const { logChange } = require('../db/changelog');
const { authenticate, requireRole } = require('../middleware/auth');

(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS correspondence (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      correspondence_number INTEGER,
      correspondence_type VARCHAR(100) DEFAULT 'Notice',
      status VARCHAR(50) DEFAULT 'Draft',
      from_user INTEGER,
      to_users JSONB DEFAULT '[]',
      subject VARCHAR(500) NOT NULL,
      body TEXT,
      sent_date DATE,
      response_due_date DATE,
      workflow JSONB DEFAULT '[]',
      attachments JSONB DEFAULT '[]',
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Migration: correspondence table ready');
  } catch (err) {
    console.error('correspondence migration error:', err.message);
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS correspondence (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        correspondence_number INTEGER,
        correspondence_type VARCHAR(100) DEFAULT 'Notice',
        status VARCHAR(50) DEFAULT 'Draft',
        from_user INTEGER,
        to_users JSONB DEFAULT '[]',
        subject VARCHAR(500) NOT NULL,
        body TEXT,
        sent_date DATE,
        response_due_date DATE,
        workflow JSONB DEFAULT '[]',
        attachments JSONB DEFAULT '[]',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS correspondence_number INTEGER`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS correspondence_type VARCHAR(100) DEFAULT 'Notice'`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS from_user INTEGER`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS to_users JSONB DEFAULT '[]'`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS body TEXT`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS sent_date DATE`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS response_due_date DATE`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS workflow JSONB DEFAULT '[]'`);
      await db.query(`ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'`);
    } catch (e2) {
      console.error('correspondence fallback migration error:', e2.message);
    }
  }
})();

async function getNextCorrespondenceNumber(project_id) {
  const { rows } = await db.query(
    'SELECT COALESCE(MAX(correspondence_number), 0) + 1 as next_num FROM correspondence WHERE project_id = $1',
    [project_id]
  );
  return rows[0].next_num;
}

// Derive status from workflow steps
function deriveStatus(workflow) {
  if (!Array.isArray(workflow) || workflow.length === 0) return null;
  const hasRejected = workflow.some(s => s.status === 'Rejected');
  if (hasRejected) return 'Rejected';
  const allApproved = workflow.every(s => s.status === 'Approved');
  if (allApproved) return 'Approved';
  const hasInReview = workflow.some(s => s.status === 'In Review');
  if (hasInReview) return 'In Review';
  return null;
}

// GET all correspondence for a project
router.get('/', authenticate, async (req, res) => {
  try {
    const { project_id, status, correspondence_type } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });
    let sql = `SELECT c.*, u.name as from_user_name
               FROM correspondence c
               LEFT JOIN users u ON c.from_user = u.id
               WHERE c.project_id = $1`;
    const params = [project_id];
    let idx = 2;
    if (status) { sql += ' AND c.status = $' + idx; params.push(status); idx++; }
    if (correspondence_type) { sql += ' AND c.correspondence_type = $' + idx; params.push(correspondence_type); idx++; }
    sql += ' ORDER BY c.correspondence_number DESC, c.created_at DESC';
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, u.name as from_user_name
       FROM correspondence c LEFT JOIN users u ON c.from_user = u.id
       WHERE c.id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      project_id, correspondence_type, status, from_user, to_users,
      subject, body, sent_date, response_due_date, workflow, attachments
    } = req.body;
    if (!project_id || !subject) return res.status(400).json({ error: 'project_id and subject required' });

    const correspondence_number = await getNextCorrespondenceNumber(project_id);

    // If workflow provided, derive status from it
    let finalStatus = status || 'Draft';
    if (workflow && workflow.length > 0) {
      const derived = deriveStatus(workflow);
      if (derived) finalStatus = derived;
    }

    const { rows } = await db.query(
      `INSERT INTO correspondence (project_id, correspondence_number, correspondence_type, status,
        from_user, to_users, subject, body, sent_date, response_due_date,
        workflow, attachments, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        project_id, correspondence_number, correspondence_type || 'Notice', finalStatus,
        from_user || req.user.id, JSON.stringify(to_users || []),
        subject, body || null, sent_date || null, response_due_date || null,
        JSON.stringify(workflow || []), JSON.stringify(attachments || []),
        req.user.id
      ]
    );
    await logChange('correspondence', rows[0].id, 'INSERT', null, null, JSON.stringify(rows[0]), req.user.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update
router.put('/:id', authenticate, async (req, res) => {
  try {
    const fields = [
      'correspondence_type', 'status', 'from_user', 'to_users',
      'subject', 'body', 'sent_date', 'response_due_date', 'workflow', 'attachments'
    ];
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === 'to_users' || f === 'workflow' || f === 'attachments') {
          sets.push(f + ' = $' + idx);
          vals.push(JSON.stringify(req.body[f]));
        } else {
          sets.push(f + ' = $' + idx);
          vals.push(req.body[f]);
        }
        idx++;
      }
    }

    // Auto-derive status from workflow if workflow was updated but status wasn't explicitly set
    if (req.body.workflow && req.body.status === undefined) {
      const derived = deriveStatus(req.body.workflow);
      if (derived) {
        sets.push('status = $' + idx);
        vals.push(derived);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = NOW()');
    vals.push(req.params.id);
    const { rows } = await db.query(
      'UPDATE correspondence SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING *',
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logChange('correspondence', rows[0].id, 'UPDATE', null, null, JSON.stringify(req.body), req.user.id);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM correspondence WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logChange('correspondence', rows[0].id, 'DELETE', JSON.stringify(rows[0]), null, null, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
