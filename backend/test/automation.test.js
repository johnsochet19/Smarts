const { test } = require('node:test');
const assert = require('node:assert');
const { matchesTrigger, evaluateConditions, planActions, resolveConfig, decide } = require('../src/automation/engine');

const base = {
  id: 1, project_id: 5, enabled: true,
  trigger: { type: 'status_changed', resource: 'punch_item' },
  conditions: [],
  actions: [],
};

test('matchesTrigger requires enabled + type + resource', () => {
  assert.equal(matchesTrigger(base, { type: 'status_changed', resource: 'punch_item' }), true);
  assert.equal(matchesTrigger(base, { type: 'task_created', resource: 'task' }), false);
  assert.equal(matchesTrigger({ ...base, enabled: false }, { type: 'status_changed', resource: 'punch_item' }), false);
  // resource on event but trigger has none => still matches
  assert.equal(matchesTrigger({ ...base, trigger: { type: 'status_changed' } }, { type: 'status_changed', resource: 'punch_item' }), true);
});

test('evaluateConditions AND semantics with operators', () => {
  const ctx = { record: { status: 'closed', priority: 'high', trade: '' } };
  assert.equal(evaluateConditions([{ field: 'status', op: 'equals', value: 'closed' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'status', op: 'equals', value: 'open' }], ctx), false);
  assert.equal(evaluateConditions([{ field: 'priority', op: 'not_equals', value: 'low' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'trade', op: 'is_empty', value: '' }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'priority', op: 'is_not_empty', value: '' }], ctx), true);
  // AND: both must pass
  assert.equal(evaluateConditions([
    { field: 'status', op: 'equals', value: 'closed' },
    { field: 'priority', op: 'equals', value: 'high' },
  ], ctx), true);
  assert.equal(evaluateConditions([
    { field: 'status', op: 'equals', value: 'closed' },
    { field: 'priority', op: 'equals', value: 'low' },
  ], ctx), false);
  // empty conditions => true
  assert.equal(evaluateConditions([], ctx), true);
});

test('numeric operators', () => {
  const ctx = { record: { percent_complete: 80 } };
  assert.equal(evaluateConditions([{ field: 'percent_complete', op: 'greater_than', value: 50 }], ctx), true);
  assert.equal(evaluateConditions([{ field: 'percent_complete', op: 'less_than', value: 50 }], ctx), false);
});

test('resolveConfig interpolates {{field}} tokens', () => {
  const out = resolveConfig({ title: 'Punch {{punch_number}} closed', to: 'assignee' }, { punch_number: 42 });
  assert.equal(out.title, 'Punch 42 closed');
  assert.equal(out.to, 'assignee');
});

test('planActions filters unknown action types and resolves config', () => {
  const automation = {
    ...base,
    actions: [
      { type: 'notify', config: { to: 'creator', title: '#{{punch_number}}' } },
      { type: 'bogus', config: {} },
    ],
  };
  const actions = planActions(automation, { record: { punch_number: 7 } });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'notify');
  assert.equal(actions[0].config.title, '#7');
});

test('decide combines trigger + conditions + plan', () => {
  const automation = {
    ...base,
    conditions: [{ field: 'status', op: 'equals', value: 'closed' }],
    actions: [{ type: 'notify', config: { to: 'creator', title: 'done' } }],
  };
  const fire = decide(automation, { type: 'status_changed', resource: 'punch_item' }, { record: { status: 'closed', created_by: 3 } });
  assert.equal(fire.fire, true);
  assert.equal(fire.actions.length, 1);

  const noFire = decide(automation, { type: 'status_changed', resource: 'punch_item' }, { record: { status: 'open' } });
  assert.equal(noFire.fire, false);
  assert.equal(noFire.actions.length, 0);
});
