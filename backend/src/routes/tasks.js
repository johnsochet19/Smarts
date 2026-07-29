const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { logChange, logAllChanges } = require('../db/changelog');
const { authenticate } = require('../middleware/auth');
const { onStatusChange, onAssignment } = require('../notification-triggers');
const { runAutomationsForEvent } = require('../automation/runner');

// Auto-migrate tasks table + create join tables + related_items
(async () => {
  try {
    // Core task columns
    const taskMigrations = [
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title VARCHAR(255)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT \'normal\'',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_date TIMESTAMP',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS private BOOLEAN DEFAULT false',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()',
      // Legacy columns kept for backward compat
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to INTEGER',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_days INTEGER',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS phase VARCHAR(100)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS color VARCHAR(20)',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS trade VARCHAR(255)',
      // Migrate is_private → private
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='is_private') THEN
          UPDATE tasks SET private = is_private WHERE private IS NULL AND is_private IS NOT NULL;
        END IF;
      END $$`,
      // Migrate priority values to lowercase
      "UPDATE tasks SET priority = LOWER(priority) WHERE priority IS DISTINCT FROM LOWER(priority)",
      // Migrate old status 'not_started' → 'open'
      "UPDATE tasks SET status = 'open' WHERE status = 'not_started'",
    ];
    for (const m of taskMigrations) {
      await db.query(m).catch(() => {});
    }

    // task_assignees join table
    await db.query(`CREATE TABLE IF NOT EXISTS task_assignees (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(task_id, user_id)
    )`);

    // task_attachments table
    await db.query(`CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      file_name VARCHAR(255),
      file_url VARCHAR(500),
      file_size INTEGER,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TIMESTAMP DEFAULT NOW()
    )`);

    // ─── related_items — universal join table for ALL modules ────────────
    await db.query(`CREATE TABLE IF NOT EXISTS related_items (
      id SERIAL PRIMARY KEY,
      source_type VARCHAR(50) NOT NULL,
      source_id INTEGER NOT NULL,
      target_type VARCHAR(50) NOT NULL,
      target_id INTEGER NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(source_type, source_id, target_type, target_id)
    )`);
    // Index for fast lookups in both directions
    await db.query('CREATE INDEX IF NOT EXISTS idx_related_items_source ON related_items(source_type, source_id)').catch(() => {});
    await db.query('CREATE INDEX IF NOT EXISTS idx_related_items_target ON related_items(target_type, target_id)').catch(() => {});

    // Migrate legacy JSONB assignees into task_assignees
    await db.query(`
      INSERT INTO task_assignees (task_id, user_id)
      SELECT t.id, (elem::text)::int
      FROM tasks t, jsonb_array_elements(t.assignees) elem
      WHERE t.assignees IS NOT NULL AND jsonb_array_length(t.assignees) > 0
      ON CONFLICT (task_id, user_id) DO NOTHING
    `).catch(() => {});

    // Migrate legacy assigned_to into task_assignees
    await db.query(`
      INSERT INTO task_assignees (task_id, user_id)
      SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL
      ON CONFLICT (task_id, user_id) DO NOTHING
    `).catch(() => {});

    console.log('Tasks, task_assignees, task_attachments, related_items tables ready');
  } catch(err) { console.error('Tasks migration error:', err.message); }
})();

const TASK_STATUSES = ['draft', 'open', 'in_progress', 'completed', 'closed'];
const TASK_PRIORITIES = ['low', 'normal', 'high', 'critical'];

const TASK_SELECT = `t.id, t.project_id, t.title, COALESCE(t.title, t.name) as name, t.description,
  t.status, t.priority, t.created_by, t.due_date, t.completed_date, t.private,
  t.sort_order, t.parent_task_id, t.start_date, t.finish_date, t.duration_days,
  t.phase, t.trade, t.color, t.notes, t.created_at, t.updated_at`;

// Auto-generate notification
async function notify(userId, type, title, message, link) {
  try {
    if (userId) await db.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)',
      [userId, type, title, message || '', link || '']
    );
  } catch(e) { /* silent */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getAssignees(taskId) {
  const r = await db.query(
    `SELECT ta.user_id, u.name, u.first_name, u.last_name, u.email, u.trade
     FROM task_assignees ta JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id = $1 ORDER BY ta.id`, [taskId]);
  return r.rows;
}

async function getAttachments(taskId) {
  const r = await db.query(
    'SELECT * FROM task_attachments WHERE task_id = $1 ORDER BY uploaded_at DESC', [taskId]);
  return r.rows;
}

async function getRelatedItems(sourceType, sourceId) {
  const r = await db.query(
    `SELECT * FROM related_items
     WHERE (source_type = $1 AND source_id = $2) OR (target_type = $1 AND target_id = $2)
     ORDER BY created_at DESC`,
    [sourceType, sourceId]);
  return r.rows;
}

async function enrichTasks(tasks) {
  if (!tasks.length) return tasks;
  const ids = tasks.map(t => t.id);
  const [assResult, relResult] = await Promise.all([
    db.query(
      `SELECT ta.task_id, ta.user_id, u.name, u.first_name, u.last_name, u.email
       FROM task_assignees ta JOIN users u ON u.id = ta.user_id
       WHERE ta.task_id = ANY($1)`, [ids]),
    db.query(
      `SELECT * FROM related_items
       WHERE (source_type = 'task' AND source_id = ANY($1))
          OR (target_type = 'task' AND target_id = ANY($1))`, [ids])
  ]);
  const assMap = {};
  for (const row of assResult.rows) {
    if (!assMap[row.task_id]) assMap[row.task_id] = [];
    assMap[row.task_id].push(row);
  }
  const relMap = {};
  for (const row of relResult.rows) {
    const tid = row.source_type === 'task' ? row.source_id : row.target_id;
    if (!relMap[tid]) relMap[tid] = [];
    relMap[tid].push(row);
  }
  return tasks.map(t => Object.assign({}, t, {
    assignees: assMap[t.id] || [],
    related_items: relMap[t.id] || []
  }));
}

function validateProject(req, res, next) {
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(projectId);
  next();
}

// ─── GET /api/projects/:id/tasks — list tasks for a project ─────────────

router.get('/', authenticate, validateProject, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ' + TASK_SELECT + ' FROM tasks t WHERE t.project_id = $1 ORDER BY t.sort_order ASC, t.created_at ASC',
      [req.projectId]
    );
    const enriched = await enrichTasks(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/tasks — create task ─────────────────────────

router.post('/', authenticate, validateProject, async (req, res) => {
  const {
    title, name, description, status, priority, due_date, private: isPrivate,
    sort_order, parent_task_id,
    start_date, finish_date, duration_days, phase, trade, color, notes,
    assignees, assigned_to, related_items
  } = req.body;

  const taskTitle = title || name;
  if (!taskTitle) return res.status(400).json({ error: 'title required' });

  const taskStatus = status || 'open';
  if (!TASK_STATUSES.includes(taskStatus)) {
    return res.status(400).json({ error: 'Invalid status. Must be: ' + TASK_STATUSES.join(', ') });
  }

  try {
    const result = await db.query(
      `INSERT INTO tasks (
        title, name, description, status, priority, created_by, due_date, private,
        sort_order, parent_task_id, project_id,
        start_date, finish_date, duration_days, phase, trade, color, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING ` + TASK_SELECT.replace(/t\./g, ''),
      [
        taskTitle, taskTitle, description || null, taskStatus,
        priority || 'normal', req.user.id, due_date || finish_date || null,
        isPrivate || false, sort_order || null, parent_task_id || null, req.projectId,
        start_date || null, finish_date || due_date || null, duration_days || null,
        phase || null, trade || null, color || '#3b82f6', notes || null
      ]
    );
    const task = result.rows[0];

    // Insert assignees
    const allAssignees = [];
    if (assigned_to) allAssignees.push(Number(assigned_to));
    if (Array.isArray(assignees)) {
      for (const uid of assignees) {
        const numUid = typeof uid === 'object' ? (uid.user_id || uid.id) : Number(uid);
        if (!allAssignees.includes(numUid)) allAssignees.push(numUid);
      }
    }
    for (const uid of allAssignees) {
      await db.query(
        'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [task.id, uid]
      );
    }

    // Insert related items
    if (Array.isArray(related_items)) {
      for (const rel of related_items) {
        if (typeof rel === 'string') {
          // Simple type string like "RFI" — store as type reference without target_id
          await db.query(
            `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
             VALUES ('task', $1, $2, 0, $3) ON CONFLICT DO NOTHING`,
            [task.id, rel.toLowerCase(), req.user.id]
          ).catch(() => {});
        } else if (rel.target_type && rel.target_id) {
          await db.query(
            `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
             VALUES ('task', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [task.id, rel.target_type, rel.target_id, req.user.id]
          ).catch(() => {});
        }
      }
    }

    task.assignees = await getAssignees(task.id);
    task.related_items = await getRelatedItems('task', task.id);

    await logChange({ tableName: 'tasks', recordId: task.id, operation: 'CREATE', newValue: JSON.stringify(task), userId: req.user.id });

    // Notify assignees (legacy + trigger engine)
    for (const uid of allAssignees) {
      if (uid !== req.user.id) {
        notify(uid, 'task_assigned', 'New task assigned', 'You were assigned: ' + taskTitle, '/tasks');
      }
    }
    if (allAssignees.length > 0) {
      await onAssignment('task', task.id, req.projectId, req.user.id);
    }

    // Fire automations for task creation (non-blocking, never breaks the flow)
    runAutomationsForEvent(req.projectId, { type: 'task_created', resource: 'task' }, { record: task });

    res.status(201).json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/tasks/reorder ────────────────────────────────

router.post('/reorder', authenticate, validateProject, async (req, res) => {
  try {
    const { order, taskIds } = req.body;
    const ids = order || taskIds;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'order array required' });
    for (let i = 0; i < ids.length; i++) {
      await db.query('UPDATE tasks SET sort_order = $1 WHERE id = $2 AND project_id = $3',
        [i, ids[i], req.projectId]);
    }
    res.json({ reordered: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/projects/:id/tasks/:taskId — get single task ──────────────

router.get('/:taskId', authenticate, validateProject, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT ' + TASK_SELECT + ' FROM tasks t WHERE t.id = $1 AND t.project_id = $2',
      [req.params.taskId, req.projectId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = result.rows[0];
    task.assignees = await getAssignees(task.id);
    task.attachments = await getAttachments(task.id);
    task.related_items = await getRelatedItems('task', task.id);
    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/projects/:id/tasks/:taskId — update task ──────────────────

router.put('/:taskId', authenticate, validateProject, async (req, res) => {
  const { taskId } = req.params;
  try {
    const existing = await db.query('SELECT * FROM tasks WHERE id = $1 AND project_id = $2', [taskId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Task not found' });
    const old = existing.rows[0];

    if (req.body.status && req.body.status !== old.status) {
      if (!TASK_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: 'Invalid status. Must be: ' + TASK_STATUSES.join(', ') });
      }
    }

    const allowed = [
      'title', 'name', 'description', 'status', 'priority', 'due_date',
      'completed_date', 'private', 'sort_order', 'parent_task_id',
      'start_date', 'finish_date', 'duration_days', 'phase', 'trade', 'color', 'notes'
    ];
    const newData = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === 'private') {
          newData[field] = req.body[field];
        } else {
          newData[field] = req.body[field] === '' ? null : req.body[field];
        }
      }
    }
    if (newData.title && !newData.name) newData.name = newData.title;
    if (newData.name && !newData.title) newData.title = newData.name;

    // Auto-set completed_date when status → completed
    if (newData.status === 'completed' && old.status !== 'completed' && !newData.completed_date) {
      newData.completed_date = new Date();
    }
    if (newData.status && newData.status !== 'completed' && old.status === 'completed') {
      newData.completed_date = null;
    }

    await logAllChanges({ tableName: 'tasks', recordId: taskId, oldRecord: old, newData: req.body, userId: req.user.id });

    const keys = Object.keys(newData);
    if (keys.length === 0 && !req.body.assignees && req.body.assigned_to === undefined && !req.body.related_items) {
      return res.json(old);
    }

    if (keys.length > 0) {
      keys.push('updated_at');
      newData.updated_at = new Date();
      const setClause = keys.map((k, i) => k + ' = $' + (i + 1)).join(', ');
      const values = [...Object.values(newData), taskId];
      await db.query(
        'UPDATE tasks SET ' + setClause + ' WHERE id = $' + values.length,
        values
      );
    }

    // Update assignees if provided
    if (req.body.assignees !== undefined || req.body.assigned_to !== undefined) {
      await db.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
      const allAssignees = [];
      if (req.body.assigned_to) allAssignees.push(Number(req.body.assigned_to));
      if (Array.isArray(req.body.assignees)) {
        for (const uid of req.body.assignees) {
          const numUid = typeof uid === 'object' ? (uid.user_id || uid.id) : Number(uid);
          if (!allAssignees.includes(numUid)) allAssignees.push(numUid);
        }
      }
      for (const uid of allAssignees) {
        await db.query(
          'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [taskId, uid]
        );
      }
      for (const uid of allAssignees) {
        if (uid !== req.user.id) {
          notify(uid, 'task_assigned', 'Task assigned to you', 'You were assigned: ' + (old.title || old.name), '/tasks');
        }
      }
    }

    // Update related items if provided
    if (req.body.related_items !== undefined) {
      await db.query(
        "DELETE FROM related_items WHERE source_type = 'task' AND source_id = $1", [taskId]);
      if (Array.isArray(req.body.related_items)) {
        for (const rel of req.body.related_items) {
          if (typeof rel === 'string') {
            await db.query(
              `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
               VALUES ('task', $1, $2, 0, $3) ON CONFLICT DO NOTHING`,
              [taskId, rel.toLowerCase(), req.user.id]
            ).catch(() => {});
          } else if (rel.target_type && rel.target_id) {
            await db.query(
              `INSERT INTO related_items (source_type, source_id, target_type, target_id, created_by)
               VALUES ('task', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [taskId, rel.target_type, rel.target_id, req.user.id]
            ).catch(() => {});
          }
        }
      }
    }

    // Fetch updated task
    const updated = await db.query(
      'SELECT ' + TASK_SELECT + ' FROM tasks t WHERE t.id = $1', [taskId]);
    const task = updated.rows[0];
    task.assignees = await getAssignees(taskId);
    task.related_items = await getRelatedItems('task', taskId);

    // Status change notification
    if (newData.status && newData.status !== old.status && old.created_by && old.created_by !== req.user.id) {
      notify(old.created_by, 'status_change', 'Task status updated', (task.title || task.name) + ' changed to ' + newData.status, '/tasks');
    }

    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/projects/:id/tasks/:taskId/status — quick status change ───

router.put('/:taskId/status', authenticate, validateProject, async (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  if (!TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be: ' + TASK_STATUSES.join(', ') });
  }
  try {
    const existing = await db.query('SELECT * FROM tasks WHERE id = $1 AND project_id = $2', [taskId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Task not found' });
    const old = existing.rows[0];

    const updates = { status, updated_at: new Date() };
    // Auto-set completed_date
    if (status === 'completed' && old.status !== 'completed') {
      updates.completed_date = new Date();
    }
    if (status !== 'completed' && old.status === 'completed') {
      updates.completed_date = null;
    }

    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => k + ' = $' + (i + 1)).join(', ');
    const values = [...Object.values(updates), taskId];
    await db.query('UPDATE tasks SET ' + setClause + ' WHERE id = $' + values.length, values);

    await logChange({
      tableName: 'tasks', recordId: taskId, operation: 'UPDATE',
      fieldChanged: 'status', oldValue: old.status, newValue: status, userId: req.user.id
    });
    await onStatusChange('task', taskId, status, req.projectId, req.user.id);

    const result = await db.query('SELECT ' + TASK_SELECT + ' FROM tasks t WHERE t.id = $1', [taskId]);
    const task = result.rows[0];
    task.assignees = await getAssignees(taskId);
    task.related_items = await getRelatedItems('task', taskId);

    if (old.created_by && old.created_by !== req.user.id) {
      notify(old.created_by, 'status_change', 'Task status updated',
        (task.title || task.name) + ' changed to ' + status, '/tasks');
    }

    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/projects/:id/tasks/:taskId ──────────────────────────────

router.delete('/:taskId', authenticate, validateProject, async (req, res) => {
  const { taskId } = req.params;
  try {
    const existing = await db.query('SELECT * FROM tasks WHERE id = $1 AND project_id = $2', [taskId, req.projectId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Task not found' });
    await logChange({ tableName: 'tasks', recordId: taskId, operation: 'DELETE', oldValue: JSON.stringify(existing.rows[0]), userId: req.user.id });
    // Clean up related_items
    await db.query("DELETE FROM related_items WHERE (source_type = 'task' AND source_id = $1) OR (target_type = 'task' AND target_id = $1)", [taskId]);
    await db.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    res.json({ message: 'Task deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/tasks/:taskId/assignees ─────────────────────

router.post('/:taskId/assignees', authenticate, validateProject, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    // Verify task belongs to project
    const check = await db.query('SELECT id, title, name FROM tasks WHERE id = $1 AND project_id = $2',
      [req.params.taskId, req.projectId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Task not found' });

    await db.query(
      'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.taskId, user_id]
    );
    if (Number(user_id) !== req.user.id) {
      const taskName = check.rows[0].title || check.rows[0].name || 'a task';
      notify(user_id, 'task_assigned', 'Task assigned to you', 'You were assigned: ' + taskName, '/tasks');
    }
    res.json(await getAssignees(req.params.taskId));
  } catch (err) {
    if (err.code === '23505') return res.json(await getAssignees(req.params.taskId));
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/projects/:id/tasks/:taskId/assignees/:userId ───────────

router.delete('/:taskId/assignees/:userId', authenticate, validateProject, async (req, res) => {
  try {
    await db.query('DELETE FROM task_assignees WHERE task_id = $1 AND user_id = $2',
      [req.params.taskId, req.params.userId]);
    res.json(await getAssignees(req.params.taskId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/projects/:id/tasks/:taskId/attachments ───────────────────

router.post('/:taskId/attachments', authenticate, validateProject, async (req, res) => {
  try {
    const { file_name, file_url, file_size } = req.body;
    if (!file_name || !file_url) return res.status(400).json({ error: 'file_name and file_url required' });
    // Verify task belongs to project
    const check = await db.query('SELECT id FROM tasks WHERE id = $1 AND project_id = $2',
      [req.params.taskId, req.projectId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Task not found' });

    const result = await db.query(
      `INSERT INTO task_attachments (task_id, file_name, file_url, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.taskId, file_name, file_url, file_size || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET subtasks ───────────────────────────────────────────────────────
// Serves both the project-scoped mount (/api/projects/:id/tasks/:taskId/subtasks)
// and the legacy mount (/api/tasks/:id/subtasks). When a project is in scope we
// keep the project filter; on the legacy mount we resolve subtasks by parent id.

router.get('/:taskId/subtasks', authenticate, async (req, res) => {
  try {
    const projectId = req.params.id || req.params.projectId;
    const result = projectId
      ? await db.query(
          'SELECT ' + TASK_SELECT + ' FROM tasks t WHERE t.parent_task_id = $1 AND t.project_id = $2 ORDER BY t.sort_order ASC, t.created_at ASC',
          [req.params.taskId, Number(projectId)]
        )
      : await db.query(
          'SELECT ' + TASK_SELECT + ' FROM tasks t WHERE t.parent_task_id = $1 ORDER BY t.sort_order ASC, t.created_at ASC',
          [req.params.taskId]
        );
    const enriched = await enrichTasks(result.rows);
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Meta ────────────────────────────────────────────────────────────────

router.get('/meta/options', authenticate, (req, res) => {
  res.json({ statuses: TASK_STATUSES, priorities: TASK_PRIORITIES });
});

module.exports = router;
