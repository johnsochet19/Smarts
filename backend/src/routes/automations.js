// Automation CRUD + manual run + run log.
var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { authenticate } = require('../middleware/auth');
var { TRIGGER_TYPES, ACTION_TYPES, decide } = require('../automation/engine');
var { runAutomationsForEvent } = require('../automation/runner');

/* ── auto-migrate ─────────────────────────────────────── */
(async function () {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS automations (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      enabled BOOLEAN DEFAULT true,
      trigger JSONB DEFAULT '{}'::jsonb,
      conditions JSONB DEFAULT '[]'::jsonb,
      actions JSONB DEFAULT '[]'::jsonb,
      created_by INTEGER REFERENCES users(id),
      run_count INTEGER DEFAULT 0,
      last_run TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS automation_runs (
      id SERIAL PRIMARY KEY,
      automation_id INTEGER REFERENCES automations(id) ON DELETE CASCADE,
      event_type VARCHAR(50),
      status VARCHAR(20),
      detail TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id)`);
    console.log('Automations tables ready');
  } catch (err) {
    console.error('Automations migration note:', err.message);
  }
})();

function getProjectId(req) {
  return req.params.id || req.params.projectId || req.query.project_id || (req.body && req.body.project_id);
}

// Metadata for the builder UI
router.get('/meta', authenticate, function (req, res) {
  res.json({ triggers: TRIGGER_TYPES, actions: ACTION_TYPES });
});

// List
router.get('/', authenticate, async function (req, res) {
  try {
    var projectId = getProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    var result = await db.query('SELECT * FROM automations WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create
router.post('/', authenticate, async function (req, res) {
  try {
    var projectId = getProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'project_id required' });
    var { name, enabled, trigger, conditions, actions } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    if (trigger && trigger.type && TRIGGER_TYPES.indexOf(trigger.type) === -1) {
      return res.status(400).json({ error: 'Invalid trigger type' });
    }
    var result = await db.query(
      `INSERT INTO automations (project_id, name, enabled, trigger, conditions, actions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [projectId, name, enabled !== false, JSON.stringify(trigger || {}), JSON.stringify(conditions || []), JSON.stringify(actions || []), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update
router.put('/:autoId', authenticate, async function (req, res) {
  try {
    var { name, enabled, trigger, conditions, actions } = req.body;
    var result = await db.query(
      `UPDATE automations SET
         name = COALESCE($1, name),
         enabled = COALESCE($2, enabled),
         trigger = COALESCE($3, trigger),
         conditions = COALESCE($4, conditions),
         actions = COALESCE($5, actions),
         updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name || null, typeof enabled === 'boolean' ? enabled : null,
       trigger !== undefined ? JSON.stringify(trigger) : null,
       conditions !== undefined ? JSON.stringify(conditions) : null,
       actions !== undefined ? JSON.stringify(actions) : null,
       req.params.autoId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Automation not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete
router.delete('/:autoId', authenticate, async function (req, res) {
  try {
    await db.query('DELETE FROM automations WHERE id = $1', [req.params.autoId]);
    res.json({ message: 'Automation deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Run log
router.get('/:autoId/runs', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM automation_runs WHERE automation_id = $1 ORDER BY created_at DESC LIMIT 50', [req.params.autoId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dry-run against a sample record (does not perform side effects)
router.post('/:autoId/test', authenticate, async function (req, res) {
  try {
    var a = await db.query('SELECT * FROM automations WHERE id = $1', [req.params.autoId]);
    if (!a.rows.length) return res.status(404).json({ error: 'Automation not found' });
    var automation = a.rows[0];
    var parsed = {
      ...automation,
      trigger: typeof automation.trigger === 'string' ? JSON.parse(automation.trigger) : automation.trigger,
      conditions: typeof automation.conditions === 'string' ? JSON.parse(automation.conditions) : automation.conditions,
      actions: typeof automation.actions === 'string' ? JSON.parse(automation.actions) : automation.actions,
    };
    var event = req.body.event || { type: parsed.trigger.type, resource: parsed.trigger.resource };
    var record = req.body.record || {};
    var decision = decide(parsed, event, { record: record, projectId: automation.project_id });
    res.json({ fire: decision.fire, plannedActions: decision.actions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
