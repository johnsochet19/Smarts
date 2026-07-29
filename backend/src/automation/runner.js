// Automation runner — executes planned actions with real side effects.
// Kept separate from engine.js (pure) so the decision logic stays testable.
const db = require('../db');
const { decide } = require('./engine');

// Map event resource -> table + assignee column, with a column whitelist so
// update_field can never inject arbitrary column names.
const RESOURCES = {
  punch_item: { table: 'punch_items', assignee: 'assignee_id', columns: ['status', 'priority', 'assignee_id', 'trade', 'location', 'due_date'] },
  task: { table: 'tasks', assignee: 'assigned_to', columns: ['status', 'priority', 'assigned_to', 'due_date', 'percent_complete'] },
};

async function notify(userId, type, title, message, link) {
  if (!userId) return;
  try {
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1,$2,$3,$4,$5)',
      [userId, type, title || '', message || '', link || '']
    );
  } catch (e) { /* notifications table optional; never break automations */ }
}

function resolveUser(target, record, automation) {
  if (target === 'assignee') return record.assignee_id ?? record.assigned_to ?? null;
  if (target === 'creator') return record.created_by ?? null;
  if (target === 'owner') return automation.created_by ?? null;
  const n = Number(target);
  return Number.isFinite(n) ? n : null;
}

async function runAction(action, resInfo, ctx, automation) {
  const record = ctx.record || {};
  const cfg = action.config || {};
  switch (action.type) {
    case 'notify':
      await notify(resolveUser(cfg.to ?? cfg.user_id, record, automation), 'automation',
        cfg.title || 'Automation', cfg.message || '', cfg.link || '');
      return 'notified';
    case 'assign': {
      if (!resInfo || !record.id) return 'skipped (no resource)';
      const uid = resolveUser(cfg.to ?? cfg.user_id, record, automation);
      if (!uid) return 'skipped (no user)';
      await db.query(`UPDATE ${resInfo.table} SET ${resInfo.assignee} = $1 WHERE id = $2`, [uid, record.id]);
      return 'assigned';
    }
    case 'update_field': {
      if (!resInfo || !record.id) return 'skipped (no resource)';
      if (!resInfo.columns.includes(cfg.field)) return 'skipped (field not allowed)';
      await db.query(`UPDATE ${resInfo.table} SET ${cfg.field} = $1 WHERE id = $2`, [cfg.value ?? null, record.id]);
      return 'updated ' + cfg.field;
    }
    case 'create_task': {
      const pid = ctx.projectId || record.project_id;
      if (!pid || !cfg.title) return 'skipped (no title/project)';
      await db.query(
        'INSERT INTO tasks (title, name, status, project_id, created_by, priority) VALUES ($1,$1,$2,$3,$4,$5)',
        [cfg.title, cfg.status || 'open', pid, automation.created_by || null, cfg.priority || 'normal']
      );
      return 'task created';
    }
    case 'send_email':
      // No SMTP configured in this environment — record intent as a notification
      // and log. Documented as a stub until an email provider is wired.
      console.log('[automation] send_email (stub):', cfg.to, cfg.subject);
      await notify(resolveUser(cfg.to, record, automation), 'email',
        cfg.subject || 'Email', cfg.message || '', cfg.link || '');
      return 'email queued (stub)';
    default:
      return 'unknown action';
  }
}

/**
 * Load enabled automations for a project, decide, and run matching ones.
 * Never throws to callers — automation failures must not break core flows.
 * @param {number} projectId
 * @param {{type:string, resource?:string}} event
 * @param {{record:object, oldRecord?:object}} ctx
 */
async function runAutomationsForEvent(projectId, event, ctx) {
  try {
    if (!projectId) return { ran: 0 };
    const res = await db.query(
      'SELECT * FROM automations WHERE project_id = $1 AND enabled = true',
      [projectId]
    );
    const resInfo = event.resource ? RESOURCES[event.resource] : null;
    let ran = 0;
    for (const automation of res.rows) {
      const parsed = {
        ...automation,
        trigger: safeJson(automation.trigger),
        conditions: safeJson(automation.conditions),
        actions: safeJson(automation.actions),
      };
      const fullCtx = { ...ctx, projectId };
      const decision = decide(parsed, event, fullCtx);
      if (!decision.fire) continue;
      const results = [];
      for (const action of decision.actions) {
        try { results.push(await runAction(action, resInfo, fullCtx, parsed)); }
        catch (e) { results.push('error: ' + e.message); }
      }
      ran++;
      await logRun(automation.id, event.type, 'success', results.join('; '));
      await db.query('UPDATE automations SET run_count = COALESCE(run_count,0) + 1, last_run = NOW() WHERE id = $1', [automation.id]).catch(() => {});
    }
    return { ran };
  } catch (e) {
    console.error('[automation] runForEvent error:', e.message);
    return { ran: 0, error: e.message };
  }
}

async function logRun(automationId, eventType, status, detail) {
  try {
    await db.query(
      'INSERT INTO automation_runs (automation_id, event_type, status, detail) VALUES ($1,$2,$3,$4)',
      [automationId, eventType, status, (detail || '').slice(0, 1000)]
    );
  } catch (e) { /* ignore log failures */ }
}

function safeJson(v) {
  if (v == null) return v;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return v; }
}

module.exports = { runAutomationsForEvent, runAction, RESOURCES };
