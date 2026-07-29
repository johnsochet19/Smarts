const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { logChange, logAllChanges } = require('../db/changelog');
const { authenticate } = require('../middleware/auth');
const { onStatusChange, updateBallInCourt } = require('../notification-triggers');

// Auto-migrate submittals tables
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS submittals (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) NOT NULL,
      submittal_number INTEGER NOT NULL,
      revision_number INTEGER DEFAULT 0,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      type VARCHAR(50),
      division VARCHAR(100),
      spec_section VARCHAR(100),
      status VARCHAR(30) DEFAULT 'draft',
      submittal_manager_id INTEGER REFERENCES users(id),
      submitted_by_company VARCHAR(255),
      responsible_contractor VARCHAR(255),
      due_date DATE,
      submitted_date DATE,
      returned_date DATE,
      lead_time_days INTEGER,
      ball_in_court_id INTEGER REFERENCES users(id),
      private BOOLEAN DEFAULT false,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, submittal_number, revision_number)
    )`);

    const migrations = [
      'ALTER TABLE submittals ADD COLUMN IF NOT EXISTS private BOOLEAN DEFAULT false',
      'ALTER TABLE submittals ADD COLUMN IF NOT EXISTS submitted_by_company VARCHAR(255)',
      'ALTER TABLE submittals ADD COLUMN IF NOT EXISTS responsible_contractor VARCHAR(255)',
      'ALTER TABLE submittals ADD COLUMN IF NOT EXISTS ball_in_court_id INTEGER REFERENCES users(id)',
      'ALTER TABLE submittals ADD COLUMN IF NOT EXISTS returned_date DATE',
      'ALTER TABLE submittals ADD COLUMN IF NOT EXISTS lead_time_days INTEGER',
      // Migrate old column names
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='submittals' AND column_name='ball_in_court') THEN
          UPDATE submittals SET ball_in_court_id = ball_in_court WHERE ball_in_court_id IS NULL AND ball_in_court IS NOT NULL;
        END IF;
      END $$`,
      // Migrate status to lowercase snake_case
      "UPDATE submittals SET status = 'draft' WHERE status = 'Draft'",
      "UPDATE submittals SET status = 'open' WHERE status = 'Open'",
      "UPDATE submittals SET status = 'pending_submission' WHERE status = 'Pending Submission'",
      "UPDATE submittals SET status = 'submitted' WHERE status = 'Submitted'",
      "UPDATE submittals SET status = 'under_review' WHERE status = 'Under Review'",
      "UPDATE submittals SET status = 'approved' WHERE status = 'Approved'",
      "UPDATE submittals SET status = 'approved_as_noted' WHERE status = 'Approved as Noted'",
      "UPDATE submittals SET status = 'revise_and_resubmit' WHERE status = 'Revise and Resubmit'",
      "UPDATE submittals SET status = 'rejected' WHERE status = 'Rejected'",
      "UPDATE submittals SET status = 'closed' WHERE status = 'Closed'",
      // Migrate type to lowercase snake_case
      "UPDATE submittals SET type = 'shop_drawing' WHERE type = 'Shop Drawing'",
      "UPDATE submittals SET type = 'product_data' WHERE type = 'Product Data'",
      "UPDATE submittals SET type = 'sample' WHERE type = 'Sample'",
      "UPDATE submittals SET type = 'closeout' WHERE type = 'Closeout'",
      "UPDATE submittals SET type = 'other' WHERE type = 'Other'",
    ];
    for (const m of migrations) {
      await db.query(m).catch(() => {});
    }

    // submittal_approvers join table
    await db.query(`CREATE TABLE IF NOT EXISTS submittal_approvers (
      id SERIAL PRIMARY KEY,
      submittal_id INTEGER REFERENCES submittals(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      "order" INTEGER,
      response VARCHAR(30),
      notes TEXT,
      responded_at TIMESTAMP,
      UNIQUE(submittal_id, user_id)
    )`);

    // Migrate legacy JSONB approvers → submittal_approvers
    await db.query(`
      INSERT INTO submittal_approvers (submittal_id, user_id, response)
      SELECT s.id,
        CASE WHEN jsonb_typeof(elem) = 'object' THEN (elem->>'user_id')::int
             ELSE (elem::text)::int END,
        CASE WHEN jsonb_typeof(elem) = 'object' THEN elem->>'response'
             ELSE NULL END
      FROM submittals s, jsonb_array_elements(s.approvers) elem
      WHERE s.approvers IS NOT NULL AND jsonb_array_length(s.approvers) > 0
      ON CONFLICT (submittal_id, user_id) DO NOTHING
    `).catch(() => {});

    // Drop the unique constraint on (project_id, submittal_number) if it exists and add the new one
    await db.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submittals_project_id_submittal_number_key') THEN
          ALTER TABLE submittals DROP CONSTRAINT submittals_project_id_submittal_number_key;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$
    `).catch(() => {});

    console.log('Submittals, submittal_approvers tables ready');
  } catch(err) { console.error('Submittals migration error:', err.message); }
})();

const SUBMITTAL_STATUSES = [
  'draft', 'open', 'pending_submission', 'submitted', 'under_review',
  'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected', 'closed'
];
const SUBMITTAL_TYPES = ['shop_drawing', 'product_data', 'sample', 'closeout', 'other'];
const APPROVER_RESPONSES = ['pending', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'];

const CSI_DIVISIONS = [
  '01 - General Requirements', '02 - Existing Conditions', '03 - Concrete',
  '04 - Masonry', '05 - Metals', '06 - Wood, Plastics & Composites',
  '07 - Thermal & Moisture Protection', '08 - Openings', '09 - Finishes',
  '10 - Specialties', '11 - Equipment', '12 - Furnishings',
  '13 - Special Construction', '14 - Conveying Equipment',
  '21 - Fire Suppression', '22 - Plumbing', '23 - HVAC',
  '26 - Electrical', '27 - Communications', '28 - Electronic Safety',
  '31 - Earthwork', '32 - Exterior Improvements', '33 - Utilities'
];

const SUB_SELECT = `s.id, s.project_id, s.submittal_number, s.revision_number, s.title,
  s.description, s.type, s.division, s.spec_section, s.status,
  s.submittal_manager_id, s.submitted_by_company, s.responsible_contractor,
  s.due_date, s.submitted_date, s.returned_date, s.lead_time_days,
  s.ball_in_court_id, s.private, s.created_by, s.created_at, s.updated_at`;

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getNextNumber(projectId) {
  const r = await db.query(
    'SELECT COALESCE(MAX(submittal_number), 0) + 1 as next FROM submittals WHERE project_id = $1',
    [projectId]);
  return r.rows[0].next;
}

async function notify(userId, type, title, message, link) {
  try {
    if (userId) await db.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)',
      [userId, type, title, message || '', link || '']);
  } catch(e) {}
}

async function getApprovers(submittalId) {
  const r = await db.query(
    `SELECT sa.user_id, sa."order", sa.response, sa.notes, sa.responded_at,
            u.name, u.first_name, u.last_name, u.email
     FROM submittal_approvers sa JOIN users u ON u.id = sa.user_id
     WHERE sa.submittal_id = $1 ORDER BY sa."order" ASC, sa.id ASC`, [submittalId]);
  return r.rows;
}

async function getRelatedItems(submittalId) {
  const r = await db.query(
    `SELECT * FROM related_items
     WHERE (source_type = 'submittal' AND source_id = $1)
        OR (target_type = 'submittal' AND target_id = $1)
     ORDER BY created_at DESC`, [submittalId]);
  return r.rows;
}

async function enrichSubmittals(subs) {
  if (!subs.length) return subs;
  const ids = subs.map(s => s.id);
  const [appResult, relResult] = await Promise.all([
    db.query(
      `SELECT sa.submittal_id, sa.user_id, sa."order", sa.response, sa.notes, sa.responded_at,
              u.name, u.first_name, u.last_name, u.email
       FROM submittal_approvers sa JOIN users u ON u.id = sa.user_id
       WHERE sa.submittal_id = ANY($1) ORDER BY sa."order" ASC, sa.id ASC`, [ids]),
    db.query(
      `SELECT * FROM related_items
       WHERE (source_type = 'submittal' AND source_id = ANY($1))
          OR (target_type = 'submittal' AND target_id = ANY($1))`, [ids])
  ]);
  const appMap = {}, relMap = {};
  for (const row of appResult.rows) {
    if (!appMap[row.submittal_id]) appMap[row.submittal_id] = [];
    appMap[row.submittal_id].push(row);
  }
  for (const row of relResult.rows) {
    const sid = row.source_type === 'submittal' ? row.source_id : row.target_id;
    if (!relMap[sid]) relMap[sid] = [];
    relMap[sid].push(row);
  }
  return subs.map(s => Object.assign({}, s, {
    approvers: appMap[s.id] || [],
    related_items: relMap[s.id] || []
  }));
}

function validateProject(req, res, next) {
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(projectId);
  next();
}

// ─── GET /api/projects/:id/submittals ────────────────────────────────────

router.get('/', authenticate, validateProject, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ' + SUB_SELECT + ' FROM submittals s WHERE s.project_id = $1 ORDER BY s.submittal_number DESC, s.revision_number DESC',
      [req.projectId]);
    const enriched = await enrichSubmittals(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/submittals ───────────────────────────────────

router.post('/', authenticate, validateProject, async (req, res) => {
  const {
    title, description, type, division, spec_section, status, private: isPrivate,
    submittal_manager_id, submitted_by_company, responsible_contractor,
    due_date, submitted_date, lead_time_days, ball_in_court_id,
    approvers, related_items
  } = req.body;

  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const submittal_number = await getNextNumber(req.projectId);
    const subStatus = status || 'draft';

    const result = await db.query(
      `INSERT INTO submittals (
        project_id, submittal_number, title, description, type, division, spec_section,
        status, private, submittal_manager_id, submitted_by_company, responsible_contractor,
        due_date, submitted_date, lead_time_days, ball_in_court_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING ` + SUB_SELECT.replace(/s\./g, ''),
      [
        req.projectId, submittal_number, title, description || null,
        type || 'shop_drawing', division || null, spec_section || null,
        subStatus, isPrivate || false,
        submittal_manager_id || null, submitted_by_company || null, responsible_contractor || null,
        due_date || null, submitted_date || null, lead_time_days || null,
        ball_in_court_id || submittal_manager_id || null,
        req.user.id
      ]
    );
    const sub = result.rows[0];

    // Insert approvers
    if (Array.isArray(approvers)) {
      for (let i = 0; i < approvers.length; i++) {
        const a = approvers[i];
        const uid = typeof a === 'object' ? (a.user_id || a.id) : Number(a);
        const order = typeof a === 'object' && a.order != null ? a.order : i + 1;
        await db.query(
          'INSERT INTO submittal_approvers (submittal_id, user_id, "order", response) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [sub.id, uid, order, 'pending']
        ).catch(() => {});
      }
    }

    // Insert related items
    if (Array.isArray(related_items)) {
      for (const rel of related_items) {
        if (typeof rel === 'string') {
          await db.query(
            `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
             VALUES ('submittal', $1, $2, 0, $3) ON CONFLICT DO NOTHING`,
            [sub.id, rel.toLowerCase(), req.user.id]).catch(() => {});
        } else if (rel.target_type && rel.target_id) {
          await db.query(
            `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
             VALUES ('submittal', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [sub.id, rel.target_type, rel.target_id, req.user.id]).catch(() => {});
        }
      }
    }

    sub.approvers = await getApprovers(sub.id);
    sub.related_items = await getRelatedItems(sub.id);

    await logChange({ tableName: 'submittals', recordId: sub.id, operation: 'CREATE',
      newValue: JSON.stringify({ submittal_number, title }), userId: req.user.id });

    if (submittal_manager_id && submittal_manager_id !== req.user.id) {
      notify(submittal_manager_id, 'submittal_created', 'New Submittal #' + submittal_number,
        'Submittal created: ' + title, '/submittals');
    }
    await updateBallInCourt('submittal', sub.id, sub.status || 'draft');

    res.status(201).json(sub);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/projects/:id/submittals/:subId ─────────────────────────────

router.get('/:subId', authenticate, validateProject, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ' + SUB_SELECT + ' FROM submittals s WHERE s.id = $1 AND s.project_id = $2',
      [req.params.subId, req.projectId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Submittal not found' });
    const sub = result.rows[0];
    sub.approvers = await getApprovers(sub.id);
    sub.related_items = await getRelatedItems(sub.id);
    res.json(sub);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/projects/:id/submittals/:subId ─────────────────────────────

router.put('/:subId', authenticate, validateProject, async (req, res) => {
  const { subId } = req.params;
  try {
    const existing = await db.query('SELECT * FROM submittals WHERE id = $1 AND project_id = $2', [subId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Submittal not found' });
    const old = existing.rows[0];

    const allowed = [
      'title', 'description', 'type', 'division', 'spec_section', 'private',
      'submittal_manager_id', 'submitted_by_company', 'responsible_contractor',
      'due_date', 'submitted_date', 'returned_date', 'lead_time_days', 'ball_in_court_id'
    ];
    const newData = { updated_at: new Date() };
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === 'private') {
          newData[field] = req.body[field];
        } else {
          newData[field] = req.body[field] === '' ? null : req.body[field];
        }
      }
    }

    await logAllChanges({ tableName: 'submittals', recordId: subId, oldRecord: old, newData: req.body, userId: req.user.id });

    const keys = Object.keys(newData);
    if (keys.length > 1) {
      const setClause = keys.map((k, i) => k + ' = $' + (i + 1)).join(', ');
      const values = [...Object.values(newData), subId];
      await db.query('UPDATE submittals SET ' + setClause + ' WHERE id = $' + values.length, values);
    }

    // Update approvers if provided
    if (req.body.approvers !== undefined) {
      await db.query('DELETE FROM submittal_approvers WHERE submittal_id = $1', [subId]);
      if (Array.isArray(req.body.approvers)) {
        for (let i = 0; i < req.body.approvers.length; i++) {
          const a = req.body.approvers[i];
          const uid = typeof a === 'object' ? (a.user_id || a.id) : Number(a);
          const order = typeof a === 'object' && a.order != null ? a.order : i + 1;
          const response = typeof a === 'object' ? (a.response || 'pending') : 'pending';
          await db.query(
            'INSERT INTO submittal_approvers (submittal_id, user_id, "order", response) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [subId, uid, order, response]
          ).catch(() => {});
        }
      }
    }

    // Update related items if provided
    if (req.body.related_items !== undefined) {
      await db.query("DELETE FROM related_items WHERE source_type = 'submittal' AND source_id = $1", [subId]);
      if (Array.isArray(req.body.related_items)) {
        for (const rel of req.body.related_items) {
          if (typeof rel === 'string') {
            await db.query(
              `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
               VALUES ('submittal', $1, $2, 0, $3) ON CONFLICT DO NOTHING`,
              [subId, rel.toLowerCase(), req.user.id]).catch(() => {});
          } else if (rel.target_type && rel.target_id) {
            await db.query(
              `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
               VALUES ('submittal', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [subId, rel.target_type, rel.target_id, req.user.id]).catch(() => {});
          }
        }
      }
    }

    const updated = await db.query('SELECT ' + SUB_SELECT + ' FROM submittals s WHERE s.id = $1', [subId]);
    const sub = updated.rows[0];
    sub.approvers = await getApprovers(subId);
    sub.related_items = await getRelatedItems(subId);
    res.json(sub);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/projects/:id/submittals/:subId/status ──────────────────────

router.put('/:subId/status', authenticate, validateProject, async (req, res) => {
  const { subId } = req.params;
  const { status } = req.body;
  if (!status || !SUBMITTAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be: ' + SUBMITTAL_STATUSES.join(', ') });
  }
  try {
    const existing = await db.query('SELECT * FROM submittals WHERE id = $1 AND project_id = $2', [subId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Submittal not found' });
    const old = existing.rows[0];

    const updates = { status, updated_at: new Date() };

    // Auto-set submitted_date
    if (status === 'submitted' && !old.submitted_date) {
      updates.submitted_date = new Date().toISOString().substring(0, 10);
    }
    // Auto-set returned_date on approval/rejection
    if (['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'].includes(status) && !old.returned_date) {
      updates.returned_date = new Date().toISOString().substring(0, 10);
    }
    // Revise and resubmit → creates new revision when re-submitted
    if (status === 'submitted' && old.status === 'revise_and_resubmit') {
      updates.revision_number = (old.revision_number || 0) + 1;
      updates.returned_date = null; // Reset for new cycle
    }

    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => k + ' = $' + (i + 1)).join(', ');
    const values = [...Object.values(updates), subId];
    await db.query('UPDATE submittals SET ' + setClause + ' WHERE id = $' + values.length, values);

    await logChange({ tableName: 'submittals', recordId: subId, operation: 'UPDATE',
      fieldChanged: 'status', oldValue: old.status, newValue: status, userId: req.user.id });
    await onStatusChange('submittal', subId, status, req.projectId, req.user.id);
    await updateBallInCourt('submittal', subId, status);

    const result = await db.query('SELECT ' + SUB_SELECT + ' FROM submittals s WHERE s.id = $1', [subId]);
    const sub = result.rows[0];
    sub.approvers = await getApprovers(subId);
    sub.related_items = await getRelatedItems(subId);

    // Notify manager on status changes
    if (old.submittal_manager_id && old.submittal_manager_id !== req.user.id) {
      notify(old.submittal_manager_id, 'submittal_status', 'Submittal #' + old.submittal_number + ' status changed',
        old.title + ' → ' + status, '/submittals');
    }

    res.json(sub);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/submittals/:subId/approve — approver response

router.post('/:subId/approve', authenticate, validateProject, async (req, res) => {
  const { subId } = req.params;
  const { response, notes } = req.body;
  if (!response || !APPROVER_RESPONSES.includes(response)) {
    return res.status(400).json({ error: 'Invalid response. Must be: ' + APPROVER_RESPONSES.join(', ') });
  }
  try {
    const existing = await db.query('SELECT * FROM submittals WHERE id = $1 AND project_id = $2', [subId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Submittal not found' });

    // Update approver response
    const updated = await db.query(
      `UPDATE submittal_approvers SET response = $1, notes = $2, responded_at = NOW()
       WHERE submittal_id = $3 AND user_id = $4 RETURNING *`,
      [response, notes || null, subId, req.user.id]
    );
    if (!updated.rows.length) {
      return res.status(403).json({ error: 'You are not an approver for this submittal' });
    }

    // Check if all approvers have responded — determine aggregate status
    const allApprovers = await getApprovers(subId);
    const allResponded = allApprovers.every(a => a.response && a.response !== 'pending');

    if (allResponded) {
      // Determine overall result: worst response wins
      let overallStatus = 'approved';
      for (const a of allApprovers) {
        if (a.response === 'rejected') { overallStatus = 'rejected'; break; }
        if (a.response === 'revise_and_resubmit') { overallStatus = 'revise_and_resubmit'; break; }
        if (a.response === 'approved_as_noted') overallStatus = 'approved_as_noted';
      }
      await db.query(
        'UPDATE submittals SET status = $1, returned_date = $2, updated_at = NOW() WHERE id = $3',
        [overallStatus, new Date().toISOString().substring(0, 10), subId]
      );

      // If revise_and_resubmit, increment revision for next submission
      if (overallStatus === 'revise_and_resubmit') {
        // revision_number will be incremented when re-submitted
      }
    }

    const result = await db.query('SELECT ' + SUB_SELECT + ' FROM submittals s WHERE s.id = $1', [subId]);
    const sub = result.rows[0];
    sub.approvers = allApprovers;
    sub.related_items = await getRelatedItems(subId);

    // Notify creator
    if (existing.rows[0].created_by && existing.rows[0].created_by !== req.user.id) {
      notify(existing.rows[0].created_by, 'submittal_review', 'Submittal #' + existing.rows[0].submittal_number + ' reviewed',
        response + ' by approver on: ' + existing.rows[0].title, '/submittals');
    }

    // Update BIC after approver response (may shift to next approver or back to submitter)
    await updateBallInCourt('submittal', subId, sub.status);

    res.json(sub);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/projects/:id/submittals/:subId ──────────────────────────

router.delete('/:subId', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const existing = await db.query('SELECT * FROM submittals WHERE id = $1', [req.params.subId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Submittal not found' });
    await logChange({ tableName: 'submittals', recordId: req.params.subId, operation: 'DELETE',
      oldValue: JSON.stringify({ submittal_number: existing.rows[0].submittal_number, title: existing.rows[0].title }),
      userId: req.user.id });
    await db.query("DELETE FROM related_items WHERE (source_type = 'submittal' AND source_id = $1) OR (target_type = 'submittal' AND target_id = $1)", [req.params.subId]);
    await db.query('DELETE FROM submittals WHERE id = $1', [req.params.subId]);
    res.json({ message: 'Submittal deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Meta ────────────────────────────────────────────────────────────────

router.get('/meta/options', authenticate, (req, res) => {
  res.json({
    statuses: SUBMITTAL_STATUSES,
    types: SUBMITTAL_TYPES,
    csi_divisions: CSI_DIVISIONS,
    approver_responses: APPROVER_RESPONSES,
  });
});

module.exports = router;
