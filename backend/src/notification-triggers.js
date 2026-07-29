const db = require('./db');

// ── Trigger Configuration ─────────────────────────────────────────────
const notificationTriggers = {
  rfi: {
    status_open:           ['assignees', 'rfi_manager', 'distribution_list'],
    status_closed:         ['created_by', 'distribution_list'],
    due_date_approaching:  ['assignees', 'rfi_manager'],
  },
  submittal: {
    status_submitted:      ['submittal_manager', 'approvers'],
    status_approved:       ['submitted_by', 'distribution_list'],
    status_revise:         ['submitted_by'],
    due_date_approaching:  ['submittal_manager'],
  },
  inspection: {
    status_deficient:      ['inspector', 'project_manager'],
    status_closed:         ['created_by'],
  },
  change_order: {
    status_pending:        ['reviewer'],
    status_approved:       ['created_by', 'contract_company'],
    status_rejected:       ['created_by'],
  },
  permit: {
    expiration_30_days:    ['assigned_to', 'project_admin'],
    expiration_7_days:     ['assigned_to', 'project_admin'],
    status_approved:       ['assigned_to', 'created_by'],
  },
  task: {
    assigned:              ['assignees'],
    due_date_approaching:  ['assignees'],
    status_completed:      ['created_by'],
  }
};

// ── Message Templates ─────────────────────────────────────────────────
const messageTemplates = {
  rfi: {
    status_open:          (r) => ({ title: `RFI #${r.rfi_number} Opened`, message: `"${r.subject}" requires your response`, link: '#/rfis' }),
    status_closed:        (r) => ({ title: `RFI #${r.rfi_number} Closed`, message: `"${r.subject}" has been closed`, link: '#/rfis' }),
    due_date_approaching: (r) => ({ title: `RFI #${r.rfi_number} Due Soon`, message: `"${r.subject}" is due ${r.due_date}`, link: '#/rfis' }),
  },
  submittal: {
    status_submitted:      (r) => ({ title: `Submittal #${r.submittal_number} Submitted`, message: `"${r.title}" submitted for review`, link: '#/submittals' }),
    status_approved:       (r) => ({ title: `Submittal #${r.submittal_number} Approved`, message: `"${r.title}" has been approved`, link: '#/submittals' }),
    status_revise:         (r) => ({ title: `Submittal #${r.submittal_number} — Revise & Resubmit`, message: `"${r.title}" requires revisions`, link: '#/submittals' }),
    due_date_approaching:  (r) => ({ title: `Submittal #${r.submittal_number} Due Soon`, message: `"${r.title}" is due ${r.due_date}`, link: '#/submittals' }),
  },
  inspection: {
    status_deficient:      (r) => ({ title: `Inspection Deficient: ${r.title}`, message: `${r.deficiency_count || 0} deficiencies found`, link: '#/inspections' }),
    status_closed:         (r) => ({ title: `Inspection Closed: ${r.title}`, message: `Inspection has been closed`, link: '#/inspections' }),
  },
  change_order: {
    status_pending:        (r) => ({ title: `Change Order #${r.number || r.id} Pending Review`, message: `"${r.title}" awaits your review`, link: '#/cost-management' }),
    status_approved:       (r) => ({ title: `Change Order #${r.number || r.id} Approved`, message: `"${r.title}" has been approved`, link: '#/cost-management' }),
    status_rejected:       (r) => ({ title: `Change Order #${r.number || r.id} Rejected`, message: `"${r.title}" was rejected`, link: '#/cost-management' }),
  },
  permit: {
    expiration_30_days:    (r) => ({ title: `Permit Expiring: ${r.permit_number}`, message: `"${r.title}" expires in 30 days (${r.expiration_date})`, link: '#/permits' }),
    expiration_7_days:     (r) => ({ title: `Permit Expiring Soon: ${r.permit_number}`, message: `"${r.title}" expires in 7 days (${r.expiration_date})`, link: '#/permits' }),
    status_approved:       (r) => ({ title: `Permit Approved: ${r.permit_number}`, message: `"${r.title}" has been approved`, link: '#/permits' }),
  },
  task: {
    assigned:              (r) => ({ title: `Task Assigned: ${r.title || r.name}`, message: `You have been assigned a new task`, link: '#/schedule' }),
    due_date_approaching:  (r) => ({ title: `Task Due Soon: ${r.title || r.name}`, message: `Task is due ${r.end_date || r.due_date}`, link: '#/schedule' }),
    status_completed:      (r) => ({ title: `Task Completed: ${r.title || r.name}`, message: `Task has been marked complete`, link: '#/schedule' }),
  }
};

// ── Recipient Resolvers ───────────────────────────────────────────────
// Each resolver returns an array of user IDs
const recipientResolvers = {
  // -- RFI recipients --
  async rfi_assignees(entityId) {
    const { rows } = await db.query('SELECT user_id FROM rfi_assignees WHERE rfi_id = $1', [entityId]);
    return rows.map(r => r.user_id);
  },
  async rfi_rfi_manager(entityId) {
    const { rows } = await db.query('SELECT rfi_manager_id FROM rfis WHERE id = $1 AND rfi_manager_id IS NOT NULL', [entityId]);
    return rows.map(r => r.rfi_manager_id);
  },
  async rfi_distribution_list(entityId) {
    const { rows } = await db.query('SELECT user_id FROM rfi_distribution WHERE rfi_id = $1', [entityId]);
    return rows.map(r => r.user_id);
  },
  async rfi_created_by(entityId) {
    const { rows } = await db.query('SELECT created_by FROM rfis WHERE id = $1 AND created_by IS NOT NULL', [entityId]);
    return rows.map(r => r.created_by);
  },

  // -- Submittal recipients --
  async submittal_submittal_manager(entityId) {
    const { rows } = await db.query('SELECT submittal_manager_id FROM submittals WHERE id = $1 AND submittal_manager_id IS NOT NULL', [entityId]);
    return rows.map(r => r.submittal_manager_id);
  },
  async submittal_approvers(entityId) {
    const { rows } = await db.query('SELECT user_id FROM submittal_approvers WHERE submittal_id = $1', [entityId]);
    return rows.map(r => r.user_id);
  },
  async submittal_submitted_by(entityId) {
    const { rows } = await db.query('SELECT created_by FROM submittals WHERE id = $1 AND created_by IS NOT NULL', [entityId]);
    return rows.map(r => r.created_by);
  },
  async submittal_distribution_list(entityId) {
    // Submittals don't have a distribution table yet; fall back to approvers + manager
    return [];
  },

  // -- Inspection recipients --
  async inspection_inspector(entityId) {
    const { rows } = await db.query('SELECT inspector_id FROM inspections WHERE id = $1 AND inspector_id IS NOT NULL', [entityId]);
    return rows.map(r => r.inspector_id);
  },
  async inspection_project_manager(entityId) {
    const { rows } = await db.query(
      `SELECT p.created_by FROM inspections i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.created_by IS NOT NULL`, [entityId]);
    return rows.map(r => r.created_by);
  },
  async inspection_created_by(entityId) {
    const { rows } = await db.query('SELECT created_by FROM inspections WHERE id = $1 AND created_by IS NOT NULL', [entityId]);
    return rows.map(r => r.created_by);
  },

  // -- Change Order recipients --
  async change_order_reviewer(entityId) {
    const { rows } = await db.query('SELECT reviewer_id FROM change_orders WHERE id = $1 AND reviewer_id IS NOT NULL', [entityId]);
    return rows.map(r => r.reviewer_id);
  },
  async change_order_created_by(entityId) {
    const { rows } = await db.query('SELECT created_by FROM change_orders WHERE id = $1 AND created_by IS NOT NULL', [entityId]);
    return rows.map(r => r.created_by);
  },
  async change_order_contract_company(_entityId) {
    // Contract company notifications would go to the company contact; skip for now
    return [];
  },

  // -- Permit recipients --
  async permit_assigned_to(entityId) {
    const { rows } = await db.query('SELECT assigned_to_id FROM permits WHERE id = $1 AND assigned_to_id IS NOT NULL', [entityId]);
    return rows.map(r => r.assigned_to_id);
  },
  async permit_project_admin(entityId) {
    const { rows } = await db.query(
      `SELECT p.created_by FROM permits pm JOIN projects p ON p.id = pm.project_id WHERE pm.id = $1 AND p.created_by IS NOT NULL`, [entityId]);
    return rows.map(r => r.created_by);
  },
  async permit_created_by(entityId) {
    const { rows } = await db.query('SELECT created_by FROM permits WHERE id = $1 AND created_by IS NOT NULL', [entityId]);
    return rows.map(r => r.created_by);
  },

  // -- Task recipients --
  async task_assignees(entityId) {
    const { rows } = await db.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [entityId]);
    return rows.map(r => r.user_id);
  },
  async task_created_by(entityId) {
    const { rows } = await db.query('SELECT created_by FROM tasks WHERE id = $1 AND created_by IS NOT NULL', [entityId]);
    return rows.map(r => r.created_by);
  },
};

// ── Core: fire notification for a trigger ─────────────────────────────
async function fireNotification(entityType, triggerKey, entityId, projectId, excludeUserId) {
  try {
    const config = notificationTriggers[entityType];
    if (!config || !config[triggerKey]) return;

    const recipientRoles = config[triggerKey];
    const template = messageTemplates[entityType]?.[triggerKey];
    if (!template) return;

    // Fetch the entity record for template interpolation
    const tableMap = {
      rfi: 'rfis', submittal: 'submittals', inspection: 'inspections',
      change_order: 'change_orders', permit: 'permits', task: 'tasks'
    };
    const table = tableMap[entityType];
    if (!table) return;

    let record = {};
    try {
      const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [entityId]);
      record = rows[0] || {};
    } catch (e) { /* table might not exist yet */ }

    // Resolve all recipients
    const allUserIds = new Set();
    for (const role of recipientRoles) {
      const resolverKey = `${entityType}_${role}`;
      const resolver = recipientResolvers[resolverKey];
      if (resolver) {
        const ids = await resolver(entityId);
        ids.forEach(id => allUserIds.add(id));
      }
    }

    // Remove the user who triggered the action (don't notify yourself)
    if (excludeUserId) allUserIds.delete(excludeUserId);

    if (allUserIds.size === 0) return;

    // Generate the message from template
    const { title, message, link } = template(record);
    const notifType = entityType + '_' + triggerKey.replace('status_', '').replace('expiration_', 'expiring_');

    // Insert notifications for each recipient
    const userIds = [...allUserIds];
    for (const uid of userIds) {
      await db.query(
        `INSERT INTO notifications (user_id, project_id, type, entity_type, entity_id, title, message, link, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [uid, projectId || record.project_id || null, notifType, entityType, entityId, title, message, link || '']
      );
    }

    console.log(`[notify] ${entityType}/${triggerKey} → ${userIds.length} user(s)`);
  } catch (err) {
    console.error('[notify] error:', err.message);
  }
}

// ── Status change hook — call from route handlers ─────────────────────
async function onStatusChange(entityType, entityId, newStatus, projectId, userId) {
  const triggerKey = 'status_' + newStatus;
  await fireNotification(entityType, triggerKey, entityId, projectId, userId);
}

// ── Assignment hook ───────────────────────────────────────────────────
async function onAssignment(entityType, entityId, projectId, userId) {
  await fireNotification(entityType, 'assigned', entityId, projectId, userId);
}

// ── Due date approaching check (call from cron/scheduler) ─────────────
async function checkDueDateNotifications() {
  try {
    // RFIs due in 2 days
    const { rows: rfis } = await db.query(
      `SELECT id, project_id FROM rfis WHERE status NOT IN ('closed','void') AND due_date = CURRENT_DATE + interval '2 days'`
    );
    for (const r of rfis) {
      await fireNotification('rfi', 'due_date_approaching', r.id, r.project_id);
    }

    // Submittals due in 2 days
    const { rows: subs } = await db.query(
      `SELECT id, project_id FROM submittals WHERE status NOT IN ('closed','void','approved') AND due_date = CURRENT_DATE + interval '2 days'`
    );
    for (const s of subs) {
      await fireNotification('submittal', 'due_date_approaching', s.id, s.project_id);
    }

    // Tasks due in 2 days
    const { rows: tasks } = await db.query(
      `SELECT id, project_id FROM tasks WHERE status != 'complete' AND (end_date = CURRENT_DATE + interval '2 days' OR due_date = CURRENT_DATE + interval '2 days')`
    );
    for (const t of tasks) {
      await fireNotification('task', 'due_date_approaching', t.id, t.project_id);
    }

    // Permits expiring in 30 days
    const { rows: permits30 } = await db.query(
      `SELECT id, project_id FROM permits WHERE status NOT IN ('expired','closed') AND expiration_date = CURRENT_DATE + interval '30 days'`
    );
    for (const p of permits30) {
      await fireNotification('permit', 'expiration_30_days', p.id, p.project_id);
    }

    // Permits expiring in 7 days
    const { rows: permits7 } = await db.query(
      `SELECT id, project_id FROM permits WHERE status NOT IN ('expired','closed') AND expiration_date = CURRENT_DATE + interval '7 days'`
    );
    for (const p of permits7) {
      await fireNotification('permit', 'expiration_7_days', p.id, p.project_id);
    }

    console.log('[notify] due-date check complete');
  } catch (err) {
    console.error('[notify] due-date check error:', err.message);
  }
}

// ── Ball-in-Court Auto-Update ─────────────────────────────────────────
// Determines who "owns" the entity at each status and updates ball_in_court_id
const bicRules = {
  rfi: {
    draft:  'manager',      // rfi_manager_id
    open:   'assignees',    // first assignee (response_required)
    closed: null
  },
  submittal: {
    draft:                'manager',       // submittal_manager_id
    open:                 'manager',
    pending_submission:   'submitted_by',  // created_by (the submitter)
    submitted:            'manager',       // submittal_manager reviews
    under_review:         'approvers',     // first pending approver
    approved:             null,
    approved_as_noted:    null,
    revise_and_resubmit:  'submitted_by',  // back to submitter
    rejected:             null,
    closed:               null
  }
};

async function updateBallInCourt(entityType, entityId, newStatus) {
  try {
    const rules = bicRules[entityType];
    if (!rules) return null;

    const role = rules[newStatus];
    if (role === undefined) return null; // status not in rules

    let newBicId = null;

    if (role === null) {
      // No one owns it — clear ball_in_court
      newBicId = null;
    } else if (entityType === 'rfi') {
      if (role === 'manager') {
        const { rows } = await db.query('SELECT rfi_manager_id FROM rfis WHERE id = $1', [entityId]);
        newBicId = rows[0]?.rfi_manager_id || null;
      } else if (role === 'assignees') {
        // First assignee with response_required, or first assignee
        const { rows } = await db.query(
          'SELECT user_id FROM rfi_assignees WHERE rfi_id = $1 ORDER BY response_required DESC, id ASC LIMIT 1',
          [entityId]
        );
        newBicId = rows[0]?.user_id || null;
      }
    } else if (entityType === 'submittal') {
      if (role === 'manager') {
        const { rows } = await db.query('SELECT submittal_manager_id FROM submittals WHERE id = $1', [entityId]);
        newBicId = rows[0]?.submittal_manager_id || null;
      } else if (role === 'submitted_by') {
        const { rows } = await db.query('SELECT created_by FROM submittals WHERE id = $1', [entityId]);
        newBicId = rows[0]?.created_by || null;
      } else if (role === 'approvers') {
        // First approver who hasn't responded yet (response = 'pending'), ordered by approval order
        const { rows } = await db.query(
          `SELECT user_id FROM submittal_approvers WHERE submittal_id = $1 AND response = 'pending' ORDER BY "order" ASC, id ASC LIMIT 1`,
          [entityId]
        );
        newBicId = rows[0]?.user_id || null;
        // If all approvers responded, fall back to manager
        if (!newBicId) {
          const { rows: mgr } = await db.query('SELECT submittal_manager_id FROM submittals WHERE id = $1', [entityId]);
          newBicId = mgr[0]?.submittal_manager_id || null;
        }
      }
    }

    // Update the entity
    const table = entityType === 'rfi' ? 'rfis' : 'submittals';
    const oldRow = await db.query(`SELECT ball_in_court_id FROM ${table} WHERE id = $1`, [entityId]);
    const oldBic = oldRow.rows[0]?.ball_in_court_id || null;

    if (oldBic !== newBicId) {
      await db.query(`UPDATE ${table} SET ball_in_court_id = $1, updated_at = NOW() WHERE id = $2`, [newBicId, entityId]);
      console.log(`[bic] ${entityType} #${entityId}: ${oldBic} → ${newBicId} (status: ${newStatus})`);

      // Fire ball_in_court notification to the new owner
      if (newBicId) {
        const record = (await db.query(`SELECT * FROM ${table} WHERE id = $1`, [entityId])).rows[0];
        const projectId = record?.project_id;
        const label = entityType === 'rfi'
          ? `RFI #${record.rfi_number}: "${record.subject}"`
          : `Submittal #${record.submittal_number}: "${record.title}"`;

        await db.query(
          `INSERT INTO notifications (user_id, project_id, type, entity_type, entity_id, title, message, link, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [newBicId, projectId, 'ball_in_court', entityType, entityId,
           `Ball in Your Court`, `${label} — status: ${newStatus}`,
           entityType === 'rfi' ? '#/rfis' : '#/submittals']
        );
      }
    }

    return newBicId;
  } catch (err) {
    console.error('[bic] error:', err.message);
    return null;
  }
}

// ── Start daily cron (runs once per day at midnight) ──────────────────
let _cronStarted = false;
function startDueDateCron() {
  if (_cronStarted) return;
  _cronStarted = true;

  // Run once on startup (delayed 30s to let migrations finish)
  setTimeout(() => {
    checkDueDateNotifications().catch(() => {});
  }, 30000);

  // Then every 24 hours
  setInterval(() => {
    checkDueDateNotifications().catch(() => {});
  }, 24 * 60 * 60 * 1000);

  console.log('[notify] due-date cron started');
}

module.exports = {
  notificationTriggers,
  fireNotification,
  onStatusChange,
  onAssignment,
  updateBallInCourt,
  checkDueDateNotifications,
  startDueDateCron
};
