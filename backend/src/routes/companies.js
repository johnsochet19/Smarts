const router = require('express').Router({ mergeParams: true });
const db = require('../db');

// ── Constants ──────────────────────────────────────────────────────────
const COMPANY_TYPES = ['subcontractor', 'vendor', 'consultant', 'owner', 'gc', 'other'];
const COMPANY_TYPE_LABELS = {
  subcontractor: 'Subcontractor', vendor: 'Vendor', consultant: 'Consultant',
  owner: 'Owner', gc: 'General Contractor', other: 'Other'
};
const PC_STATUSES = ['invited', 'active', 'completed', 'terminated'];
const PC_STATUS_LABELS = {
  invited: 'Invited', active: 'Active', completed: 'Completed', terminated: 'Terminated'
};
const PC_TRANSITIONS = {
  invited:    ['active', 'terminated'],
  active:     ['completed', 'terminated'],
  completed:  [],
  terminated: ['invited']
};

// ── Schema migration (IIFE) ───────────────────────────────────────────
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'subcontractor',
      license_number VARCHAR(100),
      license_expiry DATE,
      insurance_expiry DATE,
      prequalified BOOLEAN DEFAULT false,
      prequalification_date DATE,
      trades JSONB DEFAULT '[]'::jsonb,
      address VARCHAR(255),
      city VARCHAR(100),
      state VARCHAR(50),
      zip VARCHAR(20),
      phone VARCHAR(50),
      email VARCHAR(255),
      website VARCHAR(255),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Add columns that may be missing
    const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='companies'`)).rows.map(r => r.column_name);
    const add = async (col, def) => { if (!cols.includes(col)) await db.query(`ALTER TABLE companies ADD COLUMN ${col} ${def}`); };
    await add('license_number', "VARCHAR(100)");
    await add('license_expiry', "DATE");
    await add('insurance_expiry', "DATE");
    await add('prequalified', "BOOLEAN DEFAULT false");
    await add('prequalification_date', "DATE");
    await add('trades', "JSONB DEFAULT '[]'::jsonb");
    await add('address', "VARCHAR(255)");
    await add('city', "VARCHAR(100)");
    await add('state', "VARCHAR(50)");
    await add('zip', "VARCHAR(20)");
    await add('website', "VARCHAR(255)");

    await db.query(`CREATE TABLE IF NOT EXISTS project_contractors (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      role VARCHAR(100),
      contract_id INTEGER,
      status VARCHAR(30) NOT NULL DEFAULT 'invited',
      start_date DATE,
      end_date DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, company_id)
    )`);

    // Add contract_id FK if missing
    const pcCols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='project_contractors'`)).rows.map(r => r.column_name);
    if (!pcCols.includes('contract_id')) await db.query(`ALTER TABLE project_contractors ADD COLUMN contract_id INTEGER`);
    if (!pcCols.includes('role')) await db.query(`ALTER TABLE project_contractors ADD COLUMN role VARCHAR(100)`);
    if (!pcCols.includes('start_date')) await db.query(`ALTER TABLE project_contractors ADD COLUMN start_date DATE`);
    if (!pcCols.includes('end_date')) await db.query(`ALTER TABLE project_contractors ADD COLUMN end_date DATE`);

    // Legacy: lowercase types
    for (const t of COMPANY_TYPES) {
      const upper = t.charAt(0).toUpperCase() + t.slice(1);
      await db.query(`UPDATE companies SET type = $1 WHERE type = $2`, [t, upper]);
    }
    await db.query(`UPDATE companies SET type = 'gc' WHERE LOWER(type) IN ('general contractor', 'general_contractor')`);
    await db.query(`UPDATE project_contractors SET status = LOWER(status) WHERE status != LOWER(status)`);

    console.log('[companies] tables ready');
  } catch (err) {
    console.error('[companies] migration error:', err.message);
  }
})();

// ── Middleware: validate project ───────────────────────────────────────
async function validateProject(req, res, next) {
  const pid = req.params.id;
  if (!pid) return next();
  const { rows } = await db.query('SELECT id FROM projects WHERE id=$1', [pid]);
  if (!rows.length) return res.status(404).json({ error: 'Project not found' });
  req.projectId = Number(pid);
  next();
}

// ── Enrichment ────────────────────────────────────────────────────────
function enrichCompanies(rows) {
  const today = new Date(); today.setHours(0,0,0,0);
  return rows.map(c => {
    let license_expired = false, insurance_expired = false;
    let license_days_left = null, insurance_days_left = null;
    if (c.license_expiry) {
      const exp = new Date(c.license_expiry); exp.setHours(0,0,0,0);
      license_days_left = Math.ceil((exp - today) / 86400000);
      license_expired = license_days_left < 0;
    }
    if (c.insurance_expiry) {
      const exp = new Date(c.insurance_expiry); exp.setHours(0,0,0,0);
      insurance_days_left = Math.ceil((exp - today) / 86400000);
      insurance_expired = insurance_days_left < 0;
    }
    return {
      ...c,
      trades: c.trades || [],
      license_expired,
      insurance_expired,
      license_days_left,
      insurance_days_left,
      compliance_ok: !license_expired && !insurance_expired && c.prequalified
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// COMPANY-LEVEL ROUTES (global, not project-scoped)
// ═══════════════════════════════════════════════════════════════════════

// ── GET / — list all companies (optionally filter by type, prequalified) ──
router.get('/', async (req, res) => {
  try {
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;
    if (req.query.type) { where += ` AND c.type=$${idx++}`; params.push(req.query.type); }
    if (req.query.prequalified === 'true') { where += ` AND c.prequalified=true`; }
    if (req.query.search) {
      where += ` AND (c.name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.phone ILIKE $${idx})`;
      params.push('%' + req.query.search + '%'); idx++;
    }
    // If project-scoped, only return companies assigned to this project
    if (req.projectId) {
      where += ` AND c.id IN (SELECT company_id FROM project_contractors WHERE project_id=$${idx++})`;
      params.push(req.projectId);
    }
    const { rows } = await db.query(`SELECT c.* FROM companies c ${where} ORDER BY c.name ASC`, params);
    const enriched = enrichCompanies(rows);

    // If project-scoped, attach project_contractor info
    if (req.projectId && enriched.length) {
      const ids = enriched.map(c => c.id);
      const { rows: pcs } = await db.query(
        `SELECT * FROM project_contractors WHERE project_id=$1 AND company_id = ANY($2)`,
        [req.projectId, ids]
      );
      const pcMap = {};
      pcs.forEach(pc => { pcMap[pc.company_id] = pc; });
      enriched.forEach(c => {
        const pc = pcMap[c.id];
        if (pc) {
          c.project_role = pc.role;
          c.project_status = pc.status;
          c.project_start_date = pc.start_date;
          c.project_end_date = pc.end_date;
          c.project_contract_id = pc.contract_id;
          c.project_contractor_id = pc.id;
        }
      });
    }
    res.json(enriched);
  } catch (err) {
    console.error('[companies] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /constants ────────────────────────────────────────────────────
router.get('/constants', (req, res) => {
  res.json({
    types: COMPANY_TYPES,
    type_labels: COMPANY_TYPE_LABELS,
    pc_statuses: PC_STATUSES,
    pc_status_labels: PC_STATUS_LABELS,
    pc_transitions: PC_TRANSITIONS
  });
});

// ── GET /all — list ALL companies regardless of project (for picker use) ──
router.get('/all', async (req, res) => {
  try {
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;
    if (req.query.type) { where += ` AND c.type=$${idx++}`; params.push(req.query.type); }
    if (req.query.search) {
      where += ` AND (c.name ILIKE $${idx} OR c.email ILIKE $${idx})`;
      params.push('%' + req.query.search + '%'); idx++;
    }
    const { rows } = await db.query(`SELECT c.* FROM companies c ${where} ORDER BY c.name ASC`, params);
    res.json(enrichCompanies(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:companyId ───────────────────────────────────────────────────
router.get('/:companyId', async (req, res) => {
  try {
    if (req.params.companyId === 'constants' || req.params.companyId === 'all' || req.params.companyId === 'summary') return; // skip, handled above
    const { rows } = await db.query('SELECT * FROM companies WHERE id=$1', [req.params.companyId]);
    if (!rows.length) return res.status(404).json({ error: 'Company not found' });
    const enriched = enrichCompanies(rows);
    // Load projects this company is assigned to
    const { rows: pcs } = await db.query(
      `SELECT pc.*, p.name as project_name FROM project_contractors pc
       JOIN projects p ON p.id = pc.project_id
       WHERE pc.company_id=$1 ORDER BY pc.created_at DESC`, [req.params.companyId]
    );
    enriched[0].projects = pcs;
    res.json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create company ───────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name is required' });
    const type = (b.type || 'subcontractor').toLowerCase();
    if (!COMPANY_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type: ' + type });
    const trades = Array.isArray(b.trades) ? JSON.stringify(b.trades) : (b.trades || '[]');
    const { rows } = await db.query(
      `INSERT INTO companies (name, type, license_number, license_expiry, insurance_expiry,
        prequalified, prequalification_date, trades, address, city, state, zip,
        phone, email, website, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [b.name, type, b.license_number || null, b.license_expiry || null,
        b.insurance_expiry || null, b.prequalified || false, b.prequalification_date || null,
        trades, b.address || null, b.city || null, b.state || null, b.zip || null,
        b.phone || null, b.email || null, b.website || null, b.notes || null]
    );

    // If project-scoped, also create project_contractor assignment
    if (req.projectId) {
      const pcStatus = b.project_status || 'invited';
      await db.query(
        `INSERT INTO project_contractors (project_id, company_id, role, status, start_date, end_date, contract_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (project_id, company_id) DO NOTHING`,
        [req.projectId, rows[0].id, b.project_role || null, pcStatus,
          b.project_start_date || null, b.project_end_date || null, b.project_contract_id || null]
      );
    }

    const enriched = enrichCompanies(rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    console.error('[companies] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:companyId — update company ──────────────────────────────────
router.put('/:companyId', async (req, res) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM companies WHERE id=$1', [req.params.companyId]);
    if (!existing.length) return res.status(404).json({ error: 'Company not found' });
    const old = existing[0];
    const b = req.body;
    if (b.type && !COMPANY_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type' });
    const trades = b.trades !== undefined ? (Array.isArray(b.trades) ? JSON.stringify(b.trades) : b.trades) : JSON.stringify(old.trades || []);
    const { rows } = await db.query(
      `UPDATE companies SET name=$1, type=$2, license_number=$3, license_expiry=$4,
        insurance_expiry=$5, prequalified=$6, prequalification_date=$7, trades=$8,
        address=$9, city=$10, state=$11, zip=$12, phone=$13, email=$14, website=$15, notes=$16
      WHERE id=$17 RETURNING *`,
      [
        b.name !== undefined ? b.name : old.name,
        b.type || old.type,
        b.license_number !== undefined ? b.license_number : old.license_number,
        b.license_expiry !== undefined ? b.license_expiry : old.license_expiry,
        b.insurance_expiry !== undefined ? b.insurance_expiry : old.insurance_expiry,
        b.prequalified !== undefined ? b.prequalified : old.prequalified,
        b.prequalification_date !== undefined ? b.prequalification_date : old.prequalification_date,
        trades,
        b.address !== undefined ? b.address : old.address,
        b.city !== undefined ? b.city : old.city,
        b.state !== undefined ? b.state : old.state,
        b.zip !== undefined ? b.zip : old.zip,
        b.phone !== undefined ? b.phone : old.phone,
        b.email !== undefined ? b.email : old.email,
        b.website !== undefined ? b.website : old.website,
        b.notes !== undefined ? b.notes : old.notes,
        req.params.companyId
      ]
    );
    const enriched = enrichCompanies(rows);
    res.json(enriched[0]);
  } catch (err) {
    console.error('[companies] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:companyId ────────────────────────────────────────────────
router.delete('/:companyId', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM companies WHERE id=$1', [req.params.companyId]);
    if (!rowCount) return res.status(404).json({ error: 'Company not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PROJECT-CONTRACTOR ASSIGNMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ── POST /assign — assign existing company to project ─────────────────
router.post('/assign', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.body.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const b = req.body;
    if (!b.company_id) return res.status(400).json({ error: 'company_id required' });
    const status = (b.status || 'invited').toLowerCase();
    if (!PC_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows } = await db.query(
      `INSERT INTO project_contractors (project_id, company_id, role, status, start_date, end_date, contract_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (project_id, company_id) DO UPDATE SET role=EXCLUDED.role, status=EXCLUDED.status,
         start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, contract_id=EXCLUDED.contract_id
       RETURNING *`,
      [pid, b.company_id, b.role || null, status,
        b.start_date || null, b.end_date || null, b.contract_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[companies] POST /assign error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /assign/:pcId — update project-contractor assignment ──────────
router.put('/assign/:pcId', async (req, res) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM project_contractors WHERE id=$1', [req.params.pcId]);
    if (!existing.length) return res.status(404).json({ error: 'Assignment not found' });
    const old = existing[0];
    const b = req.body;
    // Validate status transition
    if (b.status && b.status !== old.status) {
      const allowed = PC_TRANSITIONS[old.status] || [];
      if (!allowed.includes(b.status)) {
        return res.status(400).json({ error: `Cannot transition from '${old.status}' to '${b.status}'. Allowed: ${allowed.join(', ') || 'none'}` });
      }
    }
    const { rows } = await db.query(
      `UPDATE project_contractors SET role=$1, status=$2, start_date=$3, end_date=$4, contract_id=$5
       WHERE id=$6 RETURNING *`,
      [
        b.role !== undefined ? b.role : old.role,
        b.status || old.status,
        b.start_date !== undefined ? b.start_date : old.start_date,
        b.end_date !== undefined ? b.end_date : old.end_date,
        b.contract_id !== undefined ? b.contract_id : old.contract_id,
        req.params.pcId
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /assign/:pcId — remove company from project ────────────────
router.delete('/assign/:pcId', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM project_contractors WHERE id=$1', [req.params.pcId]);
    if (!rowCount) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
