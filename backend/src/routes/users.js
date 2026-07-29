const router = require('express').Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { logChange, logAllChanges } = require('../db/changelog');
const { authenticate, requireRole } = require('../middleware/auth');

// Auto-migrate users + create join tables
(async () => {
  try {
    // Users table columns
    const userMigrations = [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS trade VARCHAR(100)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()',
      // Keep legacy columns working
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id INTEGER',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS project_role VARCHAR(100)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_level VARCHAR(50)',
    ];
    for (const m of userMigrations) {
      await db.query(m).catch(() => {});
    }

    // project_users join table
    await db.query(`CREATE TABLE IF NOT EXISTS project_users (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, user_id)
    )`);

    // user_tool_permissions table
    await db.query(`CREATE TABLE IF NOT EXISTS user_tool_permissions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tool VARCHAR(50) NOT NULL,
      permission_level VARCHAR(20) DEFAULT 'standard',
      granular_perms JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, user_id, tool)
    )`);

    console.log('Users, project_users, user_tool_permissions tables ready');
  } catch(err) { console.error('Users migration error:', err.message); }
})();

const USER_SELECT = `id, name, first_name, last_name, email, phone, company_name, trade,
  role, is_active, last_login, created_at, updated_at`;

const USER_ROLES = ['superadmin', 'admin', 'user'];
const PROJECT_ROLES = ['owner', 'gc', 'subcontractor', 'architect', 'engineer', 'inspector'];
const TOOLS = ['tasks','rfi','submittals','inspections','drawings','budget','change_orders','contracts','schedule','daily_log','documents','photos','meetings','incidents'];
const PERMISSION_LEVELS = ['none', 'read_only', 'standard', 'admin'];

// ─── Users CRUD ──────────────────────────────────────────────────────────

// GET /api/users — list all (admin only)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query('SELECT ' + USER_SELECT + ' FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users/:id — get one
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT ' + USER_SELECT + ' FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/users — create (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { first_name, last_name, email, password, phone, company_name, trade, role = 'user', is_active } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!first_name || !last_name) return res.status(400).json({ error: 'first_name and last_name required' });
  const displayName = [first_name, last_name].filter(Boolean).join(' ');
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (name, first_name, last_name, email, password_hash, phone, company_name, trade, role, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ` + USER_SELECT,
      [displayName, first_name, last_name, email, hash, phone || null, company_name || null, trade || null, role, is_active !== false]
    );
    const user = result.rows[0];
    await logChange({ tableName: 'users', recordId: user.id, operation: 'CREATE', newValue: JSON.stringify({ name: displayName, email, role }), userId: req.user.id });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — update (admin only)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'User not found' });
    const old = existing.rows[0];

    const allowed = ['first_name', 'last_name', 'email', 'phone', 'company_name', 'trade', 'role', 'is_active'];
    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === 'is_active') updates[field] = req.body[field];
        else updates[field] = req.body[field] === '' ? null : req.body[field];
      }
    }
    // Auto-update display name if first/last changed
    if (req.body.first_name !== undefined || req.body.last_name !== undefined) {
      const fn = req.body.first_name !== undefined ? req.body.first_name : old.first_name;
      const ln = req.body.last_name !== undefined ? req.body.last_name : old.last_name;
      updates.name = [fn, ln].filter(Boolean).join(' ') || old.name;
    }
    if (req.body.password) updates.password_hash = await bcrypt.hash(req.body.password, 10);
    updates.updated_at = new Date();

    await logAllChanges({ tableName: 'users', recordId: id, oldRecord: old, newData: updates, userId: req.user.id });

    const keys = Object.keys(updates);
    if (!keys.length) return res.json(old);
    const setClause = keys.map((k, i) => k + ' = $' + (i + 1)).join(', ');
    const values = [...Object.values(updates), id];
    const result = await db.query(
      'UPDATE users SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING ' + USER_SELECT,
      values
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/users/:id — admin only
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'User not found' });
    await logChange({ tableName: 'users', recordId: id, operation: 'DELETE', oldValue: JSON.stringify(existing.rows[0]), userId: req.user.id });
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'User deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Project Users (join table) ─────────────────────────────────────────

// GET /api/users/project/:projectId — list users for a project with their roles
router.get('/project/:projectId', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.first_name, u.last_name, u.email, u.phone, u.company_name, u.trade,
              u.role as system_role, u.is_active, pu.role as project_role, pu.id as project_user_id, pu.created_at as assigned_at
       FROM project_users pu
       JOIN users u ON u.id = pu.user_id
       WHERE pu.project_id = $1
       ORDER BY pu.role, u.last_name, u.first_name`,
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/users/project/:projectId — assign user to project
router.post('/project/:projectId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { user_id, role } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const result = await db.query(
      `INSERT INTO project_users (project_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3
       RETURNING *`,
      [req.params.projectId, user_id, role || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/users/project/:projectId/:userId — update project role
router.put('/project/:projectId/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    const result = await db.query(
      'UPDATE project_users SET role = $1 WHERE project_id = $2 AND user_id = $3 RETURNING *',
      [role, req.params.projectId, req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project user not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/users/project/:projectId/:userId — remove user from project
router.delete('/project/:projectId/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM project_users WHERE project_id = $1 AND user_id = $2', [req.params.projectId, req.params.userId]);
    // Also remove their tool permissions for this project
    await db.query('DELETE FROM user_tool_permissions WHERE project_id = $1 AND user_id = $2', [req.params.projectId, req.params.userId]);
    res.json({ message: 'Removed from project' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Tool Permissions ───────────────────────────────────────────────────

// GET /api/users/permissions/:projectId/:userId — get all tool permissions for a user on a project
router.get('/permissions/:projectId/:userId', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM user_tool_permissions WHERE project_id = $1 AND user_id = $2 ORDER BY tool',
      [req.params.projectId, req.params.userId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/users/permissions/:projectId/:userId — bulk set tool permissions
router.put('/permissions/:projectId/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { permissions } = req.body; // Array of { tool, permission_level, granular_perms }
    if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions array required' });

    const results = [];
    for (const perm of permissions) {
      const r = await db.query(
        `INSERT INTO user_tool_permissions (project_id, user_id, tool, permission_level, granular_perms)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (project_id, user_id, tool) DO UPDATE SET permission_level = $4, granular_perms = $5
         RETURNING *`,
        [req.params.projectId, req.params.userId, perm.tool, perm.permission_level || 'standard', JSON.stringify(perm.granular_perms || {})]
      );
      results.push(r.rows[0]);
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users/permissions/check/:projectId/:userId/:tool — check single tool permission
router.get('/permissions/check/:projectId/:userId/:tool', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM user_tool_permissions WHERE project_id = $1 AND user_id = $2 AND tool = $3',
      [req.params.projectId, req.params.userId, req.params.tool]
    );
    if (result.rows.length === 0) {
      // No explicit permission = standard by default
      return res.json({ tool: req.params.tool, permission_level: 'standard', granular_perms: {} });
    }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users/meta/roles — return available roles/tools/permissions for frontend
router.get('/meta/roles', authenticate, async (req, res) => {
  res.json({
    user_roles: USER_ROLES,
    project_roles: PROJECT_ROLES,
    tools: TOOLS,
    permission_levels: PERMISSION_LEVELS,
  });
});

module.exports = router;
