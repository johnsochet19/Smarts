const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { logChange, logAllChanges } = require('../db/changelog');
const { authenticate } = require('../middleware/auth');
const { onStatusChange, updateBallInCourt } = require('../notification-triggers');

// Auto-migrate RFI tables
(async () => {
  try {
    // Core rfis table
    await db.query(`CREATE TABLE IF NOT EXISTS rfis (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) NOT NULL,
      rfi_number INTEGER NOT NULL,
      prefix VARCHAR(20),
      subject VARCHAR(255) NOT NULL,
      question TEXT NOT NULL,
      official_response TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      private BOOLEAN DEFAULT false,
      rfi_manager_id INTEGER REFERENCES users(id),
      received_from_id INTEGER REFERENCES users(id),
      responsible_contractor_company VARCHAR(255),
      drawing_number VARCHAR(100),
      location VARCHAR(255),
      spec_section VARCHAR(100),
      due_date DATE,
      cost_impact BOOLEAN DEFAULT false,
      cost_impact_amount DECIMAL(12,2),
      schedule_impact BOOLEAN DEFAULT false,
      schedule_impact_days INTEGER,
      ball_in_court_id INTEGER REFERENCES users(id),
      revision_number INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      closed_at TIMESTAMP,
      UNIQUE(project_id, rfi_number)
    )`);

    // Migrations for existing tables
    const migrations = [
      'ALTER TABLE rfis ADD COLUMN IF NOT EXISTS prefix VARCHAR(20)',
      'ALTER TABLE rfis ADD COLUMN IF NOT EXISTS private BOOLEAN DEFAULT false',
      'ALTER TABLE rfis ADD COLUMN IF NOT EXISTS received_from_id INTEGER REFERENCES users(id)',
      'ALTER TABLE rfis ADD COLUMN IF NOT EXISTS responsible_contractor_company VARCHAR(255)',
      'ALTER TABLE rfis ADD COLUMN IF NOT EXISTS ball_in_court_id INTEGER REFERENCES users(id)',
      'ALTER TABLE rfis ADD COLUMN IF NOT EXISTS revision_number INTEGER DEFAULT 0',
      'ALTER TABLE rfis ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP',
      // Migrate old column names
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rfis' AND column_name='is_private') THEN
          UPDATE rfis SET private = is_private WHERE private IS NULL AND is_private IS NOT NULL;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rfis' AND column_name='ball_in_court') THEN
          UPDATE rfis SET ball_in_court_id = ball_in_court WHERE ball_in_court_id IS NULL AND ball_in_court IS NOT NULL;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rfis' AND column_name='received_from_user_id') THEN
          UPDATE rfis SET received_from_id = received_from_user_id WHERE received_from_id IS NULL AND received_from_user_id IS NOT NULL;
        END IF;
      END $$`,
      // Migrate status values to lowercase
      "UPDATE rfis SET status = LOWER(status) WHERE status IS DISTINCT FROM LOWER(status)",
    ];
    for (const m of migrations) {
      await db.query(m).catch(() => {});
    }

    // rfi_assignees join table
    await db.query(`CREATE TABLE IF NOT EXISTS rfi_assignees (
      id SERIAL PRIMARY KEY,
      rfi_id INTEGER REFERENCES rfis(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      response_required BOOLEAN DEFAULT false,
      response_text TEXT,
      responded_at TIMESTAMP,
      UNIQUE(rfi_id, user_id)
    )`);

    // rfi_distribution join table
    await db.query(`CREATE TABLE IF NOT EXISTS rfi_distribution (
      id SERIAL PRIMARY KEY,
      rfi_id INTEGER REFERENCES rfis(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(rfi_id, user_id)
    )`);

    // Migrate legacy JSONB assignees → rfi_assignees
    await db.query(`
      INSERT INTO rfi_assignees (rfi_id, user_id, response_required)
      SELECT r.id,
        CASE WHEN jsonb_typeof(elem) = 'object' THEN (elem->>'user_id')::int
             ELSE (elem::text)::int END,
        CASE WHEN jsonb_typeof(elem) = 'object' THEN COALESCE((elem->>'require_response')::boolean, false)
             ELSE false END
      FROM rfis r, jsonb_array_elements(r.assignees) elem
      WHERE r.assignees IS NOT NULL AND jsonb_array_length(r.assignees) > 0
      ON CONFLICT (rfi_id, user_id) DO NOTHING
    `).catch(() => {});

    // Migrate legacy JSONB distribution_list → rfi_distribution
    await db.query(`
      INSERT INTO rfi_distribution (rfi_id, user_id)
      SELECT r.id, (elem::text)::int
      FROM rfis r, jsonb_array_elements(r.distribution_list) elem
      WHERE r.distribution_list IS NOT NULL AND jsonb_array_length(r.distribution_list) > 0
      ON CONFLICT (rfi_id, user_id) DO NOTHING
    `).catch(() => {});

    console.log('RFIs, rfi_assignees, rfi_distribution tables ready');
  } catch(err) { console.error('RFIs migration error:', err.message); }
})();

const RFI_STATUSES = ['draft', 'open', 'closed'];

const RFI_SELECT = `r.id, r.project_id, r.rfi_number, r.prefix, r.subject, r.question,
  r.official_response, r.status, r.private, r.rfi_manager_id,
  r.received_from_id, r.responsible_contractor_company,
  r.drawing_number, r.location, r.spec_section, r.due_date,
  r.cost_impact, r.cost_impact_amount, r.schedule_impact, r.schedule_impact_days,
  r.ball_in_court_id, r.revision_number,
  r.created_by, r.created_at, r.updated_at, r.closed_at`;

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getNextRfiNumber(projectId) {
  const result = await db.query(
    'SELECT COALESCE(MAX(rfi_number), 0) + 1 as next FROM rfis WHERE project_id = $1',
    [projectId]
  );
  return result.rows[0].next;
}

function addWorkingDays(startDate, days, workingDays) {
  let count = 0;
  let date = new Date(startDate);
  const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  // Default to M-F if no workingDays provided
  const wd = workingDays || { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false };
  while (count < days) {
    date.setDate(date.getDate() + 1);
    if (wd[dayMap[date.getDay()]]) count++;
  }
  return date.toISOString().substring(0, 10);
}

async function notify(userId, type, title, message, link) {
  try {
    if (userId) await db.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)',
      [userId, type, title, message || '', link || '']
    );
  } catch(e) {}
}

async function getAssignees(rfiId) {
  const r = await db.query(
    `SELECT ra.user_id, ra.response_required, ra.response_text, ra.responded_at,
            u.name, u.first_name, u.last_name, u.email
     FROM rfi_assignees ra JOIN users u ON u.id = ra.user_id
     WHERE ra.rfi_id = $1 ORDER BY ra.id`, [rfiId]);
  return r.rows;
}

async function getDistribution(rfiId) {
  const r = await db.query(
    `SELECT rd.user_id, u.name, u.first_name, u.last_name, u.email
     FROM rfi_distribution rd JOIN users u ON u.id = rd.user_id
     WHERE rd.rfi_id = $1 ORDER BY rd.id`, [rfiId]);
  return r.rows;
}

async function getRelatedItems(rfiId) {
  const r = await db.query(
    `SELECT * FROM related_items
     WHERE (source_type = 'rfi' AND source_id = $1) OR (target_type = 'rfi' AND target_id = $1)
     ORDER BY created_at DESC`, [rfiId]);
  return r.rows;
}

async function enrichRfis(rfis) {
  if (!rfis.length) return rfis;
  const ids = rfis.map(r => r.id);
  const [assResult, distResult, relResult] = await Promise.all([
    db.query(
      `SELECT ra.rfi_id, ra.user_id, ra.response_required, ra.response_text, ra.responded_at,
              u.name, u.first_name, u.last_name, u.email
       FROM rfi_assignees ra JOIN users u ON u.id = ra.user_id
       WHERE ra.rfi_id = ANY($1)`, [ids]),
    db.query(
      `SELECT rd.rfi_id, rd.user_id, u.name, u.first_name, u.last_name, u.email
       FROM rfi_distribution rd JOIN users u ON u.id = rd.user_id
       WHERE rd.rfi_id = ANY($1)`, [ids]),
    db.query(
      `SELECT * FROM related_items
       WHERE (source_type = 'rfi' AND source_id = ANY($1))
          OR (target_type = 'rfi' AND target_id = ANY($1))`, [ids])
  ]);
  const assMap = {}, distMap = {}, relMap = {};
  for (const row of assResult.rows) {
    if (!assMap[row.rfi_id]) assMap[row.rfi_id] = [];
    assMap[row.rfi_id].push(row);
  }
  for (const row of distResult.rows) {
    if (!distMap[row.rfi_id]) distMap[row.rfi_id] = [];
    distMap[row.rfi_id].push(row);
  }
  for (const row of relResult.rows) {
    const rid = row.source_type === 'rfi' ? row.source_id : row.target_id;
    if (!relMap[rid]) relMap[rid] = [];
    relMap[rid].push(row);
  }
  return rfis.map(r => Object.assign({}, r, {
    assignees: assMap[r.id] || [],
    distribution_list: distMap[r.id] || [],
    related_items: relMap[r.id] || []
  }));
}

function validateProject(req, res, next) {
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(projectId);
  next();
}

// ─── GET /api/projects/:id/rfis ──────────────────────────────────────────

router.get('/', authenticate, validateProject, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ' + RFI_SELECT + ' FROM rfis r WHERE r.project_id = $1 ORDER BY r.rfi_number DESC',
      [req.projectId]
    );
    const enriched = await enrichRfis(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/projects/:id/rfis/export ───────────────────────────────────

router.get('/export', authenticate, validateProject, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ' + RFI_SELECT + ' FROM rfis r WHERE r.project_id = $1 ORDER BY r.rfi_number ASC',
      [req.projectId]
    );
    const rfis = await enrichRfis(result.rows);
    const format = req.query.format || 'csv';

    if (format === 'csv') {
      const headers = ['RFI #', 'Prefix', 'Subject', 'Status', 'Question', 'Official Response',
        'Due Date', 'Ball in Court', 'RFI Manager', 'Received From', 'Drawing #',
        'Location', 'Spec Section', 'Cost Impact', 'Cost Amount',
        'Schedule Impact', 'Schedule Days', 'Revision', 'Created', 'Closed'];
      const rows = rfis.map(r => [
        r.rfi_number, r.prefix || '', r.subject, r.status, (r.question || '').replace(/"/g, '""'),
        (r.official_response || '').replace(/"/g, '""'),
        r.due_date || '', '', '', '', r.drawing_number || '',
        r.location || '', r.spec_section || '',
        r.cost_impact ? 'Yes' : 'No', r.cost_impact_amount || '',
        r.schedule_impact ? 'Yes' : 'No', r.schedule_impact_days || '',
        r.revision_number || 0,
        r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
        r.closed_at ? new Date(r.closed_at).toLocaleDateString() : ''
      ]);
      const csv = [headers.join(',')].concat(
        rows.map(r => r.map(c => '"' + String(c) + '"').join(','))
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=rfis-export.csv');
      return res.send(csv);
    }

    // JSON fallback (PDF would require a library)
    res.json(rfis);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/rfis ─────────────────────────────────────────

router.post('/', authenticate, validateProject, async (req, res) => {
  const {
    prefix, subject, question, status, private: isPrivate,
    rfi_manager_id, received_from_id, responsible_contractor_company,
    drawing_number, location, spec_section, due_date, due_days,
    cost_impact, cost_impact_amount, schedule_impact, schedule_impact_days,
    ball_in_court_id, assignees, distribution_list, related_items
  } = req.body;

  if (!subject) return res.status(400).json({ error: 'subject required' });

  try {
    const rfi_number = await getNextRfiNumber(req.projectId);

    // Calculate due date from project working days if not provided
    let calculatedDueDate = due_date;
    if (!calculatedDueDate) {
      let workingDays = null;
      const projResult = await db.query('SELECT working_days FROM projects WHERE id = $1', [req.projectId]);
      if (projResult.rows.length) {
        workingDays = projResult.rows[0].working_days;
      }
      calculatedDueDate = addWorkingDays(new Date(), due_days || 7, workingDays);
    }

    // Validate status transition: draft requires minimal fields, open needs more
    const rfiStatus = status || 'draft';
    if (rfiStatus === 'open') {
      if (!question) return res.status(400).json({ error: 'question required to open RFI' });
    }

    const result = await db.query(
      `INSERT INTO rfis (
        project_id, rfi_number, prefix, subject, question, status, private,
        rfi_manager_id, received_from_id, responsible_contractor_company,
        drawing_number, location, spec_section, due_date,
        cost_impact, cost_impact_amount, schedule_impact, schedule_impact_days,
        ball_in_court_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING ` + RFI_SELECT.replace(/r\./g, ''),
      [
        req.projectId, rfi_number, prefix || null, subject, question || null,
        rfiStatus, isPrivate || false,
        rfi_manager_id || null, received_from_id || req.user.id,
        responsible_contractor_company || null,
        drawing_number || null, location || null, spec_section || null,
        calculatedDueDate,
        cost_impact || false, cost_impact_amount || null,
        schedule_impact || false, schedule_impact_days || null,
        ball_in_court_id || rfi_manager_id || null,
        req.user.id
      ]
    );
    const rfi = result.rows[0];

    // Insert assignees
    if (Array.isArray(assignees)) {
      for (const a of assignees) {
        const uid = typeof a === 'object' ? (a.user_id || a.id) : Number(a);
        const responseReq = typeof a === 'object' ? (a.response_required || a.require_response || false) : false;
        await db.query(
          'INSERT INTO rfi_assignees (rfi_id, user_id, response_required) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [rfi.id, uid, responseReq]
        ).catch(() => {});
        if (uid !== req.user.id) {
          notify(uid, 'rfi_assigned', 'RFI #' + rfi_number + ' assigned',
            'You were assigned to RFI: ' + subject, '/rfis');
        }
      }
    }

    // Insert distribution list
    if (Array.isArray(distribution_list)) {
      for (const uid of distribution_list) {
        const userId = typeof uid === 'object' ? (uid.user_id || uid.id) : Number(uid);
        await db.query(
          'INSERT INTO rfi_distribution (rfi_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [rfi.id, userId]
        ).catch(() => {});
      }
    }

    // Insert related items
    if (Array.isArray(related_items)) {
      for (const rel of related_items) {
        if (typeof rel === 'string') {
          await db.query(
            `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
             VALUES ('rfi', $1, $2, 0, $3) ON CONFLICT DO NOTHING`,
            [rfi.id, rel.toLowerCase(), req.user.id]
          ).catch(() => {});
        } else if (rel.target_type && rel.target_id) {
          await db.query(
            `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
             VALUES ('rfi', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [rfi.id, rel.target_type, rel.target_id, req.user.id]
          ).catch(() => {});
        }
      }
    }

    rfi.assignees = await getAssignees(rfi.id);
    rfi.distribution_list = await getDistribution(rfi.id);
    rfi.related_items = await getRelatedItems(rfi.id);

    await logChange({ tableName: 'rfis', recordId: rfi.id, operation: 'CREATE',
      newValue: JSON.stringify({ rfi_number, subject }), userId: req.user.id });

    if (rfi_manager_id && rfi_manager_id !== req.user.id) {
      notify(rfi_manager_id, 'rfi_created', 'New RFI #' + rfi_number, 'RFI created: ' + subject, '/rfis');
    }
    await updateBallInCourt('rfi', rfi.id, rfi.status || 'draft');

    res.status(201).json(rfi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/projects/:id/rfis/:rfiId ───────────────────────────────────

router.get('/:rfiId', authenticate, validateProject, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ' + RFI_SELECT + ' FROM rfis r WHERE r.id = $1 AND r.project_id = $2',
      [req.params.rfiId, req.projectId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'RFI not found' });
    const rfi = result.rows[0];
    rfi.assignees = await getAssignees(rfi.id);
    rfi.distribution_list = await getDistribution(rfi.id);
    rfi.related_items = await getRelatedItems(rfi.id);
    res.json(rfi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/projects/:id/rfis/:rfiId ───────────────────────────────────

router.put('/:rfiId', authenticate, validateProject, async (req, res) => {
  const { rfiId } = req.params;
  try {
    const existing = await db.query('SELECT * FROM rfis WHERE id = $1 AND project_id = $2', [rfiId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'RFI not found' });
    const old = existing.rows[0];

    const allowed = [
      'prefix', 'subject', 'question', 'private', 'rfi_manager_id',
      'received_from_id', 'responsible_contractor_company',
      'drawing_number', 'location', 'spec_section', 'due_date',
      'cost_impact', 'cost_impact_amount', 'schedule_impact', 'schedule_impact_days',
      'official_response', 'ball_in_court_id'
    ];
    const newData = { updated_at: new Date() };
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === 'private' || field === 'cost_impact' || field === 'schedule_impact') {
          newData[field] = req.body[field];
        } else {
          newData[field] = req.body[field] === '' ? null : req.body[field];
        }
      }
    }

    await logAllChanges({ tableName: 'rfis', recordId: rfiId, oldRecord: old, newData: req.body, userId: req.user.id });

    const keys = Object.keys(newData);
    if (keys.length > 1) { // more than just updated_at
      const setClause = keys.map((k, i) => k + ' = $' + (i + 1)).join(', ');
      const values = [...Object.values(newData), rfiId];
      await db.query('UPDATE rfis SET ' + setClause + ' WHERE id = $' + values.length, values);
    }

    // Update assignees if provided
    if (req.body.assignees !== undefined) {
      await db.query('DELETE FROM rfi_assignees WHERE rfi_id = $1', [rfiId]);
      if (Array.isArray(req.body.assignees)) {
        for (const a of req.body.assignees) {
          const uid = typeof a === 'object' ? (a.user_id || a.id) : Number(a);
          const responseReq = typeof a === 'object' ? (a.response_required || a.require_response || false) : false;
          await db.query(
            'INSERT INTO rfi_assignees (rfi_id, user_id, response_required) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [rfiId, uid, responseReq]
          ).catch(() => {});
        }
      }
    }

    // Update distribution if provided
    if (req.body.distribution_list !== undefined) {
      await db.query('DELETE FROM rfi_distribution WHERE rfi_id = $1', [rfiId]);
      if (Array.isArray(req.body.distribution_list)) {
        for (const uid of req.body.distribution_list) {
          const userId = typeof uid === 'object' ? (uid.user_id || uid.id) : Number(uid);
          await db.query(
            'INSERT INTO rfi_distribution (rfi_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [rfiId, userId]
          ).catch(() => {});
        }
      }
    }

    // Update related items if provided
    if (req.body.related_items !== undefined) {
      await db.query("DELETE FROM related_items WHERE source_type = 'rfi' AND source_id = $1", [rfiId]);
      if (Array.isArray(req.body.related_items)) {
        for (const rel of req.body.related_items) {
          if (typeof rel === 'string') {
            await db.query(
              `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
               VALUES ('rfi', $1, $2, 0, $3) ON CONFLICT DO NOTHING`,
              [rfiId, rel.toLowerCase(), req.user.id]
            ).catch(() => {});
          } else if (rel.target_type && rel.target_id) {
            await db.query(
              `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
               VALUES ('rfi', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [rfiId, rel.target_type, rel.target_id, req.user.id]
            ).catch(() => {});
          }
        }
      }
    }

    // Fetch updated
    const updated = await db.query('SELECT ' + RFI_SELECT + ' FROM rfis r WHERE r.id = $1', [rfiId]);
    const rfi = updated.rows[0];
    rfi.assignees = await getAssignees(rfiId);
    rfi.distribution_list = await getDistribution(rfiId);
    rfi.related_items = await getRelatedItems(rfiId);
    res.json(rfi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/projects/:id/rfis/:rfiId/status ───────────────────────────

router.put('/:rfiId/status', authenticate, validateProject, async (req, res) => {
  const { rfiId } = req.params;
  const { status } = req.body;
  if (!status || !RFI_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be: ' + RFI_STATUSES.join(', ') });
  }
  try {
    const existing = await db.query('SELECT * FROM rfis WHERE id = $1 AND project_id = $2', [rfiId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'RFI not found' });
    const old = existing.rows[0];

    // Validate transitions
    if (status === 'open' && old.status === 'draft') {
      // Requires: subject, question, due_date
      if (!old.subject) return res.status(400).json({ error: 'subject required to open RFI' });
      if (!old.question) return res.status(400).json({ error: 'question required to open RFI' });
      if (!old.due_date) return res.status(400).json({ error: 'due_date required to open RFI' });
      const assignees = await getAssignees(rfiId);
      if (assignees.length === 0) return res.status(400).json({ error: 'At least one assignee required to open RFI' });
    }
    if (status === 'closed' && old.status === 'open') {
      if (!old.official_response) return res.status(400).json({ error: 'official_response required to close RFI' });
    }

    const updates = { status, updated_at: new Date() };
    if (status === 'closed' && old.status !== 'closed') {
      updates.closed_at = new Date();
    }
    if (status === 'open' && old.status === 'closed') {
      updates.closed_at = null;
      // Reopen = revision
      updates.revision_number = (old.revision_number || 0) + 1;
    }

    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => k + ' = $' + (i + 1)).join(', ');
    const values = [...Object.values(updates), rfiId];
    await db.query('UPDATE rfis SET ' + setClause + ' WHERE id = $' + values.length, values);

    await logChange({ tableName: 'rfis', recordId: rfiId, operation: 'UPDATE',
      fieldChanged: 'status', oldValue: old.status, newValue: status, userId: req.user.id });
    await onStatusChange('rfi', rfiId, status, req.projectId, req.user.id);
    await updateBallInCourt('rfi', rfiId, status);

    const result = await db.query('SELECT ' + RFI_SELECT + ' FROM rfis r WHERE r.id = $1', [rfiId]);
    const rfi = result.rows[0];
    rfi.assignees = await getAssignees(rfiId);
    rfi.distribution_list = await getDistribution(rfiId);
    rfi.related_items = await getRelatedItems(rfiId);
    res.json(rfi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/rfis/:rfiId/respond ─────────────────────────

router.post('/:rfiId/respond', authenticate, validateProject, async (req, res) => {
  const { rfiId } = req.params;
  const { response_text, official } = req.body;
  if (!response_text) return res.status(400).json({ error: 'response_text required' });

  try {
    const existing = await db.query('SELECT * FROM rfis WHERE id = $1 AND project_id = $2', [rfiId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'RFI not found' });

    // Record assignee response
    await db.query(
      `UPDATE rfi_assignees SET response_text = $1, responded_at = NOW()
       WHERE rfi_id = $2 AND user_id = $3`,
      [response_text, rfiId, req.user.id]
    );

    // If flagged as official response, update the RFI itself
    if (official) {
      await db.query(
        'UPDATE rfis SET official_response = $1, updated_at = NOW() WHERE id = $2',
        [response_text, rfiId]
      );
    }

    const rfi = await db.query('SELECT ' + RFI_SELECT + ' FROM rfis r WHERE r.id = $1', [rfiId]);
    const result = rfi.rows[0];
    result.assignees = await getAssignees(rfiId);
    result.distribution_list = await getDistribution(rfiId);
    result.related_items = await getRelatedItems(rfiId);

    // Notify RFI creator
    if (existing.rows[0].created_by && existing.rows[0].created_by !== req.user.id) {
      notify(existing.rows[0].created_by, 'rfi_response', 'RFI #' + existing.rows[0].rfi_number + ' response',
        'New response on: ' + existing.rows[0].subject, '/rfis');
    }

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/rfis/:rfiId/assignees ───────────────────────

router.post('/:rfiId/assignees', authenticate, validateProject, async (req, res) => {
  try {
    const { user_id, response_required } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const check = await db.query('SELECT id, rfi_number, subject FROM rfis WHERE id = $1 AND project_id = $2',
      [req.params.rfiId, req.projectId]);
    if (!check.rows.length) return res.status(404).json({ error: 'RFI not found' });

    await db.query(
      'INSERT INTO rfi_assignees (rfi_id, user_id, response_required) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [req.params.rfiId, user_id, response_required || false]
    );
    if (Number(user_id) !== req.user.id) {
      notify(user_id, 'rfi_assigned', 'RFI #' + check.rows[0].rfi_number + ' assigned',
        'You were assigned to RFI: ' + check.rows[0].subject, '/rfis');
    }
    res.json(await getAssignees(req.params.rfiId));
  } catch (err) {
    if (err.code === '23505') return res.json(await getAssignees(req.params.rfiId));
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/projects/:id/rfis/:rfiId/assignees/:userId ─────────────

router.delete('/:rfiId/assignees/:userId', authenticate, validateProject, async (req, res) => {
  try {
    await db.query('DELETE FROM rfi_assignees WHERE rfi_id = $1 AND user_id = $2',
      [req.params.rfiId, req.params.userId]);
    res.json(await getAssignees(req.params.rfiId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/rfis/:rfiId/revise — reopen + increment ────

router.post('/:rfiId/revise', authenticate, validateProject, async (req, res) => {
  const { rfiId } = req.params;
  try {
    const existing = await db.query('SELECT * FROM rfis WHERE id = $1 AND project_id = $2', [rfiId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'RFI not found' });
    const old = existing.rows[0];

    if (old.status !== 'closed') {
      return res.status(400).json({ error: 'Only closed RFIs can be revised' });
    }

    await db.query(
      `UPDATE rfis SET status = 'open', closed_at = NULL,
       revision_number = $1, updated_at = NOW() WHERE id = $2`,
      [(old.revision_number || 0) + 1, rfiId]
    );

    await logChange({ tableName: 'rfis', recordId: rfiId, operation: 'UPDATE',
      fieldChanged: 'status', oldValue: 'closed', newValue: 'open (revision)',
      userId: req.user.id });

    const result = await db.query('SELECT ' + RFI_SELECT + ' FROM rfis r WHERE r.id = $1', [rfiId]);
    const rfi = result.rows[0];
    rfi.assignees = await getAssignees(rfiId);
    rfi.distribution_list = await getDistribution(rfiId);
    rfi.related_items = await getRelatedItems(rfiId);

    // Notify assignees of revision
    const assignees = await getAssignees(rfiId);
    for (const a of assignees) {
      if (a.user_id !== req.user.id) {
        notify(a.user_id, 'rfi_revised', 'RFI #' + old.rfi_number + ' revised',
          'RFI reopened for revision: ' + old.subject, '/rfis');
      }
    }

    res.json(rfi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE (admin only) ─────────────────────────────────────────────────

router.delete('/:rfiId', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const existing = await db.query('SELECT * FROM rfis WHERE id = $1', [req.params.rfiId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'RFI not found' });
    await logChange({ tableName: 'rfis', recordId: req.params.rfiId, operation: 'DELETE',
      oldValue: JSON.stringify({ rfi_number: existing.rows[0].rfi_number, subject: existing.rows[0].subject }),
      userId: req.user.id });
    await db.query("DELETE FROM related_items WHERE (source_type = 'rfi' AND source_id = $1) OR (target_type = 'rfi' AND target_id = $1)", [req.params.rfiId]);
    await db.query('DELETE FROM rfis WHERE id = $1', [req.params.rfiId]);
    res.json({ message: 'RFI deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
