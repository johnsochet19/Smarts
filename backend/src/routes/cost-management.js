var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { logChange } = require('../db/changelog');
var { authenticate, requireRole } = require('../middleware/auth');
var { onStatusChange } = require('../notification-triggers');

/* ── constants ───────────────────────────────────────── */
var COST_TYPES  = ['labor', 'material', 'equipment', 'subcontractor', 'other'];
var UOM_VALUES  = ['lump_sum', 'sf', 'lf', 'ea', 'hr', 'ton', 'cy', 'day', 'wk', 'mo', 'gal', 'lb', 'each'];
var TYPE_SUFFIX = { labor: 'L', material: 'M', equipment: 'E', subcontractor: 'S', other: 'O' };
var CE_STATUSES = ['draft', 'open', 'closed'];
var CO_TYPES    = ['prime_contract', 'subcontract', 'purchase_order'];
var CO_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'void'];
/* status machine: allowed transitions for change_orders */
var CO_TRANSITIONS = {
  draft:    ['pending', 'void'],
  pending:  ['approved', 'rejected', 'void'],
  approved: ['void'],
  rejected: ['draft', 'void'],
  void:     []
};
var CONTRACT_TYPES    = ['prime_contract', 'subcontract', 'purchase_order'];
var CONTRACT_STATUSES = ['draft', 'out_for_signature', 'executed', 'terminated', 'expired'];
var ACCT_METHODS      = ['amount_based', 'unit_quantity_based'];
/* status machine: allowed transitions for contracts */
var CONTRACT_TRANSITIONS = {
  draft:             ['out_for_signature'],
  out_for_signature: ['executed', 'expired'],
  executed:          ['terminated'],
  terminated:        [],
  expired:           []
};
var INV_TYPES     = ['owner_invoice', 'subcontractor_invoice', 'direct_cost'];
var INV_STATUSES  = ['draft', 'under_review', 'approved', 'rejected', 'paid', 'void'];
var INV_TRANSITIONS = {
  draft:        ['under_review', 'void'],
  under_review: ['approved', 'rejected', 'void'],
  approved:     ['paid', 'void'],
  rejected:     ['draft', 'void'],
  paid:         ['void'],
  void:         []
};
var APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];

/* ── auto-migrate ────────────────────────────────────── */
(async function () {
  try {
    /* cost_codes — company-level master list */
    await db.query(`CREATE TABLE IF NOT EXISTS cost_codes_master (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE,
      name VARCHAR(255),
      division VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    /* budget_line_items — project-level */
    await db.query(`CREATE TABLE IF NOT EXISTS budget_line_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      cost_code_id INTEGER REFERENCES cost_codes_master(id),
      cost_type VARCHAR(30) DEFAULT 'other',
      description VARCHAR(255),
      budgeted_quantity DECIMAL(12,4),
      unit_of_measure VARCHAR(30),
      unit_cost DECIMAL(12,4),
      budgeted_amount DECIMAL(15,2) DEFAULT 0,
      committed_amount DECIMAL(15,2) DEFAULT 0,
      actual_cost DECIMAL(15,2) DEFAULT 0,
      projected_cost DECIMAL(15,2) DEFAULT 0,
      retainage_held DECIMAL(15,2) DEFAULT 0,
      percent_complete DECIMAL(5,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    /* change_events */
    await db.query(`CREATE TABLE IF NOT EXISTS change_events (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      number INTEGER,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      event_date DATE,
      location VARCHAR(255),
      initiated_by_id INTEGER REFERENCES users(id),
      cost_impact_amount DECIMAL(12,2),
      schedule_impact_days INTEGER,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    /* change_event_line_items */
    await db.query(`CREATE TABLE IF NOT EXISTS change_event_line_items (
      id SERIAL PRIMARY KEY,
      change_event_id INTEGER REFERENCES change_events(id) ON DELETE CASCADE,
      budget_code_id INTEGER REFERENCES budget_line_items(id),
      description TEXT,
      quantity DECIMAL(12,4),
      unit_of_measure VARCHAR(30),
      unit_cost DECIMAL(12,4),
      amount DECIMAL(15,2)
    )`);
    /* contracts — must exist before change_orders, which references contracts(id) */
    await db.query(`CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      type VARCHAR(30) DEFAULT 'prime_contract',
      title VARCHAR(500) NOT NULL,
      number VARCHAR(100),
      contractor_company VARCHAR(255),
      contractor_contact_id INTEGER REFERENCES users(id),
      status VARCHAR(30) DEFAULT 'draft',
      executed_date DATE,
      start_date DATE,
      completion_date DATE,
      original_contract_amount DECIMAL(15,2) DEFAULT 0,
      retainage_percent DECIMAL(5,2) DEFAULT 10.00,
      accounting_method VARCHAR(30) DEFAULT 'amount_based',
      payment_terms VARCHAR(255),
      signed_by INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    /* change_orders */
    await db.query(`CREATE TABLE IF NOT EXISTS change_orders (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      number INTEGER,
      revision_number INTEGER DEFAULT 0,
      type VARCHAR(30) DEFAULT 'prime_contract',
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      change_event_id INTEGER REFERENCES change_events(id),
      contract_id INTEGER REFERENCES contracts(id),
      request_received_from INTEGER REFERENCES users(id),
      schedule_impact_days INTEGER,
      field_change BOOLEAN DEFAULT false,
      paid_in_full BOOLEAN DEFAULT false,
      reviewer_id INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMP,
      reviewer_response VARCHAR(20),
      reviewer_notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    /* change_order_sov_lines */
    await db.query(`CREATE TABLE IF NOT EXISTS change_order_sov_lines (
      id SERIAL PRIMARY KEY,
      change_order_id INTEGER REFERENCES change_orders(id) ON DELETE CASCADE,
      prime_contract_line VARCHAR(255),
      change_event_line_id INTEGER REFERENCES change_event_line_items(id),
      budget_code_id INTEGER REFERENCES budget_line_items(id),
      description TEXT,
      amount DECIMAL(15,2),
      tax_code VARCHAR(50)
    )`);
    /* contract_sov_lines — relational SOV replacing JSONB */
    await db.query(`CREATE TABLE IF NOT EXISTS contract_sov_lines (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      line_number INTEGER,
      description TEXT,
      budget_code_id INTEGER REFERENCES budget_line_items(id),
      scheduled_value DECIMAL(15,2) DEFAULT 0,
      work_completed_previous DECIMAL(15,2) DEFAULT 0,
      work_completed_this_period DECIMAL(15,2) DEFAULT 0,
      stored_materials DECIMAL(15,2) DEFAULT 0
    )`);
    /* invoices */
    await db.query(`CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      contract_id INTEGER REFERENCES contracts(id),
      invoice_number VARCHAR(100),
      type VARCHAR(30),
      status VARCHAR(30) DEFAULT 'draft',
      period_start DATE,
      period_end DATE,
      billing_date DATE,
      due_date DATE,
      submitted_by_id INTEGER REFERENCES users(id),
      submitted_at TIMESTAMP,
      retainage_released DECIMAL(15,2) DEFAULT 0,
      paid_date DATE,
      payment_reference VARCHAR(255),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    /* invoice_sov_lines — relational SOV replacing JSONB */
    await db.query(`CREATE TABLE IF NOT EXISTS invoice_sov_lines (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      contract_sov_line_id INTEGER REFERENCES contract_sov_lines(id),
      work_completed_this_period DECIMAL(15,2) DEFAULT 0,
      stored_materials DECIMAL(15,2) DEFAULT 0
    )`);
    /* invoice_approval_steps — relational replacing JSONB */
    await db.query(`CREATE TABLE IF NOT EXISTS invoice_approval_steps (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      reviewer_id INTEGER REFERENCES users(id),
      step_order INTEGER,
      status VARCHAR(20) DEFAULT 'pending',
      notes TEXT,
      reviewed_at TIMESTAMP
    )`);
    /* direct_costs */
    await db.query(`CREATE TABLE IF NOT EXISTS direct_costs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      description VARCHAR(500) NOT NULL,
      vendor VARCHAR(255),
      invoice_number VARCHAR(100),
      invoice_date DATE,
      payment_date DATE,
      payment_method VARCHAR(50),
      cost_type VARCHAR(50) DEFAULT 'other',
      line_items JSONB DEFAULT '[]',
      total_amount NUMERIC(15,2) DEFAULT 0,
      attachments JSONB DEFAULT '[]',
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Cost management tables ready');
  } catch (err) {
    console.error('Cost mgmt migration note:', err.message);
  }

  /* legacy: migrate old cost_codes → cost_codes_master + budget_line_items */
  try {
    var hasCostCodes = await db.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cost_codes')`);
    if (hasCostCodes.rows[0].exists) {
      var oldRows = await db.query('SELECT * FROM cost_codes');
      if (oldRows.rows.length > 0) {
        for (var i = 0; i < oldRows.rows.length; i++) {
          var old = oldRows.rows[i];
          var code = old.cost_code || old.budget_code;
          if (!code) continue;
          /* upsert into cost_codes_master */
          var existing = await db.query('SELECT id FROM cost_codes_master WHERE code = $1', [code]);
          var masterCodeId;
          if (existing.rows.length > 0) {
            masterCodeId = existing.rows[0].id;
          } else {
            var ins = await db.query('INSERT INTO cost_codes_master (code, name) VALUES ($1, $2) RETURNING id', [code, old.description || code]);
            masterCodeId = ins.rows[0].id;
          }
          /* check if budget_line_item already migrated */
          var existBli = await db.query('SELECT id FROM budget_line_items WHERE project_id = $1 AND cost_code_id = $2 AND description = $3',
            [old.project_id, masterCodeId, old.description || '']);
          if (existBli.rows.length === 0 && old.project_id) {
            var ct = (old.cost_type || 'other').toLowerCase();
            if (!COST_TYPES.includes(ct)) ct = 'other';
            await db.query(`INSERT INTO budget_line_items (
              project_id, cost_code_id, cost_type, description,
              budgeted_quantity, unit_of_measure, unit_cost, budgeted_amount,
              committed_amount, actual_cost, projected_cost, retainage_held, percent_complete
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
              old.project_id, masterCodeId, ct, old.description || null,
              old.budgeted_quantity || null, old.unit_of_measure || null, old.unit_cost || null,
              old.budgeted_amount || 0, old.committed_cost || 0, old.actual_cost || 0,
              old.projected_final_cost || old.budgeted_amount || 0, old.retainage_amount || 0,
              old.percent_complete || 0
            ]);
          }
        }
        console.log('Legacy cost_codes migrated to cost_codes_master + budget_line_items');
      }
    }
  } catch (e) { /* migration already done or old table doesn't exist */ }

  /* ensure columns on existing tables */
  var alterCols = [
    /* CE legacy column renames */
    'ALTER TABLE change_events ADD COLUMN IF NOT EXISTS number INTEGER',
    'ALTER TABLE change_events ADD COLUMN IF NOT EXISTS initiated_by_id INTEGER',
    'ALTER TABLE change_events ADD COLUMN IF NOT EXISTS event_date DATE',
    'ALTER TABLE change_events ADD COLUMN IF NOT EXISTS location VARCHAR(255)',
    'ALTER TABLE change_events ADD COLUMN IF NOT EXISTS cost_impact_amount DECIMAL(12,2)',
    'ALTER TABLE change_events ADD COLUMN IF NOT EXISTS schedule_impact_days INTEGER',
    /* CO legacy column renames */
    'ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS number INTEGER',
    'ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS type VARCHAR(30)',
    'ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS change_event_id INTEGER',
    'ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS contract_id INTEGER',
    'ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP',
    'ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS reviewer_response VARCHAR(20)',
    'ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS reviewer_notes TEXT',
  ];
  for (var j = 0; j < alterCols.length; j++) { await db.query(alterCols[j]).catch(function () {}); }

  /* Migrate old CE event_number → number, initiated_by → initiated_by_id */
  await db.query("UPDATE change_events SET number = event_number WHERE number IS NULL AND event_number IS NOT NULL").catch(function(){});
  await db.query("UPDATE change_events SET initiated_by_id = initiated_by WHERE initiated_by_id IS NULL AND initiated_by IS NOT NULL").catch(function(){});
  /* Lowercase old CE statuses */
  await db.query("UPDATE change_events SET status = LOWER(status) WHERE status != LOWER(status)").catch(function(){});

  /* Migrate old CO co_number → number, linked_change_event_id → change_event_id, co_type → type */
  await db.query("UPDATE change_orders SET number = co_number WHERE number IS NULL AND co_number IS NOT NULL").catch(function(){});
  await db.query("UPDATE change_orders SET change_event_id = linked_change_event_id WHERE change_event_id IS NULL AND linked_change_event_id IS NOT NULL").catch(function(){});
  await db.query("UPDATE change_orders SET reviewed_at = review_date WHERE reviewed_at IS NULL AND review_date IS NOT NULL").catch(function(){});
  await db.query("UPDATE change_orders SET reviewer_notes = review_response WHERE reviewer_notes IS NULL AND review_response IS NOT NULL").catch(function(){});
  /* Lowercase old CO statuses and map types */
  await db.query("UPDATE change_orders SET status = LOWER(status) WHERE status != LOWER(status)").catch(function(){});
  await db.query("UPDATE change_orders SET type = 'prime_contract' WHERE type IS NULL AND (co_type IS NULL OR co_type ILIKE '%prime%')").catch(function(){});
  await db.query("UPDATE change_orders SET type = 'subcontract' WHERE type IS NULL AND co_type ILIKE '%sub%'").catch(function(){});
  await db.query("UPDATE change_orders SET type = 'purchase_order' WHERE type IS NULL AND co_type ILIKE '%purchase%'").catch(function(){});

  /* Migrate old JSONB line_items from change_events into change_event_line_items */
  try {
    var oldCEs = await db.query("SELECT id, line_items FROM change_events WHERE line_items IS NOT NULL AND line_items != '[]'::jsonb");
    for (var k = 0; k < oldCEs.rows.length; k++) {
      var ce = oldCEs.rows[k];
      var lines = typeof ce.line_items === 'string' ? JSON.parse(ce.line_items) : (ce.line_items || []);
      for (var l = 0; l < lines.length; l++) {
        var li = lines[l];
        var exists = await db.query('SELECT id FROM change_event_line_items WHERE change_event_id = $1 AND description = $2', [ce.id, li.description || null]);
        if (exists.rows.length === 0) {
          await db.query('INSERT INTO change_event_line_items (change_event_id, description, quantity, unit_of_measure, unit_cost, amount) VALUES ($1,$2,$3,$4,$5,$6)',
            [ce.id, li.description || null, li.quantity || null, li.unit || li.unit_of_measure || null, li.unit_cost || null, li.amount || null]);
        }
      }
    }
  } catch(e) { /* line_items col may not exist on new installs */ }

  /* Migrate old JSONB sov_line_items from change_orders into change_order_sov_lines */
  try {
    var oldCOs = await db.query("SELECT id, sov_line_items FROM change_orders WHERE sov_line_items IS NOT NULL AND sov_line_items != '[]'::jsonb");
    for (var m = 0; m < oldCOs.rows.length; m++) {
      var co = oldCOs.rows[m];
      var sovs = typeof co.sov_line_items === 'string' ? JSON.parse(co.sov_line_items) : (co.sov_line_items || []);
      for (var n = 0; n < sovs.length; n++) {
        var sov = sovs[n];
        var sexist = await db.query('SELECT id FROM change_order_sov_lines WHERE change_order_id = $1 AND description = $2', [co.id, sov.description || null]);
        if (sexist.rows.length === 0) {
          await db.query('INSERT INTO change_order_sov_lines (change_order_id, prime_contract_line, description, amount, tax_code) VALUES ($1,$2,$3,$4,$5)',
            [co.id, sov.prime_contract_line || null, sov.description || null, sov.amount || null, sov.tax_code || null]);
        }
      }
    }
  } catch(e) { /* sov_line_items col may not exist on new installs */ }

  /* ── Contracts legacy migration ── */
  /* ensure new columns exist on old contracts table */
  var contractAlters = [
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS type VARCHAR(30)',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS number VARCHAR(100)',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contractor_company VARCHAR(255)',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contractor_contact_id INTEGER',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS retainage_percent DECIMAL(5,2) DEFAULT 10.00',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_by INTEGER',
  ];
  for (var ca = 0; ca < contractAlters.length; ca++) { await db.query(contractAlters[ca]).catch(function () {}); }
  /* Migrate old column names: contract_type → type, contract_number → number */
  await db.query("UPDATE contracts SET type = CASE WHEN contract_type ILIKE '%sub%' THEN 'subcontract' WHEN contract_type ILIKE '%purchase%' THEN 'purchase_order' ELSE 'prime_contract' END WHERE type IS NULL AND contract_type IS NOT NULL").catch(function(){});
  await db.query("UPDATE contracts SET number = contract_number WHERE number IS NULL AND contract_number IS NOT NULL").catch(function(){});
  /* Lowercase old statuses */
  await db.query("UPDATE contracts SET status = 'draft' WHERE status = 'Draft'").catch(function(){});
  await db.query("UPDATE contracts SET status = 'out_for_signature' WHERE status = 'Out for Signature'").catch(function(){});
  await db.query("UPDATE contracts SET status = 'executed' WHERE status = 'Executed'").catch(function(){});
  await db.query("UPDATE contracts SET status = 'terminated' WHERE status = 'Terminated'").catch(function(){});
  /* Lowercase old accounting_method */
  await db.query("UPDATE contracts SET accounting_method = 'amount_based' WHERE accounting_method = 'Amount Based'").catch(function(){});
  await db.query("UPDATE contracts SET accounting_method = 'unit_quantity_based' WHERE accounting_method = 'Unit/Quantity Based'").catch(function(){});
  /* Migrate old contractor_company_id → contractor_company (grab user name) */
  await db.query("UPDATE contracts SET contractor_company = (SELECT COALESCE(name, email) FROM users WHERE id = contractor_company_id) WHERE contractor_company IS NULL AND contractor_company_id IS NOT NULL").catch(function(){});
  /* Migrate retainage */
  await db.query("UPDATE contracts SET retainage_percent = retention_percentage WHERE retainage_percent IS NULL AND retention_percentage IS NOT NULL AND retention_percentage > 0").catch(function(){});

  /* Migrate old JSONB sov_line_items from contracts into contract_sov_lines */
  try {
    var oldContracts = await db.query("SELECT id, sov_line_items FROM contracts WHERE sov_line_items IS NOT NULL AND sov_line_items != '[]'::jsonb");
    for (var cc = 0; cc < oldContracts.rows.length; cc++) {
      var ct = oldContracts.rows[cc];
      var cLines = typeof ct.sov_line_items === 'string' ? JSON.parse(ct.sov_line_items) : (ct.sov_line_items || []);
      for (var cl = 0; cl < cLines.length; cl++) {
        var cLi = cLines[cl];
        var cExists = await db.query('SELECT id FROM contract_sov_lines WHERE contract_id = $1 AND description = $2', [ct.id, cLi.description || null]);
        if (cExists.rows.length === 0) {
          await db.query('INSERT INTO contract_sov_lines (contract_id, line_number, description, scheduled_value) VALUES ($1,$2,$3,$4)',
            [ct.id, cl + 1, cLi.description || null, cLi.amount || cLi.scheduled_value || 0]);
        }
      }
    }
  } catch(e) { /* sov_line_items col may not exist on new installs */ }

  /* ── Invoices legacy migration ── */
  var invAlters = [
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS type VARCHAR(30)',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS submitted_by_id INTEGER',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS retainage_released DECIMAL(15,2) DEFAULT 0',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_date DATE',
    'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255)',
  ];
  for (var ia = 0; ia < invAlters.length; ia++) { await db.query(invAlters[ia]).catch(function () {}); }
  /* Lowercase old statuses */
  await db.query("UPDATE invoices SET status = 'draft' WHERE status = 'Draft'").catch(function(){});
  await db.query("UPDATE invoices SET status = 'under_review' WHERE status = 'Under Review'").catch(function(){});
  await db.query("UPDATE invoices SET status = 'approved' WHERE status = 'Approved'").catch(function(){});
  await db.query("UPDATE invoices SET status = 'paid' WHERE status = 'Paid'").catch(function(){});

  /* Migrate old JSONB sov_line_items from invoices into invoice_sov_lines */
  try {
    var oldInvs = await db.query("SELECT id, sov_line_items FROM invoices WHERE sov_line_items IS NOT NULL AND sov_line_items != '[]'::jsonb");
    for (var iv = 0; iv < oldInvs.rows.length; iv++) {
      var invRow = oldInvs.rows[iv];
      var iLines = typeof invRow.sov_line_items === 'string' ? JSON.parse(invRow.sov_line_items) : (invRow.sov_line_items || []);
      for (var il = 0; il < iLines.length; il++) {
        var iLi = iLines[il];
        var iExists = await db.query('SELECT id FROM invoice_sov_lines WHERE invoice_id = $1 AND work_completed_this_period = $2 AND stored_materials = $3',
          [invRow.id, Number(iLi.work_completed_this_amount) || 0, Number(iLi.stored_materials) || 0]);
        if (iExists.rows.length === 0) {
          await db.query('INSERT INTO invoice_sov_lines (invoice_id, work_completed_this_period, stored_materials) VALUES ($1,$2,$3)',
            [invRow.id, Number(iLi.work_completed_this_amount) || 0, Number(iLi.stored_materials) || 0]);
        }
      }
    }
  } catch(e) { /* sov_line_items col may not exist on new installs */ }

  /* Migrate old JSONB approval_workflow from invoices into invoice_approval_steps */
  try {
    var oldInvAppr = await db.query("SELECT id, approval_workflow FROM invoices WHERE approval_workflow IS NOT NULL AND approval_workflow != '[]'::jsonb");
    for (var iw = 0; iw < oldInvAppr.rows.length; iw++) {
      var invApRow = oldInvAppr.rows[iw];
      var wfItems = typeof invApRow.approval_workflow === 'string' ? JSON.parse(invApRow.approval_workflow) : (invApRow.approval_workflow || []);
      for (var wfi = 0; wfi < wfItems.length; wfi++) {
        var wf = wfItems[wfi];
        var wfExists = await db.query('SELECT id FROM invoice_approval_steps WHERE invoice_id = $1 AND step_order = $2', [invApRow.id, wfi + 1]);
        if (wfExists.rows.length === 0) {
          var wfSt = (wf.status || 'pending').toLowerCase();
          if (!APPROVAL_STATUSES.includes(wfSt)) wfSt = 'pending';
          await db.query('INSERT INTO invoice_approval_steps (invoice_id, reviewer_id, step_order, status, reviewed_at) VALUES ($1,$2,$3,$4,$5)',
            [invApRow.id, wf.reviewer_id || null, wfi + 1, wfSt, wf.timestamp || null]);
        }
      }
    }
  } catch(e) { /* approval_workflow col may not exist on new installs */ }
})();

/* ── helpers ─────────────────────────────────────────── */
function validateProject(req, res, next) {
  var pid = req.params.id || req.query.project_id;
  if (!pid) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(pid);
  next();
}

async function enrichBudgetLines(rows, projectId) {
  if (rows.length === 0) return rows;

  /* 1. batch-load cost_codes_master info */
  var codeIds = rows.map(function (r) { return r.cost_code_id; }).filter(Boolean);
  var unique = codeIds.filter(function (v, i, a) { return a.indexOf(v) === i; });
  var codeMap = {};
  if (unique.length > 0) {
    var ccResult = await db.query('SELECT * FROM cost_codes_master WHERE id = ANY($1)', [unique]);
    ccResult.rows.forEach(function (c) { codeMap[c.id] = c; });
  }

  /* 2. batch-load approved change order amounts grouped by budget_code_id (via sov lines) */
  var approvedMap = {};
  if (projectId) {
    /* also collect budget_line_item ids for direct matching */
    var bliIds = rows.map(function (r) { return r.id; });
    if (bliIds.length > 0) {
      var coResult = await db.query(
        "SELECT sol.budget_code_id, COALESCE(SUM(sol.amount), 0) AS total " +
        "FROM change_order_sov_lines sol " +
        "JOIN change_orders co ON co.id = sol.change_order_id " +
        "WHERE co.project_id = $1 AND co.status = 'approved' AND sol.budget_code_id = ANY($2) " +
        "GROUP BY sol.budget_code_id",
        [projectId, bliIds]
      );
      coResult.rows.forEach(function (r) { approvedMap[r.budget_code_id] = Number(r.total) || 0; });
    }
  }

  /* 3. enrich each row */
  rows.forEach(function (r) {
    var cc = codeMap[r.cost_code_id];
    if (cc) {
      r.cost_code = cc.code;
      r.cost_code_name = cc.name;
      r.cost_code_division = cc.division;
      /* budget_code: [cost_code]-[type_suffix] e.g. "03-000-L" */
      var suffix = TYPE_SUFFIX[(r.cost_type || 'other').toLowerCase()] || 'O';
      r.budget_code = cc.code + '-' + suffix;
    } else {
      r.budget_code = null;
    }

    /* computed aggregations */
    var ba = Number(r.budgeted_amount) || 0;
    var pc = Number(r.projected_cost) || 0;
    var ac = Number(r.actual_cost) || 0;

    r.approved_changes = approvedMap[r.id] || 0;
    r.revised_budget = ba + r.approved_changes;
    r.variance = r.revised_budget - pc;
    r.balance_to_finish = pc - ac;
  });

  return rows;
}

/* ══════════════════════════════════════════════════════
   COST CODES (company-level master list)
   ══════════════════════════════════════════════════════ */

router.get('/cost-codes', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM cost_codes_master ORDER BY code');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/cost-codes/:codeId', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM cost_codes_master WHERE id = $1', [req.params.codeId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Cost code not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cost-codes', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var b = req.body;
    if (!b.code) return res.status(400).json({ error: 'code required' });
    var result = await db.query(
      'INSERT INTO cost_codes_master (code, name, division) VALUES ($1,$2,$3) RETURNING *',
      [b.code, b.name || null, b.division || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.message && err.message.includes('duplicate key')) return res.status(409).json({ error: 'Cost code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/cost-codes/:codeId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM cost_codes_master WHERE id = $1', [req.params.codeId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Cost code not found' });
    var allowed = ['code', 'name', 'division'];
    var updates = {};
    for (var i = 0; i < allowed.length; i++) {
      if (req.body[allowed[i]] !== undefined) updates[allowed[i]] = req.body[allowed[i]] === '' ? null : req.body[allowed[i]];
    }
    if (Object.keys(updates).length === 0) return res.json(existing.rows[0]);
    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.codeId);
    var result = await db.query('UPDATE cost_codes_master SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/cost-codes/:codeId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM cost_codes_master WHERE id = $1', [req.params.codeId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Cost code not found' });
    /* check if in use */
    var inUse = await db.query('SELECT COUNT(*) FROM budget_line_items WHERE cost_code_id = $1', [req.params.codeId]);
    if (Number(inUse.rows[0].count) > 0) return res.status(400).json({ error: 'Cost code is referenced by ' + inUse.rows[0].count + ' budget line items' });
    await db.query('DELETE FROM cost_codes_master WHERE id = $1', [req.params.codeId]);
    res.json({ message: 'Cost code deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   BUDGET LINE ITEMS (project-scoped)
   ══════════════════════════════════════════════════════ */

router.get('/budget', authenticate, validateProject, async function (req, res) {
  try {
    var result = await db.query(
      'SELECT * FROM budget_line_items WHERE project_id = $1 ORDER BY created_at',
      [req.projectId]
    );
    var enriched = await enrichBudgetLines(result.rows, req.projectId);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/budget/:lineId', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM budget_line_items WHERE id = $1', [req.params.lineId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Budget line item not found' });
    var enriched = await enrichBudgetLines(result.rows, result.rows[0].project_id);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/budget', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (!b.cost_code_id && !b.description) return res.status(400).json({ error: 'cost_code_id or description required' });
    var ct = (b.cost_type || 'other').toLowerCase();
    if (!COST_TYPES.includes(ct)) ct = 'other';
    var ba = b.budgeted_amount || ((Number(b.budgeted_quantity) || 0) * (Number(b.unit_cost) || 0));
    var pc = b.projected_cost || ba || 0;
    var result = await db.query(
      `INSERT INTO budget_line_items (
        project_id, cost_code_id, cost_type, description,
        budgeted_quantity, unit_of_measure, unit_cost, budgeted_amount,
        committed_amount, actual_cost, projected_cost, retainage_held, percent_complete
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        req.projectId, b.cost_code_id || null, ct, b.description || null,
        b.budgeted_quantity || null, b.unit_of_measure || null, b.unit_cost || null, ba,
        b.committed_amount || 0, b.actual_cost || 0, pc, b.retainage_held || 0, b.percent_complete || 0
      ]
    );
    await logChange({ tableName: 'budget_line_items', recordId: result.rows[0].id, operation: 'CREATE',
      newValue: JSON.stringify({ cost_type: ct, description: b.description }), userId: req.user.id });
    var enriched = await enrichBudgetLines([result.rows[0]], req.projectId);
    res.status(201).json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/budget/:lineId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM budget_line_items WHERE id = $1', [req.params.lineId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Budget line item not found' });
    var old = existing.rows[0];
    var allowed = [
      'cost_code_id', 'cost_type', 'description',
      'budgeted_quantity', 'unit_of_measure', 'unit_cost', 'budgeted_amount',
      'committed_amount', 'actual_cost', 'projected_cost', 'retainage_held', 'percent_complete'
    ];
    var updates = { updated_at: new Date() };
    for (var i = 0; i < allowed.length; i++) {
      var field = allowed[i];
      if (req.body[field] !== undefined) {
        if (field === 'cost_type') {
          var ct = (req.body[field] || 'other').toLowerCase();
          updates[field] = COST_TYPES.includes(ct) ? ct : 'other';
        } else {
          updates[field] = req.body[field] === '' ? null : req.body[field];
        }
      }
    }
    /* auto-calc budgeted_amount if qty/unit_cost changed */
    var qty = updates.budgeted_quantity !== undefined ? updates.budgeted_quantity : old.budgeted_quantity;
    var uc = updates.unit_cost !== undefined ? updates.unit_cost : old.unit_cost;
    if ((updates.budgeted_quantity !== undefined || updates.unit_cost !== undefined) && updates.budgeted_amount === undefined) {
      updates.budgeted_amount = (Number(qty) || 0) * (Number(uc) || 0);
    }

    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.lineId);
    var result = await db.query('UPDATE budget_line_items SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    await logChange({ tableName: 'budget_line_items', recordId: req.params.lineId, operation: 'UPDATE',
      newValue: JSON.stringify({ description: result.rows[0].description }), userId: req.user.id });
    var enriched = await enrichBudgetLines([result.rows[0]], result.rows[0].project_id);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/budget/:lineId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM budget_line_items WHERE id = $1', [req.params.lineId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Budget line item not found' });
    await logChange({ tableName: 'budget_line_items', recordId: req.params.lineId, operation: 'DELETE',
      oldValue: JSON.stringify({ description: existing.rows[0].description }), userId: req.user.id });
    await db.query('DELETE FROM budget_line_items WHERE id = $1', [req.params.lineId]);
    res.json({ message: 'Budget line item deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   CHANGE EVENTS (project-scoped)
   ══════════════════════════════════════════════════════ */
async function getNextCENumber(projectId) {
  var r = await db.query('SELECT COALESCE(MAX(number), 0) + 1 as next FROM change_events WHERE project_id = $1', [projectId]);
  return r.rows[0].next;
}

async function enrichCE(row) {
  var lines = await db.query('SELECT * FROM change_event_line_items WHERE change_event_id = $1 ORDER BY id', [row.id]);
  row.line_items = lines.rows;
  return row;
}
async function enrichCEs(rows) {
  if (rows.length === 0) return rows;
  var ids = rows.map(function(r) { return r.id; });
  var lines = await db.query('SELECT * FROM change_event_line_items WHERE change_event_id = ANY($1) ORDER BY id', [ids]);
  var map = {};
  lines.rows.forEach(function(li) { if (!map[li.change_event_id]) map[li.change_event_id] = []; map[li.change_event_id].push(li); });
  rows.forEach(function(r) { r.line_items = map[r.id] || []; });
  return rows;
}

router.get('/change-events', authenticate, validateProject, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM change_events WHERE project_id = $1 ORDER BY number DESC NULLS LAST, created_at DESC', [req.projectId]);
    var enriched = await enrichCEs(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/change-events/:ceId', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM change_events WHERE id = $1', [req.params.ceId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Change event not found' });
    var enriched = await enrichCE(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/change-events', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (!b.title) return res.status(400).json({ error: 'title required' });
    var ceNumber = await getNextCENumber(req.projectId);
    var st = (b.status || 'draft').toLowerCase();
    if (!CE_STATUSES.includes(st)) st = 'draft';
    var result = await db.query(
      `INSERT INTO change_events (
        project_id, number, title, description, status,
        event_date, location, initiated_by_id,
        cost_impact_amount, schedule_impact_days, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.projectId, ceNumber, b.title, b.description || null, st,
        b.event_date || null, b.location || null, b.initiated_by_id || req.user.id,
        b.cost_impact_amount || 0, b.schedule_impact_days || 0, req.user.id
      ]
    );
    var ce = result.rows[0];
    /* insert line items */
    if (Array.isArray(b.line_items)) {
      for (var i = 0; i < b.line_items.length; i++) {
        var li = b.line_items[i];
        var amt = li.amount || ((Number(li.quantity) || 0) * (Number(li.unit_cost) || 0));
        await db.query(
          'INSERT INTO change_event_line_items (change_event_id, budget_code_id, description, quantity, unit_of_measure, unit_cost, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [ce.id, li.budget_code_id || null, li.description || null, li.quantity || null, li.unit_of_measure || null, li.unit_cost || null, amt]
        );
      }
    }
    /* auto-calc cost_impact from line items if not set */
    if (!b.cost_impact_amount && Array.isArray(b.line_items) && b.line_items.length > 0) {
      var total = await db.query('SELECT COALESCE(SUM(amount), 0) AS total FROM change_event_line_items WHERE change_event_id = $1', [ce.id]);
      await db.query('UPDATE change_events SET cost_impact_amount = $1 WHERE id = $2', [total.rows[0].total, ce.id]);
      ce.cost_impact_amount = Number(total.rows[0].total);
    }
    await logChange({ tableName: 'change_events', recordId: ce.id, operation: 'CREATE',
      newValue: JSON.stringify({ number: ceNumber, title: b.title }), userId: req.user.id });
    var enriched = await enrichCE(ce);
    res.status(201).json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/change-events/:ceId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM change_events WHERE id = $1', [req.params.ceId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Change event not found' });
    var allowed = ['title', 'description', 'status', 'event_date', 'location',
      'initiated_by_id', 'cost_impact_amount', 'schedule_impact_days'];
    var updates = { updated_at: new Date() };
    for (var i = 0; i < allowed.length; i++) {
      var f = allowed[i];
      if (req.body[f] !== undefined) {
        if (f === 'status') {
          var st = (req.body[f] || 'draft').toLowerCase();
          updates[f] = CE_STATUSES.includes(st) ? st : 'draft';
        } else {
          updates[f] = req.body[f] === '' ? null : req.body[f];
        }
      }
    }
    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.ceId);
    var result = await db.query('UPDATE change_events SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    /* replace line items if provided */
    if (Array.isArray(req.body.line_items)) {
      await db.query('DELETE FROM change_event_line_items WHERE change_event_id = $1', [req.params.ceId]);
      for (var j = 0; j < req.body.line_items.length; j++) {
        var li = req.body.line_items[j];
        var amt = li.amount || ((Number(li.quantity) || 0) * (Number(li.unit_cost) || 0));
        await db.query(
          'INSERT INTO change_event_line_items (change_event_id, budget_code_id, description, quantity, unit_of_measure, unit_cost, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [req.params.ceId, li.budget_code_id || null, li.description || null, li.quantity || null, li.unit_of_measure || null, li.unit_cost || null, amt]
        );
      }
      /* auto-calc cost_impact from line items */
      var total = await db.query('SELECT COALESCE(SUM(amount), 0) AS total FROM change_event_line_items WHERE change_event_id = $1', [req.params.ceId]);
      if (!updates.cost_impact_amount) {
        await db.query('UPDATE change_events SET cost_impact_amount = $1 WHERE id = $2', [total.rows[0].total, req.params.ceId]);
        result.rows[0].cost_impact_amount = Number(total.rows[0].total);
      }
    }
    await logChange({ tableName: 'change_events', recordId: req.params.ceId, operation: 'UPDATE',
      newValue: JSON.stringify({ status: result.rows[0].status }), userId: req.user.id });
    var enriched = await enrichCE(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/change-events/:ceId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM change_events WHERE id = $1', [req.params.ceId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Change event not found' });
    /* check if linked to change orders */
    var linked = await db.query('SELECT COUNT(*) FROM change_orders WHERE change_event_id = $1', [req.params.ceId]);
    if (Number(linked.rows[0].count) > 0) return res.status(400).json({ error: 'Change event is linked to ' + linked.rows[0].count + ' change order(s)' });
    await logChange({ tableName: 'change_events', recordId: req.params.ceId, operation: 'DELETE',
      oldValue: JSON.stringify({ title: existing.rows[0].title }), userId: req.user.id });
    /* cascade deletes line items */
    await db.query('DELETE FROM change_events WHERE id = $1', [req.params.ceId]);
    res.json({ message: 'Change event deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   CHANGE ORDERS (project-scoped)
   ══════════════════════════════════════════════════════ */
async function getNextCONumber(projectId) {
  var r = await db.query('SELECT COALESCE(MAX(number), 0) + 1 as next FROM change_orders WHERE project_id = $1', [projectId]);
  return r.rows[0].next;
}

async function enrichCO(row) {
  var lines = await db.query('SELECT * FROM change_order_sov_lines WHERE change_order_id = $1 ORDER BY id', [row.id]);
  row.sov_line_items = lines.rows;
  return row;
}
async function enrichCOs(rows) {
  if (rows.length === 0) return rows;
  var ids = rows.map(function(r) { return r.id; });
  var lines = await db.query('SELECT * FROM change_order_sov_lines WHERE change_order_id = ANY($1) ORDER BY id', [ids]);
  var map = {};
  lines.rows.forEach(function(li) { if (!map[li.change_order_id]) map[li.change_order_id] = []; map[li.change_order_id].push(li); });
  rows.forEach(function(r) { r.sov_line_items = map[r.id] || []; });
  return rows;
}

/* ── Contract enrichment: batch-load SOV lines + compute fields ── */
async function enrichContract(row) {
  var lines = await db.query('SELECT * FROM contract_sov_lines WHERE contract_id = $1 ORDER BY line_number, id', [row.id]);
  row.sov_lines = lines.rows.map(computeSOVLine);
  computeContractTotals(row);
  return row;
}
async function enrichContracts(rows) {
  if (rows.length === 0) return rows;
  var ids = rows.map(function(r) { return r.id; });
  var lines = await db.query('SELECT * FROM contract_sov_lines WHERE contract_id = ANY($1) ORDER BY line_number, id', [ids]);
  var map = {};
  lines.rows.forEach(function(li) {
    if (!map[li.contract_id]) map[li.contract_id] = [];
    map[li.contract_id].push(computeSOVLine(li));
  });
  rows.forEach(function(r) { r.sov_lines = map[r.id] || []; computeContractTotals(r); });
  return rows;
}
function computeSOVLine(li) {
  var sv = Number(li.scheduled_value) || 0;
  var prev = Number(li.work_completed_previous) || 0;
  var thisPd = Number(li.work_completed_this_period) || 0;
  var stored = Number(li.stored_materials) || 0;
  var totalCompleted = prev + thisPd + stored;
  li.total_completed = totalCompleted;
  li.percent_complete = sv > 0 ? Math.round((totalCompleted / sv) * 10000) / 100 : 0;
  li.balance_to_finish = sv - totalCompleted;
  li.retainage = 0; /* computed from contract-level retainage_percent in computeContractTotals */
  return li;
}
function computeContractTotals(row) {
  var lines = row.sov_lines || [];
  var retPct = Number(row.retainage_percent) || 0;
  var totalScheduled = 0, totalCompleted = 0;
  for (var i = 0; i < lines.length; i++) {
    totalScheduled += Number(lines[i].scheduled_value) || 0;
    totalCompleted += Number(lines[i].total_completed) || 0;
    lines[i].retainage = Math.round(((Number(lines[i].total_completed) || 0) * retPct / 100) * 100) / 100;
  }
  /* approved_changes_amount: sum of approved CO sov_line amounts that reference this contract */
  /* (computed async in enrichContract — we set a placeholder; actual sum added below) */
  var origAmt = Number(row.original_contract_amount) || 0;
  row.approved_changes_amount = row._approved_co_sum || 0;
  row.revised_contract_amount = origAmt + row.approved_changes_amount;
  row.billed_to_date = totalCompleted;
  row.balance_to_finish = row.revised_contract_amount - totalCompleted;
  row.retainage_held = Math.round((totalCompleted * retPct / 100) * 100) / 100;
}

/* ── Invoice enrichment: batch-load SOV lines + approval steps + compute totals ── */
async function enrichInvoice(row) {
  var sovLines = await db.query(
    `SELECT isl.*, csl.description, csl.scheduled_value, csl.work_completed_previous, csl.line_number, csl.budget_code_id
     FROM invoice_sov_lines isl
     LEFT JOIN contract_sov_lines csl ON csl.id = isl.contract_sov_line_id
     WHERE isl.invoice_id = $1 ORDER BY csl.line_number, isl.id`, [row.id]);
  var steps = await db.query('SELECT * FROM invoice_approval_steps WHERE invoice_id = $1 ORDER BY step_order', [row.id]);
  row.sov_lines = sovLines.rows;
  row.approval_steps = steps.rows;
  computeInvoiceTotals(row);
  return row;
}
async function enrichInvoices(rows) {
  if (rows.length === 0) return rows;
  var ids = rows.map(function(r) { return r.id; });
  var sovLines = await db.query(
    `SELECT isl.*, csl.description, csl.scheduled_value, csl.work_completed_previous, csl.line_number, csl.budget_code_id
     FROM invoice_sov_lines isl
     LEFT JOIN contract_sov_lines csl ON csl.id = isl.contract_sov_line_id
     WHERE isl.invoice_id = ANY($1) ORDER BY csl.line_number, isl.id`, [ids]);
  var steps = await db.query('SELECT * FROM invoice_approval_steps WHERE invoice_id = ANY($1) ORDER BY step_order', [ids]);
  var sovMap = {}, stepMap = {};
  sovLines.rows.forEach(function(l) { if (!sovMap[l.invoice_id]) sovMap[l.invoice_id] = []; sovMap[l.invoice_id].push(l); });
  steps.rows.forEach(function(s) { if (!stepMap[s.invoice_id]) stepMap[s.invoice_id] = []; stepMap[s.invoice_id].push(s); });
  rows.forEach(function(r) { r.sov_lines = sovMap[r.id] || []; r.approval_steps = stepMap[r.id] || []; computeInvoiceTotals(r); });
  return rows;
}
function computeInvoiceTotals(row) {
  var lines = row.sov_lines || [];
  /* get retainage percent from linked contract */
  var retPct = row._retainage_percent || 0;
  var scheduledValue = 0, previousBilled = 0, thisPeriod = 0, storedMaterials = 0;
  for (var i = 0; i < lines.length; i++) {
    var sv = Number(lines[i].scheduled_value) || 0;
    var prev = Number(lines[i].work_completed_previous) || 0;
    var thisP = Number(lines[i].work_completed_this_period) || 0;
    var stored = Number(lines[i].stored_materials) || 0;
    scheduledValue += sv;
    previousBilled += prev;
    thisPeriod += thisP;
    storedMaterials += stored;
    /* per-line computed fields */
    var totalCS = prev + thisP + stored;
    lines[i].total_completed_and_stored = totalCS;
    lines[i].percent_complete = sv > 0 ? Math.round((totalCS / sv) * 10000) / 100 : 0;
    lines[i].retainage_this_period = Math.round((thisP * retPct / 100) * 100) / 100;
  }
  var totalCompletedAndStored = previousBilled + thisPeriod + storedMaterials;
  var retainageHeld = Math.round((totalCompletedAndStored * retPct / 100) * 100) / 100;
  var retainageReleased = Number(row.retainage_released) || 0;
  var netDue = thisPeriod + storedMaterials - Math.round(((thisPeriod + storedMaterials) * retPct / 100) * 100) / 100 + retainageReleased;
  row.total_amount = totalCompletedAndStored;
  row.retainage_held = retainageHeld;
  row.net_due = netDue;
  row.balance_to_finish = scheduledValue - totalCompletedAndStored;
  row._summary = { scheduledValue: scheduledValue, previousBilled: previousBilled, thisPeriod: thisPeriod, storedMaterials: storedMaterials, totalCompletedAndStored: totalCompletedAndStored };
}

router.get('/change-orders', authenticate, validateProject, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM change_orders WHERE project_id = $1 ORDER BY number DESC NULLS LAST, created_at DESC', [req.projectId]);
    var enriched = await enrichCOs(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/change-orders/:coId', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM change_orders WHERE id = $1', [req.params.coId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Change order not found' });
    var enriched = await enrichCO(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/change-orders', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (!b.title) return res.status(400).json({ error: 'title required' });
    var coNumber = await getNextCONumber(req.projectId);
    var st = (b.status || 'draft').toLowerCase();
    if (!CO_STATUSES.includes(st)) st = 'draft';
    var tp = (b.type || 'prime_contract').toLowerCase();
    if (!CO_TYPES.includes(tp)) tp = 'prime_contract';
    var result = await db.query(
      `INSERT INTO change_orders (
        project_id, number, revision_number, type, title, description, status,
        change_event_id, contract_id, request_received_from,
        schedule_impact_days, field_change, paid_in_full,
        reviewer_id, reviewed_at, reviewer_response, reviewer_notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        req.projectId, coNumber, 0, tp, b.title, b.description || null, st,
        b.change_event_id || null, b.contract_id || null, b.request_received_from || null,
        b.schedule_impact_days || 0, b.field_change || false, b.paid_in_full || false,
        b.reviewer_id || null, b.reviewed_at || null, b.reviewer_response || null, b.reviewer_notes || null,
        req.user.id
      ]
    );
    var co = result.rows[0];
    /* insert SOV line items */
    if (Array.isArray(b.sov_line_items)) {
      for (var i = 0; i < b.sov_line_items.length; i++) {
        var sov = b.sov_line_items[i];
        await db.query(
          'INSERT INTO change_order_sov_lines (change_order_id, prime_contract_line, change_event_line_id, budget_code_id, description, amount, tax_code) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [co.id, sov.prime_contract_line || null, sov.change_event_line_id || null, sov.budget_code_id || null, sov.description || null, sov.amount || null, sov.tax_code || null]
        );
      }
    }
    await logChange({ tableName: 'change_orders', recordId: co.id, operation: 'CREATE',
      newValue: JSON.stringify({ number: coNumber, title: b.title }), userId: req.user.id });
    var enriched = await enrichCO(co);
    res.status(201).json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/change-orders/:coId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM change_orders WHERE id = $1', [req.params.coId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Change order not found' });
    var old = existing.rows[0];

    /* status machine validation */
    if (req.body.status !== undefined) {
      var newStatus = req.body.status.toLowerCase();
      var currentStatus = (old.status || 'draft').toLowerCase();
      if (newStatus !== currentStatus) {
        var allowed_transitions = CO_TRANSITIONS[currentStatus] || [];
        if (!allowed_transitions.includes(newStatus)) {
          return res.status(400).json({ error: 'Invalid status transition: ' + currentStatus + ' → ' + newStatus + '. Allowed: ' + allowed_transitions.join(', ') });
        }
        /* void requires admin */
        if (newStatus === 'void' && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Only admins can void change orders' });
        }
      }
    }

    var allowed = ['title', 'description', 'type', 'status', 'change_event_id', 'contract_id',
      'request_received_from', 'schedule_impact_days', 'field_change', 'paid_in_full',
      'reviewer_id', 'reviewed_at', 'reviewer_response', 'reviewer_notes'];
    var updates = { updated_at: new Date() };
    for (var i = 0; i < allowed.length; i++) {
      var f = allowed[i];
      if (req.body[f] !== undefined) {
        if (f === 'status') {
          var st = (req.body[f] || 'draft').toLowerCase();
          updates[f] = CO_STATUSES.includes(st) ? st : old.status;
        } else if (f === 'type') {
          var tp = (req.body[f] || 'prime_contract').toLowerCase();
          updates[f] = CO_TYPES.includes(tp) ? tp : old.type;
        } else if (['field_change', 'paid_in_full'].includes(f)) {
          updates[f] = !!req.body[f];
        } else {
          updates[f] = req.body[f] === '' ? null : req.body[f];
        }
      }
    }

    /* if modifying an approved CO, auto-increment revision_number */
    if ((old.status || '').toLowerCase() === 'approved' && (updates.status || '').toLowerCase() !== 'void') {
      var hasContentChange = Object.keys(updates).some(function(k) { return k !== 'updated_at' && k !== 'status'; });
      if (hasContentChange) {
        updates.revision_number = (Number(old.revision_number) || 0) + 1;
      }
    }

    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.coId);
    var result = await db.query('UPDATE change_orders SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);

    /* replace SOV line items if provided */
    if (Array.isArray(req.body.sov_line_items)) {
      await db.query('DELETE FROM change_order_sov_lines WHERE change_order_id = $1', [req.params.coId]);
      for (var j = 0; j < req.body.sov_line_items.length; j++) {
        var sov = req.body.sov_line_items[j];
        await db.query(
          'INSERT INTO change_order_sov_lines (change_order_id, prime_contract_line, change_event_line_id, budget_code_id, description, amount, tax_code) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [req.params.coId, sov.prime_contract_line || null, sov.change_event_line_id || null, sov.budget_code_id || null, sov.description || null, sov.amount || null, sov.tax_code || null]
        );
      }
    }

    await logChange({ tableName: 'change_orders', recordId: req.params.coId, operation: 'UPDATE',
      newValue: JSON.stringify({ status: result.rows[0].status }), userId: req.user.id });
    if (updates.status && updates.status !== old.status) {
      await onStatusChange('change_order', Number(req.params.coId), updates.status, req.projectId, req.user.id);
    }
    var enriched = await enrichCO(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/change-orders/:coId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM change_orders WHERE id = $1', [req.params.coId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Change order not found' });
    await logChange({ tableName: 'change_orders', recordId: req.params.coId, operation: 'DELETE',
      oldValue: JSON.stringify({ title: existing.rows[0].title }), userId: req.user.id });
    /* cascade deletes sov lines */
    await db.query('DELETE FROM change_orders WHERE id = $1', [req.params.coId]);
    res.json({ message: 'Change order deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   CONTRACTS (project-scoped)
   ══════════════════════════════════════════════════════ */

router.get('/contracts', authenticate, validateProject, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM contracts WHERE project_id = $1 ORDER BY type, number', [req.projectId]);
    /* compute approved_changes per contract from approved COs */
    var coSums = await db.query(
      `SELECT co.contract_id, SUM(sol.amount) AS total
       FROM change_orders co JOIN change_order_sov_lines sol ON sol.change_order_id = co.id
       WHERE co.project_id = $1 AND co.status = 'approved' AND co.contract_id IS NOT NULL
       GROUP BY co.contract_id`, [req.projectId]);
    var coMap = {};
    coSums.rows.forEach(function(r) { coMap[r.contract_id] = Number(r.total) || 0; });
    result.rows.forEach(function(r) { r._approved_co_sum = coMap[r.id] || 0; });
    var enriched = await enrichContracts(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/contracts/:ctId', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM contracts WHERE id = $1', [req.params.ctId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Contract not found' });
    /* compute approved_changes from approved COs */
    var coSum = await db.query(
      `SELECT COALESCE(SUM(sol.amount), 0) AS total
       FROM change_orders co JOIN change_order_sov_lines sol ON sol.change_order_id = co.id
       WHERE co.contract_id = $1 AND co.status = 'approved'`, [req.params.ctId]);
    result.rows[0]._approved_co_sum = Number(coSum.rows[0].total) || 0;
    var enriched = await enrichContract(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/contracts', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (!b.title) return res.status(400).json({ error: 'title required' });
    var ct = (b.type || 'prime_contract').toLowerCase();
    if (!CONTRACT_TYPES.includes(ct)) return res.status(400).json({ error: 'Invalid type. Allowed: ' + CONTRACT_TYPES.join(', ') });
    var st = (b.status || 'draft').toLowerCase();
    if (!CONTRACT_STATUSES.includes(st)) return res.status(400).json({ error: 'Invalid status. Allowed: ' + CONTRACT_STATUSES.join(', ') });
    var am = (b.accounting_method || 'amount_based').toLowerCase();
    if (!ACCT_METHODS.includes(am)) am = 'amount_based';
    /* auto-increment number within project */
    var numResult = await db.query('SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) + 1 AS next_num FROM contracts WHERE project_id = $1 AND number ~ $2', [req.projectId, '^[0-9]+$']);
    var nextNum = b.number || String(numResult.rows[0].next_num);
    var result = await db.query(
      `INSERT INTO contracts (
        project_id, type, title, number, contractor_company, contractor_contact_id, status,
        executed_date, start_date, completion_date,
        original_contract_amount, retainage_percent, accounting_method, payment_terms,
        signed_by, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        req.projectId, ct, b.title, nextNum,
        b.contractor_company || null, b.contractor_contact_id || null, st,
        b.executed_date || null, b.start_date || null, b.completion_date || null,
        Number(b.original_contract_amount) || 0, b.retainage_percent != null ? b.retainage_percent : 10.00,
        am, b.payment_terms || null,
        b.signed_by || null, req.user.id
      ]
    );
    var contractId = result.rows[0].id;
    /* insert SOV lines */
    var sovLines = b.sov_lines || [];
    for (var i = 0; i < sovLines.length; i++) {
      var sl = sovLines[i];
      await db.query(
        `INSERT INTO contract_sov_lines (contract_id, line_number, description, budget_code_id, scheduled_value, work_completed_previous, work_completed_this_period, stored_materials)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [contractId, sl.line_number || (i + 1), sl.description || null, sl.budget_code_id || null,
         Number(sl.scheduled_value) || 0, Number(sl.work_completed_previous) || 0,
         Number(sl.work_completed_this_period) || 0, Number(sl.stored_materials) || 0]
      );
    }
    await logChange({ tableName: 'contracts', recordId: contractId, operation: 'CREATE',
      newValue: JSON.stringify({ title: b.title }), userId: req.user.id });
    var enriched = await enrichContract(result.rows[0]);
    res.status(201).json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/contracts/:ctId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM contracts WHERE id = $1', [req.params.ctId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Contract not found' });
    var old = existing.rows[0];
    var b = req.body;
    /* status machine validation */
    if (b.status !== undefined && b.status !== old.status) {
      var newSt = b.status.toLowerCase();
      if (!CONTRACT_STATUSES.includes(newSt)) return res.status(400).json({ error: 'Invalid status' });
      var allowed = CONTRACT_TRANSITIONS[old.status] || [];
      if (!allowed.includes(newSt)) return res.status(400).json({ error: 'Cannot transition from ' + old.status + ' to ' + newSt + '. Allowed: ' + allowed.join(', ') });
    }
    var fields = ['type', 'title', 'number', 'contractor_company', 'contractor_contact_id', 'status',
      'executed_date', 'start_date', 'completion_date',
      'original_contract_amount', 'retainage_percent', 'accounting_method', 'payment_terms', 'signed_by'];
    var updates = { updated_at: new Date() };
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (b[f] !== undefined) {
        updates[f] = b[f] === '' ? null : b[f];
      }
    }
    /* validate type if changing */
    if (updates.type && !CONTRACT_TYPES.includes(updates.type)) return res.status(400).json({ error: 'Invalid type' });
    if (updates.accounting_method && !ACCT_METHODS.includes(updates.accounting_method)) return res.status(400).json({ error: 'Invalid accounting_method' });
    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.ctId);
    var result = await db.query('UPDATE contracts SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    /* replace SOV lines if provided */
    if (b.sov_lines !== undefined) {
      await db.query('DELETE FROM contract_sov_lines WHERE contract_id = $1', [req.params.ctId]);
      var sovLines = b.sov_lines || [];
      for (var j = 0; j < sovLines.length; j++) {
        var sl = sovLines[j];
        await db.query(
          `INSERT INTO contract_sov_lines (contract_id, line_number, description, budget_code_id, scheduled_value, work_completed_previous, work_completed_this_period, stored_materials)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.params.ctId, sl.line_number || (j + 1), sl.description || null, sl.budget_code_id || null,
           Number(sl.scheduled_value) || 0, Number(sl.work_completed_previous) || 0,
           Number(sl.work_completed_this_period) || 0, Number(sl.stored_materials) || 0]
        );
      }
    }
    await logChange({ tableName: 'contracts', recordId: req.params.ctId, operation: 'UPDATE',
      newValue: JSON.stringify({ status: result.rows[0].status }), userId: req.user.id });
    /* compute approved_changes from approved COs */
    var coSum = await db.query(
      `SELECT COALESCE(SUM(sol.amount), 0) AS total
       FROM change_orders co JOIN change_order_sov_lines sol ON sol.change_order_id = co.id
       WHERE co.contract_id = $1 AND co.status = 'approved'`, [req.params.ctId]);
    result.rows[0]._approved_co_sum = Number(coSum.rows[0].total) || 0;
    var enriched = await enrichContract(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/contracts/:ctId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM contracts WHERE id = $1', [req.params.ctId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Contract not found' });
    await logChange({ tableName: 'contracts', recordId: req.params.ctId, operation: 'DELETE',
      oldValue: JSON.stringify({ title: existing.rows[0].title }), userId: req.user.id });
    /* cascade deletes sov lines */
    await db.query('DELETE FROM contracts WHERE id = $1', [req.params.ctId]);
    res.json({ message: 'Contract deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   INVOICES (project-scoped)
   ══════════════════════════════════════════════════════ */

router.get('/invoices', authenticate, validateProject, async function (req, res) {
  try {
    var q = 'SELECT i.*, c.retainage_percent AS _retainage_percent FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id WHERE i.project_id = $1';
    var params = [req.projectId];
    if (req.query.contract_id) { q += ' AND i.contract_id = $2'; params.push(req.query.contract_id); }
    q += ' ORDER BY i.billing_date DESC NULLS LAST, i.created_at DESC';
    var result = await db.query(q, params);
    var enriched = await enrichInvoices(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/invoices/:invId', authenticate, async function (req, res) {
  try {
    var result = await db.query(
      'SELECT i.*, c.retainage_percent AS _retainage_percent FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id WHERE i.id = $1',
      [req.params.invId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Invoice not found' });
    var enriched = await enrichInvoice(result.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/invoices', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (b.type && !INV_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type. Allowed: ' + INV_TYPES.join(', ') });
    var st = (b.status || 'draft').toLowerCase();
    if (!INV_STATUSES.includes(st)) return res.status(400).json({ error: 'Invalid status. Allowed: ' + INV_STATUSES.join(', ') });
    var result = await db.query(
      `INSERT INTO invoices (
        project_id, contract_id, invoice_number, type, status,
        period_start, period_end, billing_date, due_date,
        submitted_by_id, submitted_at, retainage_released,
        paid_date, payment_reference, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        req.projectId, b.contract_id || null, b.invoice_number || null,
        b.type || null, st,
        b.period_start || null, b.period_end || null, b.billing_date || null, b.due_date || null,
        b.submitted_by_id || null, b.submitted_at || null,
        Number(b.retainage_released) || 0,
        b.paid_date || null, b.payment_reference || null, req.user.id
      ]
    );
    var invoiceId = result.rows[0].id;
    /* insert SOV lines */
    var sovLines = b.sov_lines || [];
    for (var i = 0; i < sovLines.length; i++) {
      var sl = sovLines[i];
      await db.query(
        'INSERT INTO invoice_sov_lines (invoice_id, contract_sov_line_id, work_completed_this_period, stored_materials) VALUES ($1,$2,$3,$4)',
        [invoiceId, sl.contract_sov_line_id || null, Number(sl.work_completed_this_period) || 0, Number(sl.stored_materials) || 0]
      );
    }
    /* insert approval steps */
    var steps = b.approval_steps || [];
    for (var j = 0; j < steps.length; j++) {
      var as = steps[j];
      await db.query(
        'INSERT INTO invoice_approval_steps (invoice_id, reviewer_id, step_order, status, notes) VALUES ($1,$2,$3,$4,$5)',
        [invoiceId, as.reviewer_id || null, as.step_order || (j + 1), (as.status || 'pending').toLowerCase(), as.notes || null]
      );
    }
    await logChange({ tableName: 'invoices', recordId: invoiceId, operation: 'CREATE',
      newValue: JSON.stringify({ invoice_number: b.invoice_number }), userId: req.user.id });
    /* re-fetch enriched */
    var fetched = await db.query(
      'SELECT i.*, c.retainage_percent AS _retainage_percent FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id WHERE i.id = $1', [invoiceId]);
    var enriched = await enrichInvoice(fetched.rows[0]);
    res.status(201).json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/invoices/:invId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.invId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Invoice not found' });
    var old = existing.rows[0];
    var b = req.body;
    /* status machine validation */
    if (b.status !== undefined && b.status !== old.status) {
      var newSt = b.status.toLowerCase();
      if (!INV_STATUSES.includes(newSt)) return res.status(400).json({ error: 'Invalid status' });
      var allowed = INV_TRANSITIONS[old.status] || [];
      if (!allowed.includes(newSt)) return res.status(400).json({ error: 'Cannot transition from ' + old.status + ' to ' + newSt + '. Allowed: ' + allowed.join(', ') });
    }
    var fields = ['contract_id', 'invoice_number', 'type', 'status',
      'period_start', 'period_end', 'billing_date', 'due_date',
      'submitted_by_id', 'submitted_at', 'retainage_released',
      'paid_date', 'payment_reference'];
    var updates = { updated_at: new Date() };
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (b[f] !== undefined) {
        updates[f] = b[f] === '' ? null : b[f];
      }
    }
    if (updates.type && !INV_TYPES.includes(updates.type)) return res.status(400).json({ error: 'Invalid type' });
    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.invId);
    var result = await db.query('UPDATE invoices SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    /* replace SOV lines if provided */
    if (b.sov_lines !== undefined) {
      await db.query('DELETE FROM invoice_sov_lines WHERE invoice_id = $1', [req.params.invId]);
      var sovLines = b.sov_lines || [];
      for (var j = 0; j < sovLines.length; j++) {
        var sl = sovLines[j];
        await db.query(
          'INSERT INTO invoice_sov_lines (invoice_id, contract_sov_line_id, work_completed_this_period, stored_materials) VALUES ($1,$2,$3,$4)',
          [req.params.invId, sl.contract_sov_line_id || null, Number(sl.work_completed_this_period) || 0, Number(sl.stored_materials) || 0]
        );
      }
    }
    /* replace approval steps if provided */
    if (b.approval_steps !== undefined) {
      await db.query('DELETE FROM invoice_approval_steps WHERE invoice_id = $1', [req.params.invId]);
      var steps = b.approval_steps || [];
      for (var k = 0; k < steps.length; k++) {
        var as = steps[k];
        await db.query(
          'INSERT INTO invoice_approval_steps (invoice_id, reviewer_id, step_order, status, notes, reviewed_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.invId, as.reviewer_id || null, as.step_order || (k + 1),
           (as.status || 'pending').toLowerCase(), as.notes || null, as.reviewed_at || null]
        );
      }
    }
    await logChange({ tableName: 'invoices', recordId: req.params.invId, operation: 'UPDATE',
      newValue: JSON.stringify({ status: result.rows[0].status }), userId: req.user.id });
    /* re-fetch enriched */
    var fetched = await db.query(
      'SELECT i.*, c.retainage_percent AS _retainage_percent FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id WHERE i.id = $1', [req.params.invId]);
    var enriched = await enrichInvoice(fetched.rows[0]);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/invoices/:invId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.invId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Invoice not found' });
    await logChange({ tableName: 'invoices', recordId: req.params.invId, operation: 'DELETE',
      oldValue: JSON.stringify({ invoice_number: existing.rows[0].invoice_number }), userId: req.user.id });
    /* cascade deletes sov_lines and approval_steps */
    await db.query('DELETE FROM invoices WHERE id = $1', [req.params.invId]);
    res.json({ message: 'Invoice deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════
   DIRECT COSTS (project-scoped)
   ══════════════════════════════════════════════════════ */

router.get('/direct-costs', authenticate, validateProject, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM direct_costs WHERE project_id = $1 ORDER BY invoice_date DESC NULLS LAST, created_at DESC', [req.projectId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/direct-costs/:dcId', authenticate, async function (req, res) {
  try {
    var result = await db.query('SELECT * FROM direct_costs WHERE id = $1', [req.params.dcId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Direct cost not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/direct-costs', authenticate, requireRole('admin', 'editor'), validateProject, async function (req, res) {
  try {
    var b = req.body;
    if (!b.description) return res.status(400).json({ error: 'description required' });
    var totalAmount = 0;
    if (Array.isArray(b.line_items) && b.line_items.length > 0) {
      totalAmount = b.line_items.reduce(function (s, li) { return s + (Number(li.amount) || 0); }, 0);
    }
    var ct = (b.cost_type || 'other').toLowerCase();
    if (!COST_TYPES.includes(ct)) ct = 'other';
    var result = await db.query(
      `INSERT INTO direct_costs (
        project_id, description, vendor, invoice_number, invoice_date,
        payment_date, payment_method, cost_type, line_items, total_amount, attachments, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.projectId, b.description, b.vendor || null, b.invoice_number || null, b.invoice_date || null,
        b.payment_date || null, b.payment_method || null, ct,
        JSON.stringify(b.line_items || []), totalAmount,
        JSON.stringify(b.attachments || []), req.user.id
      ]
    );
    await logChange({ tableName: 'direct_costs', recordId: result.rows[0].id, operation: 'CREATE',
      newValue: JSON.stringify({ description: b.description, total: totalAmount }), userId: req.user.id });
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/direct-costs/:dcId', authenticate, requireRole('admin', 'editor'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM direct_costs WHERE id = $1', [req.params.dcId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Direct cost not found' });
    var allowed = ['description', 'vendor', 'invoice_number', 'invoice_date',
      'payment_date', 'payment_method', 'cost_type', 'line_items', 'attachments'];
    var updates = { updated_at: new Date() };
    for (var i = 0; i < allowed.length; i++) {
      var f = allowed[i];
      if (req.body[f] !== undefined) {
        if (['line_items', 'attachments'].includes(f)) { updates[f] = JSON.stringify(req.body[f]); }
        else if (f === 'cost_type') { var ct = (req.body[f] || 'other').toLowerCase(); updates[f] = COST_TYPES.includes(ct) ? ct : 'other'; }
        else { updates[f] = req.body[f] === '' ? null : req.body[f]; }
      }
    }
    if (req.body.line_items && Array.isArray(req.body.line_items)) {
      updates.total_amount = req.body.line_items.reduce(function (s, li) { return s + (Number(li.amount) || 0); }, 0);
    }
    var keys = Object.keys(updates);
    var setClause = keys.map(function (k, idx) { return k + ' = $' + (idx + 1); }).join(', ');
    var values = keys.map(function (k) { return updates[k]; });
    values.push(req.params.dcId);
    var result = await db.query('UPDATE direct_costs SET ' + setClause + ' WHERE id = $' + values.length + ' RETURNING *', values);
    await logChange({ tableName: 'direct_costs', recordId: req.params.dcId, operation: 'UPDATE',
      newValue: JSON.stringify({ description: result.rows[0].description }), userId: req.user.id });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/direct-costs/:dcId', authenticate, requireRole('admin'), async function (req, res) {
  try {
    var existing = await db.query('SELECT * FROM direct_costs WHERE id = $1', [req.params.dcId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Direct cost not found' });
    await logChange({ tableName: 'direct_costs', recordId: req.params.dcId, operation: 'DELETE',
      oldValue: JSON.stringify({ description: existing.rows[0].description }), userId: req.user.id });
    await db.query('DELETE FROM direct_costs WHERE id = $1', [req.params.dcId]);
    res.json({ message: 'Direct cost deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
