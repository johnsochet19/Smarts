// Forms module — build public/internal forms; submissions can create records
// (punch items / tasks) and fire the `form_submitted` automation event.
var router = require('express').Router({ mergeParams: true });
var crypto = require('crypto');
var db = require('../db');
var { authenticate } = require('../middleware/auth');
var { runAutomationsForEvent } = require('../automation/runner');

/* ── auto-migrate ─────────────────────────────────────── */
(async function () {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS forms (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      token VARCHAR(40) UNIQUE,
      enabled BOOLEAN DEFAULT true,
      is_public BOOLEAN DEFAULT true,
      target_resource VARCHAR(30) DEFAULT 'none',
      fields JSONB DEFAULT '[]'::jsonb,
      settings JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      submission_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS form_submissions (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
      project_id INTEGER,
      data JSONB DEFAULT '{}'::jsonb,
      created_record_type VARCHAR(30),
      created_record_id INTEGER,
      submitted_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_forms_project ON forms(project_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_form_subs_form ON form_submissions(form_id)`);
    console.log('Forms tables ready');
  } catch (err) {
    console.error('Forms migration note:', err.message);
  }
})();

function getProjectId(req) {
  return req.params.id || req.params.projectId || req.query.project_id || (req.body && req.body.project_id);
}
function newToken() { return crypto.randomBytes(12).toString('hex'); }

// Public serializer — never expose internal-only fields.
function publicForm(f) {
  return {
    token: f.token, name: f.name, description: f.description,
    fields: (f.fields || []).filter(function (fl) { return !fl.internal; }),
    enabled: f.enabled, target_resource: f.target_resource,
  };
}

/* ── authenticated management ─────────────────────────── */

router.get('/', authenticate, async function (req, res) {
  try {
    var projectId = getProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    var r = await db.query('SELECT * FROM forms WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, async function (req, res) {
  try {
    var projectId = getProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    var { name, description, target_resource, fields, is_public, settings } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    var r = await db.query(
      `INSERT INTO forms (project_id, name, description, token, target_resource, fields, is_public, settings, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [projectId, name, description || null, newToken(), target_resource || 'none',
       JSON.stringify(fields || []), is_public !== false, JSON.stringify(settings || {}), req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:formId', authenticate, async function (req, res) {
  try {
    var { name, description, target_resource, fields, enabled, is_public, settings } = req.body;
    var r = await db.query(
      `UPDATE forms SET
         name = COALESCE($1,name), description = COALESCE($2,description),
         target_resource = COALESCE($3,target_resource),
         fields = COALESCE($4,fields), enabled = COALESCE($5,enabled),
         is_public = COALESCE($6,is_public), settings = COALESCE($7,settings), updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [name || null, description !== undefined ? description : null, target_resource || null,
       fields !== undefined ? JSON.stringify(fields) : null,
       typeof enabled === 'boolean' ? enabled : null,
       typeof is_public === 'boolean' ? is_public : null,
       settings !== undefined ? JSON.stringify(settings) : null, req.params.formId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:formId', authenticate, async function (req, res) {
  try {
    await db.query('DELETE FROM forms WHERE id = $1', [req.params.formId]);
    res.json({ message: 'Form deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:formId/submissions', authenticate, async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM form_submissions WHERE form_id = $1 ORDER BY created_at DESC LIMIT 200', [req.params.formId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── public (unauthenticated) ─────────────────────────── */

// GET public form by token
router.get('/public/:token', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM forms WHERE token = $1', [req.params.token]);
    if (!r.rows.length || !r.rows[0].enabled) return res.status(404).json({ error: 'Form not available' });
    res.json(publicForm(r.rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST submit (public) — validates required fields, stores, optionally creates a record.
router.post('/public/:token/submit', async function (req, res) {
  try {
    var fr = await db.query('SELECT * FROM forms WHERE token = $1', [req.params.token]);
    if (!fr.rows.length || !fr.rows[0].enabled) return res.status(404).json({ error: 'Form not available' });
    var form = fr.rows[0];
    var data = req.body && req.body.data ? req.body.data : {};

    // Server-side required validation.
    var missing = (form.fields || [])
      .filter(function (f) { return f.required && !f.hidden; })
      .filter(function (f) { return data[f.key] === undefined || data[f.key] === null || String(data[f.key]).trim() === ''; })
      .map(function (f) { return f.label || f.key; });
    if (missing.length) return res.status(400).json({ error: 'Missing required: ' + missing.join(', ') });

    var createdType = null, createdId = null;
    if (form.target_resource === 'punch_item') {
      var next = await db.query('SELECT COALESCE(MAX(punch_number),0)+1 AS n FROM punch_items WHERE project_id = $1', [form.project_id]);
      var pi = await db.query(
        `INSERT INTO punch_items (project_id, punch_number, title, description, priority, trade, location, due_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9) RETURNING id`,
        [form.project_id, next.rows[0].n, data.title || data.name || 'Form submission', data.description || null,
         data.priority || 'normal', data.trade || null, data.location || null, data.due_date || null, form.created_by]
      );
      createdType = 'punch_item'; createdId = pi.rows[0].id;
    } else if (form.target_resource === 'task') {
      var t = await db.query(
        `INSERT INTO tasks (title, name, description, status, priority, project_id, created_by)
         VALUES ($1,$1,$2,'open',$3,$4,$5) RETURNING id`,
        [data.title || data.name || 'Form submission', data.description || null, data.priority || 'normal', form.project_id, form.created_by]
      );
      createdType = 'task'; createdId = t.rows[0].id;
    }

    var sub = await db.query(
      'INSERT INTO form_submissions (form_id, project_id, data, created_record_type, created_record_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [form.id, form.project_id, JSON.stringify(data), createdType, createdId]
    );
    await db.query('UPDATE forms SET submission_count = COALESCE(submission_count,0)+1 WHERE id = $1', [form.id]).catch(function () {});

    // Fire the form_submitted automation event (non-blocking).
    runAutomationsForEvent(form.project_id, { type: 'form_submitted', resource: form.target_resource || 'form' },
      { record: Object.assign({ form_id: form.id, form_name: form.name }, data) });

    res.status(201).json({ ok: true, submission_id: sub.rows[0].id, created: createdType ? { type: createdType, id: createdId } : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
