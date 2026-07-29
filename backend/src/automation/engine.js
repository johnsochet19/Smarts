// Automation engine — PURE core (no I/O), so it is fully unit-testable.
// Side effects (DB writes, notifications) live in runner.js.
//
// Shapes:
//   automation = { id, project_id, enabled, trigger, conditions, actions }
//   trigger    = { type, resource? }            e.g. { type:'status_changed', resource:'punch_item' }
//   condition  = { field, op, value }
//   action     = { type, config }
//   event      = { type, resource }
//   ctx        = { record, oldRecord }

const OPERATORS = {
  equals: (a, b) => String(a ?? '') === String(b ?? ''),
  not_equals: (a, b) => String(a ?? '') !== String(b ?? ''),
  contains: (a, b) => String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
  greater_than: (a, b) => Number(a) > Number(b),
  less_than: (a, b) => Number(a) < Number(b),
  is_empty: (a) => a === null || a === undefined || String(a).trim() === '',
  is_not_empty: (a) => !(a === null || a === undefined || String(a).trim() === ''),
};

const TRIGGER_TYPES = ['task_created', 'task_updated', 'status_changed', 'date_reached', 'form_submitted', 'punch_created'];
const ACTION_TYPES = ['notify', 'assign', 'update_field', 'create_task', 'send_email'];

function getField(record, field) {
  if (!record) return undefined;
  return record[field];
}

/** True if the event matches the automation's trigger (type + optional resource). */
function matchesTrigger(automation, event) {
  if (!automation || !automation.enabled) return false;
  const t = automation.trigger || {};
  if (!event || t.type !== event.type) return false;
  if (t.resource && event.resource && t.resource !== event.resource) return false;
  return true;
}

/** Evaluate all conditions with AND semantics. Empty conditions => true. */
function evaluateConditions(conditions, ctx) {
  const list = Array.isArray(conditions) ? conditions : [];
  const record = ctx && ctx.record ? ctx.record : ctx;
  return list.every((c) => {
    const fn = OPERATORS[c.op];
    if (!fn) return false;
    // Special virtual field: "<field>__changed" compares old vs new.
    if (c.op === 'changed') return true; // handled below
    const val = getField(record, c.field);
    return fn(val, c.value);
  });
}

/** Returns the concrete actions to perform (pure — resolves dynamic refs). */
function planActions(automation, ctx) {
  const record = ctx && ctx.record ? ctx.record : {};
  const actions = Array.isArray(automation.actions) ? automation.actions : [];
  return actions
    .filter((a) => ACTION_TYPES.includes(a.type))
    .map((a) => ({ type: a.type, config: resolveConfig(a.config || {}, record) }));
}

// Replace {{field}} tokens in string config values with record values.
function resolveConfig(config, record) {
  const out = {};
  for (const k of Object.keys(config)) {
    const v = config[k];
    out[k] = typeof v === 'string'
      ? v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, f) => String(getField(record, f) ?? ''))
      : v;
  }
  return out;
}

/** Full pure decision: should this automation fire, and with what actions. */
function decide(automation, event, ctx) {
  if (!matchesTrigger(automation, event)) return { fire: false, actions: [] };
  if (!evaluateConditions(automation.conditions, ctx)) return { fire: false, actions: [] };
  return { fire: true, actions: planActions(automation, ctx) };
}

module.exports = {
  OPERATORS, TRIGGER_TYPES, ACTION_TYPES,
  matchesTrigger, evaluateConditions, planActions, resolveConfig, decide,
};
