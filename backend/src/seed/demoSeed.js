// Demo data seeder — populates ONE project ("BuildForge Demo") with realistic
// data across every module so every page in the new app has content.
// Idempotent: if the demo project already exists, it does nothing.
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');

// tiny 1x1 PNG (blue) as a data URL — stands in for uploaded photos/files
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function d(offsetDays) {
  const dt = new Date();
  dt.setHours(12, 0, 0, 0);
  dt.setDate(dt.getDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}
async function q(sql, params) { return db.query(sql, params); }
async function one(sql, params) { const r = await db.query(sql, params); return r.rows[0]; }

async function ensureUser(name, email, role) {
  const hash = await bcrypt.hash(email === 'demo@buildforge.com' ? 'demo1234' : 'password123', 10);
  const r = await one(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, email, hash, role]
  );
  return r.id;
}

async function seedDemo() {
  const created = { users: 0, tasks: 0, dependencies: 0, punch_items: 0, photos: 0, sheets: 0, automations: 0, forms: 0, submissions: 0, documents: 0, notifications: 0 };
  let formToken = null;

  // ── Team (idempotent upsert) ──
  const demo = await ensureUser('Demo Admin', 'demo@buildforge.com', 'admin');
  const maria = await ensureUser('Maria Alvarez', 'maria@buildforge.com', 'member');
  const derek = await ensureUser('Derek Chen', 'derek@buildforge.com', 'member');
  const priya = await ensureUser('Priya Nair', 'priya@buildforge.com', 'member');
  const tom = await ensureUser('Tom Boyd', 'tom@buildforge.com', 'member');
  const team = [maria, derek, priya, tom];
  const teamNames = { [maria]: 'Maria Alvarez', [derek]: 'Derek Chen', [priya]: 'Priya Nair', [tom]: 'Tom Boyd' };
  created.users = 5;

  // ── Project (idempotent) ──
  const existing = await one(`SELECT id FROM projects WHERE name = $1 LIMIT 1`, ['BuildForge Demo']);
  const freshProject = !existing;
  let pid;
  if (existing) {
    pid = existing.id;
  } else {
    const project = await one(
      `INSERT INTO projects (name, description, status, start_date, end_date, created_by)
       VALUES ($1,$2,'active',$3,$4,$5) RETURNING id`,
      ['BuildForge Demo', 'A sample commercial fit-out used to showcase every BuildForge feature.', d(-30), d(60), demo]
    );
    pid = project.id;
    await q(`UPDATE projects SET address = $1 WHERE id = $2`, ['500 Market St, Suite 1200', pid]).catch(() => {});
  }

  if (freshProject) {

  // ── Tasks (with hierarchy + dependencies) ──
  const T = [
    { title: 'Mobilization & site setup', s: -28, f: -22, st: 'completed', pr: 'normal', a: maria },
    { title: 'Demolition', s: -21, f: -12, st: 'completed', pr: 'high', a: derek },
    { title: 'Framing', s: -11, f: 2, st: 'in_progress', pr: 'high', a: derek },
    { title: 'MEP rough-in', s: 3, f: 16, st: 'open', pr: 'high', a: priya },
    { title: '  Electrical rough-in', s: 3, f: 10, st: 'open', pr: 'normal', a: priya, child: 'MEP rough-in' },
    { title: '  Plumbing rough-in', s: 6, f: 16, st: 'open', pr: 'normal', a: tom, child: 'MEP rough-in' },
    { title: 'Drywall & finishes', s: 17, f: 34, st: 'open', pr: 'normal', a: maria },
    { title: 'Final inspection & punch', s: 35, f: 42, st: 'open', pr: 'high', a: derek },
  ];
  const taskIds = {};
  let sort = 0;
  for (const t of T) {
    const name = t.title.trim();
    const parentId = t.child ? taskIds[t.child] : null;
    const row = await one(
      `INSERT INTO tasks (title, name, status, priority, start_date, finish_date, due_date, project_id, created_by, assigned_to, parent_task_id, sort_order, color)
       VALUES ($1,$1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [name, t.st, t.pr, d(t.s), d(t.f), pid, demo, t.a, parentId, sort++, '#3b82f6']
    );
    taskIds[name] = row.id;
    await q(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [row.id, t.a]).catch(() => {});
    created.tasks++;
  }
  // Finish-to-start dependencies along the critical chain.
  const chain = ['Mobilization & site setup', 'Demolition', 'Framing', 'MEP rough-in', 'Drywall & finishes', 'Final inspection & punch'];
  for (let i = 1; i < chain.length; i++) {
    await q(`INSERT INTO dependencies (task_id, depends_on_id) VALUES ($1,$2)`, [taskIds[chain[i]], taskIds[chain[i - 1]]]).catch(() => {});
    created.dependencies++;
  }

  // ── Punch items ──
  const P = [
    { t: 'Touch-up paint in stairwell B', st: 'open', pr: 'normal', tr: 'Painting', loc: 'Stair B / L3', due: 3, a: maria, type: 'quality' },
    { t: 'Missing outlet cover — Room 304', st: 'open', pr: 'low', tr: 'Electrical', loc: 'Room 304', due: 5, a: priya, type: 'quality' },
    { t: 'Fire extinguisher not mounted', st: 'in_progress', pr: 'high', tr: 'Safety', loc: 'Corridor 2', due: -1, a: derek, type: 'safety' },
    { t: 'Ceiling tile cracked', st: 'open', pr: 'normal', tr: 'Drywall', loc: 'Lobby', due: 7, a: maria, type: 'quality' },
    { t: 'Door 210 not closing flush', st: 'ready_for_review', pr: 'normal', tr: 'Carpentry', loc: 'Room 210', due: 2, a: tom, type: 'quality' },
    { t: 'Leaking valve under sink', st: 'in_progress', pr: 'high', tr: 'Plumbing', loc: 'Kitchenette', due: 0, a: tom, type: 'commissioning' },
    { t: 'Exit sign not illuminated', st: 'open', pr: 'high', tr: 'Electrical', loc: 'Exit East', due: -3, a: priya, type: 'safety' },
    { t: 'Grout haze on tile', st: 'closed', pr: 'low', tr: 'Flooring', loc: 'Restroom 1', due: -6, a: maria, type: 'quality' },
    { t: 'HVAC diffuser rattling', st: 'open', pr: 'normal', tr: 'HVAC', loc: 'Open Office', due: 9, a: derek, type: 'commissioning' },
    { t: 'Scuffed baseboard', st: 'closed', pr: 'low', tr: 'Painting', loc: 'Room 118', due: -8, a: maria, type: 'quality' },
  ];
  let pn = 1;
  for (const p of P) {
    const gps = { lat: 37.7897 + (Math.random() - 0.5) * 0.004, lng: -122.3997 + (Math.random() - 0.5) * 0.004 };
    const row = await one(
      `INSERT INTO punch_items (project_id, punch_number, title, description, type, status, priority, assignee_id, trade, location, due_date, gps_lat, gps_lng, created_by, closed_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [pid, pn++, p.t, 'Reported during walkthrough. ' + p.t + '.', p.type, p.st, p.pr, p.a, p.tr, p.loc, d(p.due),
       gps.lat.toFixed(6), gps.lng.toFixed(6), demo, p.st === 'closed' ? d(p.due) : null]
    );
    created.punch_items++;
    // add a photo to the first few, a voice note to one
    if (created.punch_items <= 4) {
      await q(`INSERT INTO punch_item_photos (punch_item_id, photo_url, caption, media_type, uploaded_by) VALUES ($1,$2,$3,'photo',$4)`,
        [row.id, TINY_PNG, 'Site photo', demo]).catch(() => {});
      created.photos++;
    }
  }

  // ── Sheet (grid) ──
  const sheet = await one(`INSERT INTO sheets (project_id, name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [pid, 'Trade Coordination', 'Sample sheet — custom columns, statuses, dates.', demo]);
  const sheetId = sheet.id;
  created.sheets = 1;
  const cols = [
    { name: 'Task Name', type: 'text', primary: true, w: 260, opts: {} },
    { name: 'Status', type: 'status', w: 150, opts: { choices: [{ value: 'open', label: 'Open', color: '#3b82f6' }, { value: 'in_progress', label: 'In Progress', color: '#f59e0b' }, { value: 'done', label: 'Done', color: '#22c55e' }] } },
    { name: 'Priority', type: 'priority', w: 130, opts: { choices: [{ value: 'low', label: 'Low', color: '#64748b' }, { value: 'normal', label: 'Normal', color: '#3b82f6' }, { value: 'high', label: 'High', color: '#ef4444' }] } },
    { name: 'Owner', type: 'contact', w: 170, opts: {} },
    { name: 'Due', type: 'date', w: 130, opts: {} },
    { name: '% Done', type: 'percent', w: 110, opts: {} },
  ];
  const colIds = {};
  let cpos = 0;
  for (const c of cols) {
    const cr = await one(`INSERT INTO sheet_columns (sheet_id, name, type, position, width, options, is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [sheetId, c.name, c.type, cpos++, c.w, JSON.stringify(c.opts), !!c.primary]);
    colIds[c.name] = cr.id;
  }
  const sheetRows = [
    { 'Task Name': 'Order light fixtures', Status: 'done', Priority: 'normal', Owner: 'Priya Nair', Due: d(-4), '% Done': 100 },
    { 'Task Name': 'Coordinate crane lift', Status: 'in_progress', Priority: 'high', Owner: 'Derek Chen', Due: d(2), '% Done': 40 },
    { 'Task Name': 'Submit paint samples', Status: 'open', Priority: 'normal', Owner: 'Maria Alvarez', Due: d(6), '% Done': 0 },
    { 'Task Name': 'Schedule fire marshal', Status: 'open', Priority: 'high', Owner: 'Tom Boyd', Due: d(12), '% Done': 0 },
  ];
  let rpos = 0;
  for (const r of sheetRows) {
    const cells = {};
    for (const [k, v] of Object.entries(r)) cells[colIds[k]] = v;
    await q(`INSERT INTO sheet_rows (sheet_id, position, cells) VALUES ($1,$2,$3)`, [sheetId, rpos++, JSON.stringify(cells)]);
  }

  // ── Automations ──
  await q(`INSERT INTO automations (project_id, name, enabled, trigger, conditions, actions, created_by, run_count) VALUES ($1,$2,true,$3,$4,$5,$6,$7)`,
    [pid, 'Notify reporter when a punch item closes',
     JSON.stringify({ type: 'status_changed', resource: 'punch_item' }),
     JSON.stringify([{ field: 'status', op: 'equals', value: 'closed' }]),
     JSON.stringify([{ type: 'notify', config: { to: 'creator', title: 'Punch #{{punch_number}} closed', message: 'Great work — the item was closed.' } }]),
     demo, 4]);
  await q(`INSERT INTO automations (project_id, name, enabled, trigger, conditions, actions, created_by, run_count) VALUES ($1,$2,false,$3,$4,$5,$6,$7)`,
    [pid, 'Alert on high-priority new tasks',
     JSON.stringify({ type: 'task_created', resource: 'task' }),
     JSON.stringify([{ field: 'priority', op: 'equals', value: 'high' }]),
     JSON.stringify([{ type: 'notify', config: { to: 'owner', title: 'High-priority task created' } }]),
     demo, 0]);
  created.automations = 2;

  // ── Form + submissions ──
  const form = await one(
    `INSERT INTO forms (project_id, name, description, token, enabled, is_public, target_resource, fields, created_by, submission_count)
     VALUES ($1,$2,$3,$4,true,true,'punch_item',$5,$6,2) RETURNING id, token`,
    [pid, 'Field Issue Report', 'Report a site issue — creates a punch item automatically.', crypto.randomBytes(12).toString('hex'),
     JSON.stringify([
       { key: 'title', label: 'Issue title', type: 'text', required: true },
       { key: 'description', label: 'Description', type: 'textarea' },
       { key: 'priority', label: 'Priority', type: 'select', options: [{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }] },
       { key: 'location', label: 'Location', type: 'text' },
       { key: 'trade', label: 'Trade', type: 'text' },
     ]), demo]);
  formToken = form.token;
  created.forms = 1;
  for (const s of [
    { title: 'Cracked window pane', priority: 'normal', location: 'Room 402', trade: 'Glazing' },
    { title: 'Loose handrail', priority: 'high', location: 'Stair A', trade: 'Metals' },
  ]) {
    await q(`INSERT INTO form_submissions (form_id, project_id, data) VALUES ($1,$2,$3)`, [form.id, pid, JSON.stringify(s)]);
    created.submissions++;
  }

  // ── Documents (with a version) ──
  const docs = [
    { name: 'Floor Plan — Level 3.png', size: 84213 },
    { name: 'Finish Schedule.png', size: 45120 },
    { name: 'Site Safety Plan.png', size: 61233 },
  ];
  for (const doc of docs) {
    await q(`INSERT INTO documents (project_id, name, file_url, file_size, file_type, version_number, uploaded_by, description) VALUES ($1,$2,$3,$4,'image/png',1,$5,$6)`,
      [pid, doc.name, TINY_PNG, doc.size, demo, 'Sample document']);
    created.documents++;
  }
  // a second version of the first doc
  await q(`INSERT INTO documents (project_id, name, file_url, file_size, file_type, version_number, uploaded_by, description) VALUES ($1,$2,$3,$4,'image/png',2,$5,$6)`,
    [pid, 'Floor Plan — Level 3.png', TINY_PNG, 84990, demo, 'Revised dimensions']);
  created.documents++;

  // ── Notifications for the demo user ──
  const notifs = [
    { type: 'task_assigned', title: 'New task assigned', message: 'You were assigned: Final inspection & punch', link: '/schedule', ago: 0 },
    { type: 'overdue', title: 'Punch item overdue', message: '#7 Exit sign not illuminated is overdue', link: '/punchlist', ago: 1 },
    { type: 'automation', title: 'Automation ran', message: 'Notify reporter when a punch item closes', link: '/automations', ago: 1 },
    { type: 'status_change', title: 'Item ready for review', message: '#5 Door 210 not closing flush is ready for review', link: '/punchlist', ago: 2 },
    { type: 'comment', title: 'New comment', message: 'Maria commented on Framing', link: '/schedule', ago: 3 },
    { type: 'due_soon', title: 'Due soon', message: 'MEP rough-in starts in 3 days', link: '/calendar', ago: 4 },
  ];
  for (const n of notifs) {
    await q(`INSERT INTO notifications (user_id, project_id, type, title, message, link, read, sent_at) VALUES ($1,$2,$3,$4,$5,$6,false, NOW() - ($7 || ' hours')::interval)`,
      [demo, pid, n.type, n.title, n.message, n.link, String(n.ago * 6)]).catch(() => {});
    created.notifications++;
  }
  } // end freshProject-only sections

  // ── Top-up modules (idempotent): runs on fresh seed AND on re-seed of an
  //    existing demo project that predates these modules. ──
  const hasInspections = (await one(`SELECT COUNT(*)::int AS c FROM inspections WHERE project_id = $1`, [pid])).c;
  if (!hasInspections) {
  // ── Inspections (with checklist items) ──
  try {
    const insp = await one(
      `INSERT INTO inspections (project_id, title, description, type, inspector_id, trade, location, scheduled_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [pid, 'Level 3 pre-drywall inspection', 'Framing + MEP rough-in check before drywall.', 'quality', derek, 'Framing', 'Level 3', d(1), 'deficient', demo]
    );
    const checklist = [
      { s: 'Framing', t: 'Studs plumb and spaced per plan', r: 'pass', def: false },
      { s: 'Framing', t: 'Fire blocking installed', r: 'pass', def: false },
      { s: 'Electrical', t: 'Boxes secured and grounded', r: 'fail', def: true },
      { s: 'Plumbing', t: 'Rough-in pressure tested', r: null, def: false },
      { s: 'HVAC', t: 'Duct supports adequate', r: null, def: false },
    ];
    let ord = 1;
    for (const c of checklist) {
      await q(`INSERT INTO inspection_items (inspection_id, description, item_type, "order", section, response, deficient, requires_correction, deficiency_notes)
               VALUES ($1,$2,'yes_no',$3,$4,$5,$6,$6,$7)`,
        [insp.id, c.t, ord++, c.s, c.r, c.def, c.def ? 'Ground wire not landed at box 3' : null]).catch(() => {});
    }
    await q(`INSERT INTO inspections (project_id, title, type, inspector_id, trade, location, scheduled_date, status, created_by)
             VALUES ($1,$2,'safety',$3,'Safety','Site',$4,'passed',$5)`,
      [pid, 'Weekly site safety walk', priya, d(-3), demo]).catch(() => {});
    created.inspections = 2;
  } catch (e) { console.error('[seed] inspections:', e.message); }

  // ── Budget line items ──
  try {
    const budget = [
      ['General Conditions', 'Site management', '', 120000, 110000, 'paid'],
      ['Concrete', 'Slab on grade', 'ABC Concrete', 85000, 90000, 'over_budget'],
      ['Concrete', 'Foundations', 'ABC Concrete', 60000, 58000, 'invoiced'],
      ['Electrical', 'Rough-in', 'Bright Electric', 140000, 45000, 'approved'],
      ['Plumbing', 'Rough-in', 'FlowPro', 95000, 20000, 'approved'],
      ['Finishes', 'Drywall & paint', 'FinishCo', 110000, 0, 'pending'],
    ];
    let so = 0;
    for (const b of budget) {
      await q(`INSERT INTO budget_items (project_id, category, description, vendor, estimated, actual, status, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pid, b[0], b[1], b[2], b[3], b[4], b[5], so++]).catch(() => {});
    }
    created.budget = budget.length;
  } catch (e) { console.error('[seed] budget:', e.message); }

  // ── Timesheets ──
  try {
    const ts = [
      [maria, d(-1), 8, 'labor', 'Framing L3'], [derek, d(-1), 8, 'labor', 'Framing L3'],
      [priya, d(-2), 6.5, 'labor', 'Electrical rough-in'], [tom, d(-2), 7, 'labor', 'Plumbing rough-in'],
      [maria, d(0), 4, 'labor', 'Punch walk'],
    ];
    for (const t of ts) {
      await q(`INSERT INTO timesheets (project_id, employee_id, date, hours, cost_type, description, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pid, t[0], t[1], t[2], t[3], t[4], 'submitted', demo]).catch(() => {});
    }
    created.timesheets = ts.length;
  } catch (e) { console.error('[seed] timesheets:', e.message); }

  // ── Meetings / Incidents / Permits ──
  try {
    let mn = 1;
    for (const m of [['Weekly OAC meeting', 'oac', 'completed', d(-7)], ['Weekly OAC meeting', 'oac', 'scheduled', d(0)], ['Pre-drywall coordination', 'subcontractor', 'scheduled', d(2)]]) {
      await q(`INSERT INTO meetings (project_id, title, type, status, meeting_number, meeting_date, location, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [pid, m[0], m[1], m[2], mn++, m[3], 'Site trailer', demo]).catch(() => {});
    }
    created.meetings = 3;
  } catch (e) { console.error('[seed] meetings:', e.message); }
  try {
    let inn = 1;
    for (const i of [['near_miss', 'under_investigation', 'Dropped tool from L2, no injury', 'Level 2'], ['first_aid', 'closed', 'Minor cut, treated on site', 'Kitchenette']]) {
      await q(`INSERT INTO incidents (project_id, incident_number, incident_date, location, type, description, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [pid, 'INC-' + (inn++), d(-6), i[3], i[0], i[2], i[1], demo]).catch(() => {});
    }
    created.incidents = 2;
  } catch (e) { console.error('[seed] incidents:', e.message); }
  try {
    let pnp = 1;
    for (const p of [['Building permit', 'building', 'approved', 'Dept of Buildings', d(-40), d(320)], ['Electrical permit', 'electrical', 'under_review', 'DOB', d(-10), d(350)], ['Plumbing permit', 'plumbing', 'submitted', 'DOB', d(-5), null]]) {
      await q(`INSERT INTO permits (project_id, permit_number, type, title, status, issuing_authority, applied_date, expiration_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [pid, 'P-' + (pnp++), p[1], p[0], p[2], p[3], p[4], p[5], demo]).catch(() => {});
    }
    created.permits = 3;
  } catch (e) { console.error('[seed] permits:', e.message); }

  // ── Companies + Equipment ──
  try {
    for (const c of [['ABC Concrete', 'subcontractor', '415-555-0101', 'ops@abcconcrete.com', 'San Francisco', 'CA'], ['Bright Electric', 'subcontractor', '415-555-0144', 'hi@brightelectric.com', 'Oakland', 'CA'], ['FlowPro Plumbing', 'subcontractor', '415-555-0177', 'team@flowpro.com', 'San Jose', 'CA'], ['FinishCo', 'subcontractor', '415-555-0199', 'info@finishco.com', 'San Francisco', 'CA']]) {
      await q(`INSERT INTO companies (name, type, phone, email, city, state) VALUES ($1,$2,$3,$4,$5,$6)`, c).catch(() => {});
    }
    created.companies = 4;
  } catch (e) { console.error('[seed] companies:', e.message); }
  try {
    for (const eq of [['Scissor lift #1', 'Lift', 'Genie', 'GS-1930', 'available'], ['Tower crane', 'Crane', 'Liebherr', '120 HC', 'in_use'], ['Generator 50kW', 'Generator', 'CAT', 'XQ50', 'in_use']]) {
      await q(`INSERT INTO equipment (project_id, name, equipment_type, make, model, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, eq[0], eq[1], eq[2], eq[3], eq[4], demo]).catch(() => {});
    }
    created.equipment = 3;
  } catch (e) { console.error('[seed] equipment:', e.message); }

  // ── Observations / Drawings / Specifications ──
  try {
    for (const o of [['Housekeeping — debris in stairwell', 'safety', 'high', 'open', 'Stair B'], ['Proper PPE used by crew', 'positive', 'normal', 'closed', 'L3'], ['Water pooling near entrance', 'environmental', 'normal', 'open', 'Entrance']]) {
      await q(`INSERT INTO observations (project_id, title, type, priority, status, location, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, o[0], o[1], o[2], o[3], o[4], demo]).catch(() => {});
    }
    created.observations = 3;
  } catch (e) { console.error('[seed] observations:', e.message); }
  try {
    for (const w of [['A-101', 'Level 1 Floor Plan', 'architectural', '2', 'published'], ['A-301', 'Level 3 RCP', 'architectural', '1', 'published'], ['E-201', 'Power Plan L2', 'electrical', '1', 'published']]) {
      await q(`INSERT INTO drawings (project_id, number, title, discipline, revision, status, publish_date, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [pid, w[0], w[1], w[2], w[3], w[4], d(-15), demo]).catch(() => {});
    }
    created.drawings = 3;
  } catch (e) { console.error('[seed] drawings:', e.message); }
  try {
    for (const s of [['03', 'Concrete', '03 30 00', 'Cast-in-Place Concrete'], ['09', 'Finishes', '09 91 00', 'Painting'], ['26', 'Electrical', '26 05 00', 'Common Work Results for Electrical']]) {
      await q(`INSERT INTO specifications (project_id, division_number, division_name, section_number, section_title, revision_date, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, s[0], s[1], s[2], s[3], d(-20), demo]).catch(() => {});
    }
    created.specifications = 3;
  } catch (e) { console.error('[seed] specifications:', e.message); }
  } // end top-up guard

  // ── Cost management (own guard so existing demo projects top-up too) ──
  const hasCost = (await one(`SELECT COUNT(*)::int AS c FROM budget_line_items WHERE project_id = $1`, [pid])).c;
  if (!hasCost) {
    try {
      const lines = [
        ['labor', 'General conditions', 120000, 120000, 110000, 92],
        ['subcontractor', 'Concrete package', 145000, 145000, 148000, 100],
        ['subcontractor', 'Electrical rough-in', 140000, 90000, 45000, 32],
        ['subcontractor', 'Plumbing rough-in', 95000, 60000, 20000, 22],
        ['material', 'Structural steel', 210000, 210000, 205000, 98],
        ['subcontractor', 'Drywall & finishes', 110000, 0, 0, 0],
      ];
      for (const l of lines) {
        await q(`INSERT INTO budget_line_items (project_id, cost_type, description, budgeted_amount, committed_amount, actual_cost, projected_cost, percent_complete)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [pid, l[0], l[1], l[2], l[4], l[3], l[2], l[5]]).catch(() => {});
      }
      created.cost_budget = lines.length;

      let cen = 1;
      const events = [
        ['Unforeseen rock excavation', 'approved', 18500, 3, d(-30)],
        ['Owner-requested lobby upgrade', 'open', 42000, 5, d(-12)],
        ['Revised electrical scope', 'draft', 9500, 0, d(-4)],
      ];
      for (const ev of events) {
        await q(`INSERT INTO change_events (project_id, number, title, status, cost_impact_amount, schedule_impact_days, event_date, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [pid, cen++, ev[0], ev[1], ev[2], ev[3], ev[4], demo]).catch(() => {});
      }
      created.cost_events = events.length;

      let con = 1;
      const orders = [
        ['CO-001 Rock excavation', 'owner_change', 'approved', 3],
        ['CO-002 Lobby finishes upgrade', 'owner_change', 'submitted', 5],
      ];
      for (const co of orders) {
        await q(`INSERT INTO change_orders (project_id, number, title, type, status, schedule_impact_days, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, con++, co[0], co[1], co[2], co[3], demo]).catch(() => {});
      }
      created.cost_orders = orders.length;
    } catch (e) { console.error('[seed] cost:', e.message); }
  }

  // ── Audit log (own guard so existing demo projects top-up too) ──
  const hasAudit = (await one(`SELECT COUNT(*)::int AS c FROM audit_log WHERE project_id = $1`, [pid])).c;
  if (!hasAudit) {
    try {
      const entries = [
        ['rfi', 'created', 'RFI-001 opened'], ['submittal', 'submitted', 'Curtain wall shop drawings'],
        ['inspection', 'status_changed', 'Framing inspection passed'], ['permit', 'approved', 'Building permit approved'],
        ['change_order', 'created', 'CO-001 created'], ['punch_item', 'created', 'Touch-up paint L3'],
        ['daily_log', 'created', 'Daily log filed'], ['meeting', 'created', 'Weekly OAC scheduled'],
        ['incident', 'status_changed', 'Near-miss under investigation'], ['drawing', 'uploaded', 'A-301 Rev 1 published'],
      ];
      let ai = 0;
      for (const ev of entries) {
        await q(`INSERT INTO audit_log (project_id, entity_type, entity_id, action, new_value, changed_by, changed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, ev[0], (ai + 1), ev[1], ev[2], demo, d(-(ai % 10))]).catch(() => {});
        ai++;
      }
      created.audit_log = entries.length;
    } catch (e) { console.error('[seed] audit_log:', e.message); }
  }

  // ── RFIs (own guard so existing demo projects top-up too) ──
  const hasRfis = (await one(`SELECT COUNT(*)::int AS c FROM rfis WHERE project_id = $1`, [pid])).c;
  if (!hasRfis) {
    try {
      let rn = 1;
      const rfis = [
        ['Slab edge detail at grid C-4', 'Confirm rebar spacing at the slab edge — drawing conflicts with spec.', 'open', 'Level 1', 'S-201', '03 30 00', d(4)],
        ['Door hardware set for stair B', 'Which hardware set applies to the stairwell doors?', 'open', 'Stair B', 'A-601', '08 71 00', d(6)],
        ['Ceiling height in lobby', 'Finished ceiling height appears to conflict with mechanical routing.', 'in_review', 'Lobby', 'A-301', '09 51 00', d(-1)],
        ['Electrical panel location', 'Panel LP-2 location clashes with plumbing riser.', 'closed', 'Level 2 Electrical', 'E-201', '26 24 16', d(-8)],
      ];
      for (const r of rfis) {
        await q(`INSERT INTO rfis (project_id, rfi_number, subject, question, status, location, drawing_number, spec_section, due_date, received_from_id, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [pid, 'RFI-' + String(rn++).padStart(3, '0'), r[0], r[1], r[2], r[3], r[4], r[5], r[6], demo, demo]).catch(() => {});
      }
      created.rfis = rfis.length;
    } catch (e) { console.error('[seed] rfis:', e.message); }
  }

  // ── Submittals (own guard) ──
  const hasSubmittals = (await one(`SELECT COUNT(*)::int AS c FROM submittals WHERE project_id = $1`, [pid])).c;
  if (!hasSubmittals) {
    try {
      let sn = 1;
      const subs = [
        ['Structural steel shop drawings', 'Fabricator shop drawings for primary steel.', 'shop_drawing', '05', '05 12 00', 'in_review', d(5)],
        ['Curtain wall product data', 'Glazing system product data and thermal performance.', 'product_data', '08', '08 44 00', 'submitted', d(9)],
        ['Concrete mix design', 'Mix design for 5000 psi structural concrete.', 'other', '03', '03 30 00', 'approved', d(-3)],
        ['Paint color samples', 'Interior finish paint samples for approval.', 'sample', '09', '09 91 00', 'revise', d(2)],
      ];
      for (const s of subs) {
        await q(`INSERT INTO submittals (project_id, submittal_number, title, description, type, division, spec_section, status, due_date, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [pid, 'SUB-' + String(sn++).padStart(3, '0'), s[0], s[1], s[2], s[3], s[4], s[5], s[6], demo]).catch(() => {});
      }
      created.submittals = subs.length;
    } catch (e) { console.error('[seed] submittals:', e.message); }
  }

  // ── Daily logs (own guard) ──
  const hasDailyLogs = (await one(`SELECT COUNT(*)::int AS c FROM daily_logs WHERE project_id = $1`, [pid])).c;
  if (!hasDailyLogs) {
    try {
      const logs = [
        [d(0), 'Sunny, light wind', 72, 55, 'Framing crew on L3. Concrete pour prep for L1 slab. Two deliveries received.'],
        [d(-1), 'Partly cloudy', 68, 52, 'Electrical rough-in continued on L2. Plumbing risers set. No safety incidents.'],
        [d(-2), 'Overcast, AM drizzle', 63, 50, 'Slow start due to rain. Interior work only until noon, then exterior resumed.'],
        [d(-3), 'Clear', 75, 58, 'Steel erection on north wing. Crane inspection completed. Full crew on site.'],
      ];
      for (const l of logs) {
        await q(`INSERT INTO daily_logs (project_id, log_date, weather, temperature_high, temperature_low, notes, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, l[0], l[1], l[2], l[3], l[4], demo]).catch(() => {});
      }
      created.daily_logs = logs.length;
    } catch (e) { console.error('[seed] daily_logs:', e.message); }
  }

  return {
    status: freshProject ? 'seeded' : 'topped_up',
    projectId: pid,
    login: 'demo@buildforge.com / demo1234',
    teamNames,
    formPublicUrlPath: formToken ? '/f/' + formToken : undefined,
    created,
  };
}

module.exports = { seedDemo };
