const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { logChange } = require('../db/changelog');
const { authenticate, requireRole } = require('../middleware/auth');

/* ── constants ── */
var TS_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
var TS_COST_TYPES = ['labor', 'material', 'equipment', 'subcontractor', 'other'];
var TS_TRANSITIONS = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: [],
  rejected: ['draft']
};

/* ── schema migration ── */
const tablesReady = (async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS timesheets (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      employee_id INTEGER REFERENCES users(id),
      date DATE NOT NULL,
      time_in TIME,
      time_out TIME,
      hours DECIMAL(5,2) NOT NULL DEFAULT 0,
      cost_code_id INTEGER,
      cost_type VARCHAR(30) DEFAULT 'labor',
      location VARCHAR(255),
      description TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      approved_by INTEGER REFERENCES users(id),
      approved_at TIMESTAMP,
      rejection_reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Migration: timesheets table ready');
  } catch (err) {
    console.error('timesheets migration error:', err.message);
  }
})();

/* ── legacy data migration ── */
(async function migrateLegacy() {
  await tablesReady; // run only after this module's CREATE TABLEs finish (fresh-DB race)
  try {
    /* add new columns if missing */
    await db.query(`ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS cost_code_id INTEGER`);
    await db.query(`ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);

    /* migrate cost_code string → cost_code_id FK */
    var { rows: hasCostCode } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'timesheets' AND column_name = 'cost_code'`);
    if (hasCostCode.length) {
      var { rows: old } = await db.query(`SELECT id, cost_code FROM timesheets WHERE cost_code IS NOT NULL AND cost_code != '' AND cost_code_id IS NULL`);
      for (var i = 0; i < old.length; i++) {
        var code = old[i].cost_code;
        var { rows: cc } = await db.query(`SELECT id FROM cost_codes_master WHERE code = $1`, [code]);
        if (cc.length) {
          await db.query(`UPDATE timesheets SET cost_code_id = $1 WHERE id = $2`, [cc[0].id, old[i].id]);
        }
      }
      if (old.length) console.log('Legacy timesheets cost_code → cost_code_id migrated:', old.length);
    }

    /* migrate uppercase statuses → lowercase */
    for (var s = 0; s < TS_STATUSES.length; s++) {
      var lower = TS_STATUSES[s];
      var upper = lower.charAt(0).toUpperCase() + lower.slice(1);
      await db.query(`UPDATE timesheets SET status = $1 WHERE status = $2`, [lower, upper]);
    }

    /* migrate uppercase cost_type → lowercase */
    for (var c = 0; c < TS_COST_TYPES.length; c++) {
      var lc = TS_COST_TYPES[c];
      var uc = lc.charAt(0).toUpperCase() + lc.slice(1);
      await db.query(`UPDATE timesheets SET cost_type = $1 WHERE cost_type = $2`, [lc, uc]);
    }

    console.log('Legacy timesheets migration complete');
  } catch (err) {
    console.error('timesheets legacy migration error:', err.message);
  }
})();

/* ── helpers ── */
function validateProject(req, res, next) {
  var pid = parseInt(req.params.id, 10);
  if (!pid) return res.status(400).json({ error: 'Invalid project id' });
  req.projectId = pid;
  next();
}

function calcHours(time_in, time_out) {
  if (!time_in || !time_out) return null;
  var parts1 = time_in.split(':').map(Number);
  var parts2 = time_out.split(':').map(Number);
  var h = ((parts2[0] * 60 + (parts2[1] || 0)) - (parts1[0] * 60 + (parts1[1] || 0))) / 60;
  if (h < 0) h += 24;
  return Math.round(h * 100) / 100;
}

async function enrichEntry(row) {
  if (!row) return row;
  /* attach employee name */
  if (row.employee_id) {
    var { rows: eu } = await db.query('SELECT name, email FROM users WHERE id = $1', [row.employee_id]);
    row.employee_name = eu.length ? (eu[0].name || eu[0].email) : null;
  }
  /* attach approver name */
  if (row.approved_by) {
    var { rows: au } = await db.query('SELECT name, email FROM users WHERE id = $1', [row.approved_by]);
    row.approver_name = au.length ? (au[0].name || au[0].email) : null;
  }
  /* attach cost code info */
  if (row.cost_code_id) {
    var { rows: cc } = await db.query('SELECT code, name FROM cost_codes_master WHERE id = $1', [row.cost_code_id]);
    if (cc.length) {
      row.cost_code = cc[0].code;
      row.cost_code_name = cc[0].name;
    }
  }
  return row;
}

async function enrichEntries(rows) {
  if (!rows.length) return rows;
  /* batch load users */
  var empIds = rows.map(function(r) { return r.employee_id; }).filter(Boolean);
  var appIds = rows.map(function(r) { return r.approved_by; }).filter(Boolean);
  var ccIds = rows.map(function(r) { return r.cost_code_id; }).filter(Boolean);
  var allUserIds = [...new Set([...empIds, ...appIds])];

  var userMap = {};
  if (allUserIds.length) {
    var { rows: uu } = await db.query('SELECT id, name, email FROM users WHERE id = ANY($1)', [allUserIds]);
    uu.forEach(function(u) { userMap[u.id] = u.name || u.email; });
  }

  var ccMap = {};
  if (ccIds.length) {
    var { rows: ccs } = await db.query('SELECT id, code, name FROM cost_codes_master WHERE id = ANY($1)', [[...new Set(ccIds)]]);
    ccs.forEach(function(c) { ccMap[c.id] = c; });
  }

  return rows.map(function(r) {
    r.employee_name = userMap[r.employee_id] || null;
    r.approver_name = userMap[r.approved_by] || null;
    if (r.cost_code_id && ccMap[r.cost_code_id]) {
      r.cost_code = ccMap[r.cost_code_id].code;
      r.cost_code_name = ccMap[r.cost_code_id].name;
    }
    return r;
  });
}

async function updateBudgetActual(projectId, costCodeId, costType, hoursDelta) {
  if (!costCodeId || !hoursDelta) return;
  /* attempt to find hourly_rate from budget_line_items or default to 0 */
  try {
    await db.query(
      `UPDATE budget_line_items SET actual_cost = actual_cost + $1, updated_at = NOW()
       WHERE project_id = $2 AND cost_code_id = $3 AND cost_type = $4`,
      [hoursDelta, projectId, costCodeId, costType || 'labor']
    );
  } catch (err) {
    console.error('budget actual_cost update error:', err.message);
  }
}

/* ── GET all for project ── */
router.get('/', authenticate, validateProject, async function(req, res) {
  try {
    var sql = `SELECT * FROM timesheets WHERE project_id = $1`;
    var params = [req.projectId];
    var idx = 2;
    if (req.query.employee_id) { sql += ' AND employee_id = $' + idx; params.push(req.query.employee_id); idx++; }
    if (req.query.status) { sql += ' AND status = $' + idx; params.push(req.query.status); idx++; }
    if (req.query.date_from) { sql += ' AND date >= $' + idx; params.push(req.query.date_from); idx++; }
    if (req.query.date_to) { sql += ' AND date <= $' + idx; params.push(req.query.date_to); idx++; }
    if (req.query.cost_type) { sql += ' AND cost_type = $' + idx; params.push(req.query.cost_type); idx++; }
    sql += ' ORDER BY date DESC, time_in ASC';
    var { rows } = await db.query(sql, params);
    var enriched = await enrichEntries(rows);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET single ── */
router.get('/:tsId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows } = await db.query('SELECT * FROM timesheets WHERE id = $1 AND project_id = $2', [req.params.tsId, req.projectId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    var enriched = await enrichEntry(rows[0]);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST create ── */
router.post('/', authenticate, validateProject, async function(req, res) {
  try {
    var b = req.body;
    if (!b.date) return res.status(400).json({ error: 'date is required' });

    var status = (b.status || 'draft').toLowerCase();
    if (TS_STATUSES.indexOf(status) === -1) return res.status(400).json({ error: 'Invalid status: ' + status });

    var costType = (b.cost_type || 'labor').toLowerCase();
    if (TS_COST_TYPES.indexOf(costType) === -1) return res.status(400).json({ error: 'Invalid cost_type: ' + costType });

    /* auto-calc hours if time_in/time_out provided and hours not given */
    var hours = b.hours != null ? Number(b.hours) : calcHours(b.time_in, b.time_out);
    if (hours == null) hours = 0;

    var { rows } = await db.query(
      `INSERT INTO timesheets (project_id, employee_id, date, time_in, time_out, hours,
        cost_code_id, cost_type, location, description, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.projectId,
        b.employee_id || req.user.id,
        b.date,
        b.time_in || null,
        b.time_out || null,
        hours,
        b.cost_code_id || null,
        costType,
        b.location || null,
        b.description || null,
        status,
        req.user.id
      ]
    );
    await logChange('timesheets', rows[0].id, 'INSERT', null, null, JSON.stringify(rows[0]), req.user.id);
    var enriched = await enrichEntry(rows[0]);
    res.status(201).json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT update ── */
router.put('/:tsId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows: existing } = await db.query('SELECT * FROM timesheets WHERE id = $1 AND project_id = $2', [req.params.tsId, req.projectId]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    var old = existing[0];
    var b = req.body;

    /* status machine */
    if (b.status !== undefined) {
      var newStatus = b.status.toLowerCase();
      if (TS_STATUSES.indexOf(newStatus) === -1) return res.status(400).json({ error: 'Invalid status: ' + newStatus });
      var allowed = TS_TRANSITIONS[old.status] || [];
      if (newStatus !== old.status && allowed.indexOf(newStatus) === -1) {
        return res.status(400).json({ error: 'Cannot transition from ' + old.status + ' to ' + newStatus + '. Allowed: ' + allowed.join(', ') });
      }
      b.status = newStatus;
    }

    /* cost_type lowercase validation */
    if (b.cost_type !== undefined) {
      b.cost_type = b.cost_type.toLowerCase();
      if (TS_COST_TYPES.indexOf(b.cost_type) === -1) return res.status(400).json({ error: 'Invalid cost_type: ' + b.cost_type });
    }

    var fields = ['employee_id', 'date', 'time_in', 'time_out', 'hours', 'cost_code_id', 'cost_type', 'location', 'description', 'status', 'rejection_reason'];
    var sets = [];
    var vals = [];
    var idx = 1;

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (b[f] !== undefined) {
        sets.push(f + ' = $' + idx);
        vals.push(b[f]);
        idx++;
      }
    }

    /* auto-calc hours if time changed */
    var timeIn = b.time_in !== undefined ? b.time_in : old.time_in;
    var timeOut = b.time_out !== undefined ? b.time_out : old.time_out;
    if ((b.time_in !== undefined || b.time_out !== undefined) && b.hours === undefined) {
      var autoHours = calcHours(timeIn, timeOut);
      if (autoHours != null) {
        sets.push('hours = $' + idx);
        vals.push(autoHours);
        idx++;
      }
    }

    /* approval tracking */
    if (b.status === 'approved' || b.status === 'rejected') {
      sets.push('approved_by = $' + idx);
      vals.push(req.user.id);
      idx++;
      sets.push('approved_at = NOW()');
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = NOW()');
    vals.push(req.params.tsId);

    var { rows } = await db.query(
      'UPDATE timesheets SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' AND project_id = $' + (idx + 1) + ' RETURNING *',
      [...vals, req.projectId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    /* update budget actual_cost when entry is approved */
    if (b.status === 'approved' && old.status !== 'approved' && rows[0].cost_code_id) {
      await updateBudgetActual(req.projectId, rows[0].cost_code_id, rows[0].cost_type, Number(rows[0].hours));
    }

    await logChange('timesheets', rows[0].id, 'UPDATE', null, null, JSON.stringify(b), req.user.id);
    var enriched = await enrichEntry(rows[0]);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── DELETE ── */
router.delete('/:tsId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows } = await db.query('DELETE FROM timesheets WHERE id = $1 AND project_id = $2 RETURNING *', [req.params.tsId, req.projectId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logChange('timesheets', rows[0].id, 'DELETE', JSON.stringify(rows[0]), null, null, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Summary: hours by employee for date range ── */
router.get('/summary/by-employee', authenticate, validateProject, async function(req, res) {
  try {
    var sql = `SELECT employee_id, SUM(hours) as total_hours, COUNT(*) as entry_count,
      SUM(CASE WHEN status = 'approved' THEN hours ELSE 0 END) as approved_hours
      FROM timesheets WHERE project_id = $1`;
    var params = [req.projectId];
    var idx = 2;
    if (req.query.date_from) { sql += ' AND date >= $' + idx; params.push(req.query.date_from); idx++; }
    if (req.query.date_to) { sql += ' AND date <= $' + idx; params.push(req.query.date_to); idx++; }
    sql += ' GROUP BY employee_id ORDER BY total_hours DESC';
    var { rows } = await db.query(sql, params);

    /* enrich with names */
    var empIds = rows.map(function(r) { return r.employee_id; }).filter(Boolean);
    var userMap = {};
    if (empIds.length) {
      var { rows: uu } = await db.query('SELECT id, name, email FROM users WHERE id = ANY($1)', [empIds]);
      uu.forEach(function(u) { userMap[u.id] = u.name || u.email; });
    }
    rows.forEach(function(r) { r.employee_name = userMap[r.employee_id] || null; });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Bulk submit: draft → submitted for multiple entries ── */
router.put('/bulk/submit', authenticate, validateProject, async function(req, res) {
  try {
    var ids = req.body.ids;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    var { rows } = await db.query(
      `UPDATE timesheets SET status = 'submitted', updated_at = NOW()
       WHERE id = ANY($1) AND project_id = $2 AND status = 'draft' RETURNING *`,
      [ids, req.projectId]
    );
    res.json({ updated: rows.length, entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Bulk approve ── */
router.put('/bulk/approve', authenticate, requireRole('admin', 'editor'), validateProject, async function(req, res) {
  try {
    var ids = req.body.ids;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    var { rows } = await db.query(
      `UPDATE timesheets SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = ANY($2) AND project_id = $3 AND status = 'submitted' RETURNING *`,
      [req.user.id, ids, req.projectId]
    );

    /* update budget actual_cost for each approved entry */
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].cost_code_id) {
        await updateBudgetActual(req.projectId, rows[i].cost_code_id, rows[i].cost_type, Number(rows[i].hours));
      }
    }

    res.json({ updated: rows.length, entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
