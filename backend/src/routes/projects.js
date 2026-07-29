const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate: auth } = require('../middleware/auth');
const { logChange } = require('../changelog');

// Auto-create projects table if it doesn't exist + migrate columns
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT DEFAULT '',
      project_number VARCHAR(50),
      status VARCHAR(20) DEFAULT 'active',
      type VARCHAR(50),
      address VARCHAR(255),
      city VARCHAR(100),
      state VARCHAR(50),
      zip VARCHAR(20),
      country VARCHAR(50) DEFAULT 'USA',
      start_date DATE,
      estimated_completion_date DATE,
      actual_completion_date DATE,
      contract_value DECIMAL(15,2),
      square_footage INTEGER,
      owner_company VARCHAR(255),
      gc_company VARCHAR(255),
      architect_company VARCHAR(255),
      timezone VARCHAR(50) DEFAULT 'America/New_York',
      working_days JSONB DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":false,"sun":false}',
      box_folder_id VARCHAR(255),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Migration for existing tables — add new columns
    const migrations = [
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_number VARCHAR(50)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS type VARCHAR(50)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS address VARCHAR(255)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS city VARCHAR(100)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS state VARCHAR(50)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS zip VARCHAR(20)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS country VARCHAR(50) DEFAULT \'USA\'',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_completion_date DATE',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS actual_completion_date DATE',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_value DECIMAL(15,2)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS square_footage INTEGER',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_company VARCHAR(255)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS gc_company VARCHAR(255)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS architect_company VARCHAR(255)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT \'America/New_York\'',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS working_days JSONB',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS box_folder_id VARCHAR(255)',
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)',
      // Migrate old column names to new if they exist
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='project_type') THEN
          UPDATE projects SET type = project_type WHERE type IS NULL AND project_type IS NOT NULL;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='total_value') THEN
          UPDATE projects SET contract_value = total_value WHERE contract_value IS NULL AND total_value IS NOT NULL;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='owner_name') THEN
          UPDATE projects SET owner_company = owner_name WHERE owner_company IS NULL AND owner_name IS NOT NULL;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='general_contractor') THEN
          UPDATE projects SET gc_company = general_contractor WHERE gc_company IS NULL AND general_contractor IS NOT NULL;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='architect') THEN
          UPDATE projects SET architect_company = architect WHERE architect_company IS NULL AND architect IS NOT NULL;
        END IF;
      END $$`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='completion_date') THEN
          UPDATE projects SET actual_completion_date = completion_date WHERE actual_completion_date IS NULL AND completion_date IS NOT NULL;
        END IF;
      END $$`,
      // Ensure tasks table has project_id
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0',
      // Add unique constraint on project_number if not exists
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_project_number_key') THEN
          ALTER TABLE projects ADD CONSTRAINT projects_project_number_key UNIQUE (project_number);
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$`,
    ];
    for (const m of migrations) {
      await pool.query(m).catch(() => {});
    }

    console.log('Projects table ready (with updated schema)');
  } catch(err) { console.error('Projects migration error:', err.message); }
})();

const PROJECT_FIELDS = `id, name, description, project_number, status, type, address, city, state, zip, country,
  start_date, estimated_completion_date, actual_completion_date,
  contract_value, square_footage, owner_company, gc_company, architect_company,
  timezone, working_days, box_folder_id, workspace_id, created_by, created_at, updated_at`;

const ALLOWED_FIELDS = [
  'name', 'description', 'project_number', 'status', 'type',
  'address', 'city', 'state', 'zip', 'country',
  'start_date', 'estimated_completion_date', 'actual_completion_date',
  'contract_value', 'square_footage',
  'owner_company', 'gc_company', 'architect_company',
  'timezone', 'working_days', 'box_folder_id', 'workspace_id'
];

// GET /api/projects — list all (optionally scoped to ?workspace_id=N)
router.get('/', auth, async (req, res) => {
  try {
    const wsId = parseInt(req.query.workspace_id, 10);
    const result = Number.isFinite(wsId)
      ? await pool.query('SELECT ' + PROJECT_FIELDS + ' FROM projects WHERE workspace_id = $1 ORDER BY created_at DESC', [wsId])
      : await pool.query('SELECT ' + PROJECT_FIELDS + ' FROM projects ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/projects/:id — get one
router.get('/:id', auth, async (req, res) => {
  try {
    if (req.params.id === 'summary') return next(); // skip if /summary
    const result = await pool.query('SELECT ' + PROJECT_FIELDS + ' FROM projects WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/projects — create
router.post('/', auth, async (req, res) => {
  try {
    const fields = [];
    const placeholders = [];
    const vals = [];
    let idx = 1;

    for (const f of ALLOWED_FIELDS) {
      if (req.body[f] !== undefined) {
        fields.push(f);
        const val = f === 'working_days' ? JSON.stringify(req.body[f]) : req.body[f];
        placeholders.push('$' + idx);
        vals.push(val === '' ? null : val);
        idx++;
      }
    }
    fields.push('created_by');
    placeholders.push('$' + idx);
    vals.push(req.user.id);

    const result = await pool.query(
      'INSERT INTO projects (' + fields.join(', ') + ') VALUES (' + placeholders.join(', ') + ') RETURNING *',
      vals
    );
    logChange(req.user.id, 'projects', result.rows[0].id, 'create', null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/projects/:id — update
router.put('/:id', auth, async (req, res) => {
  try {
    const sets = ['updated_at = NOW()'];
    const vals = [];
    let idx = 1;
    const oldResult = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (oldResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) {
        const val = field === 'working_days' ? JSON.stringify(req.body[field]) : req.body[field];
        sets.push(field + ' = $' + idx);
        vals.push(val === '' ? null : val);
        idx++;
      }
    }
    vals.push(req.params.id);
    const result = await pool.query(
      'UPDATE projects SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING *',
      vals
    );
    logChange(req.user.id, 'projects', result.rows[0].id, 'update', oldResult.rows[0], result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/projects/:id — admin only soft delete
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const old = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    if (old.rows.length) logChange(req.user.id, 'projects', req.params.id, 'delete', old.rows[0], null);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/projects/:id/summary — dashboard rollup stats
router.get('/:id/summary', auth, async (req, res) => {
  try {
    const pid = req.params.id;
    const [project, taskStats, rfiStats, submittalStats, dailyLogStats, incidentStats] = await Promise.all([
      pool.query('SELECT ' + PROJECT_FIELDS + ' FROM projects WHERE id = $1', [pid]),
      pool.query(`SELECT
        COUNT(*) as total_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks,
        COUNT(*) FILTER (WHERE status = 'in_progress') as active_tasks,
        COUNT(*) FILTER (WHERE status = 'not_started') as pending_tasks,
        COUNT(*) FILTER (WHERE finish_date < NOW() AND status != 'completed') as overdue_tasks
        FROM tasks WHERE project_id = $1`, [pid]).catch(() => ({ rows: [{}] })),
      pool.query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'Open') as open,
        COUNT(*) FILTER (WHERE status = 'Closed') as closed
        FROM rfis WHERE project_id = $1`, [pid]).catch(() => ({ rows: [{}] })),
      pool.query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'Approved') as approved,
        COUNT(*) FILTER (WHERE status = 'Pending') as pending
        FROM submittals WHERE project_id = $1`, [pid]).catch(() => ({ rows: [{}] })),
      pool.query(`SELECT COUNT(*) as total FROM daily_logs WHERE project_id = $1`, [pid]).catch(() => ({ rows: [{}] })),
      pool.query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE osha_recordable = true) as osha_recordable
        FROM incidents WHERE project_id = $1`, [pid]).catch(() => ({ rows: [{}] })),
    ]);

    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });

    const tasks = taskStats.rows[0] || {};
    const pct = tasks.total_tasks > 0 ? Math.round((parseInt(tasks.completed_tasks || 0) / parseInt(tasks.total_tasks)) * 100) : 0;

    res.json({
      project: project.rows[0],
      tasks: { ...tasks, completion_percent: pct },
      rfis: rfiStats.rows[0] || {},
      submittals: submittalStats.rows[0] || {},
      daily_logs: dailyLogStats.rows[0] || {},
      incidents: incidentStats.rows[0] || {},
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Task sub-routes now handled by dedicated tasks router mounted at /api/projects/:id/tasks

router.get('/:id/box-folder', auth, async (req, res) => {
  try {
    var r = await pool.query('SELECT box_folder_id FROM projects WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ box_folder_id: r.rows[0].box_folder_id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/box-folder', auth, async (req, res) => {
  try {
    var r = await pool.query('UPDATE projects SET box_folder_id = $1 WHERE id = $2 RETURNING *', [req.body.box_folder_id, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
