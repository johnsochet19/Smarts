#!/usr/bin/env node
// Live integration smoke: boots nothing itself — expects the API server running
// (default http://localhost:4000) against a migrated database, then exercises
// every major module end-to-end and exits non-zero on any failure.
//
// Usage:
//   DATABASE_URL=... node migrate.js
//   DATABASE_URL=... JWT_SECRET=... PORT=4000 node src/index.js &
//   DATABASE_URL=... API_BASE=http://localhost:4000/api node test/integration/smoke.js
const BASE = process.env.API_BASE || 'http://localhost:4000/api';

const bcrypt = require('bcrypt');
const db = require('../../src/db');

const results = [];
let TOKEN = '';

async function call(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!opts.noAuth) headers.Authorization = 'Bearer ' + TOKEN;
  let res, text;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    text = await res.text();
  } catch (e) {
    results.push({ method, path, status: 'ERR', note: e.message, expectFail: !!opts.expectFail });
    return null;
  }
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  results.push({ method, path, status: res.status, note: res.status < 400 ? '' : text.slice(0, 120), expectFail: !!opts.expectFail });
  return data;
}

async function main() {
  // Seed an admin directly (idempotent), then authenticate through the API.
  const email = 'smoke-admin@example.com';
  const hash = await bcrypt.hash('smoke-secret-1', 10);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Smoke Admin', $1, $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = true`,
    [email, hash]
  );
  const login = await call('POST', '/auth/login', { email, password: 'smoke-secret-1' }, { noAuth: true });
  if (!login || !login.token) { console.error('FATAL: login failed'); process.exit(1); }
  TOKEN = login.token;

  const proj = await call('POST', '/projects', { name: 'Smoke Tower ' + process.pid, status: 'active', start_date: '2026-07-01', end_date: '2026-12-15' });
  const pid = proj && proj.id;
  await call('GET', '/projects');
  await call('GET', `/projects/${pid}`);

  // Tasks + hierarchy
  const task = await call('POST', `/projects/${pid}/tasks`, { title: 'Frame level 2', status: 'in_progress', priority: 'high', start_date: '2026-07-20', finish_date: '2026-08-10', due_date: '2026-08-10' });
  await call('PUT', `/projects/${pid}/tasks/${task.id}`, { status: 'completed' });
  await call('POST', `/projects/${pid}/tasks`, { title: 'Install windows L2', parent_task_id: task.id, status: 'open' });
  await call('GET', `/projects/${pid}/tasks`);

  // Punch items: full status workflow
  const punch = await call('POST', `/projects/${pid}/punch-items`, { title: 'Touch up paint lobby', status: 'open', priority: 'high', location: 'Lobby', trade: 'Paint', due_date: '2026-08-05' });
  await call('PUT', `/punch-items/${punch.id}`, { status: 'in_progress' });
  await call('PUT', `/punch-items/${punch.id}`, { status: 'ready_for_review' });
  await call('PUT', `/punch-items/${punch.id}`, { status: 'closed' });
  await call('GET', `/projects/${pid}/punch-items`);

  // Sheets: create (returns {sheet, columns, rows}), custom columns, rows, hierarchy
  const created = await call('POST', `/projects/${pid}/sheets`, { name: 'Material tracker' });
  const sid = created && created.sheet && created.sheet.id;
  const c1 = await call('POST', `/sheets/${sid}/columns`, { name: 'Item', type: 'text' });
  const c2 = await call('POST', `/sheets/${sid}/columns`, { name: 'Qty', type: 'number' });
  const r1 = await call('POST', `/sheets/${sid}/rows`, { cells: { [c1.id]: 'Rebar', [c2.id]: 120 } });
  await call('POST', `/sheets/${sid}/rows`, { cells: { [c1.id]: '#5 bars' }, parent_id: r1.id });
  await call('PUT', `/sheets/${sid}/rows/${r1.id}`, { cells: { [c1.id]: 'Rebar', [c2.id]: 150 } });
  await call('GET', `/sheets/${sid}`);

  // Automations
  await call('POST', `/projects/${pid}/automations`, { name: 'Notify on punch close', enabled: true, trigger: { type: 'status_changed', resource: 'punch_item' }, conditions: [], actions: [{ type: 'send_notification', params: { message: 'Punch closed' } }] });
  const p2 = await call('POST', `/projects/${pid}/punch-items`, { title: 'Replace cracked tile', status: 'open', priority: 'normal' });
  await call('PUT', `/punch-items/${p2.id}`, { status: 'in_progress' });
  await call('GET', `/projects/${pid}/automations`);

  // Forms: create → public fetch → public submit (creates a punch item)
  const form = await call('POST', `/projects/${pid}/forms`, { name: 'Issue report', target_resource: 'punch_item', is_public: true, fields: [{ key: 'title', label: 'Issue', type: 'text', required: true }] });
  await call('GET', `/forms/public/${form.token}`, null, { noAuth: true });
  await call('POST', `/forms/public/${form.token}/submit`, { data: { title: 'Cracked tile in hallway' } }, { noAuth: true });

  // Modules that historically failed on fresh installs (deadlock/ordering bugs)
  await call('GET', '/notifications');
  await call('GET', '/notifications/unread-count');
  await call('GET', `/projects/${pid}/documents`);
  await call('GET', `/projects/${pid}/incidents`);
  await call('GET', `/projects/${pid}/observations`);
  await call('POST', `/projects/${pid}/observations`, { title: 'Loose handrail stair 3', type: 'safety', priority: 'high' });
  await call('GET', `/projects/${pid}/cost/contracts`);
  await call('GET', `/budget/${pid}`);

  // Breadth
  await call('GET', `/projects/${pid}/schedule`);
  await call('GET', '/equipment');
  await call('GET', `/projects/${pid}/rfis`);
  await call('GET', `/projects/${pid}/daily-logs`);
  await call('GET', `/projects/${pid}/timesheets`);
  await call('GET', '/users');
  await call('GET', '/audit-log');
  await call('GET', '/search?q=Smoke');

  // Security posture: unauthenticated and bad-credential calls must fail.
  await call('GET', '/projects', null, { noAuth: true, expectFail: true });
  await call('POST', '/auth/login', { email, password: 'wrong' }, { noAuth: true, expectFail: true });

  let failures = 0;
  for (const r of results) {
    const failed = r.status === 'ERR' || r.status >= 400;
    const bad = r.expectFail ? !failed : failed;
    if (bad) failures++;
    console.log((bad ? 'FAIL ' : 'ok   ') + String(r.status).padEnd(4), r.method.padEnd(5), r.path, r.note || '');
  }
  console.log(`\n${results.length} calls, ${failures} failures`);
  await db.pool.end().catch(() => {});
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
