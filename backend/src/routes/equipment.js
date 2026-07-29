const router = require('express').Router();
const db = require('../db');
const { logChange } = require('../db/changelog');
const { authenticate, requireRole } = require('../middleware/auth');

(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS equipment (
      id SERIAL PRIMARY KEY,
      project_id INTEGER,
      name VARCHAR(500) NOT NULL,
      equipment_type VARCHAR(100),
      make VARCHAR(200),
      model VARCHAR(200),
      year INTEGER,
      serial_number VARCHAR(200),
      status VARCHAR(50) DEFAULT 'Active',
      assigned_project_id INTEGER,
      assigned_operator VARCHAR(200),
      daily_log_entries JSONB DEFAULT '[]',
      maintenance_records JSONB DEFAULT '[]',
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Migration: equipment table ready');
  } catch (err) {
    console.error('equipment migration error:', err.message);
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS equipment (
        id SERIAL PRIMARY KEY,
        project_id INTEGER,
        name VARCHAR(500) NOT NULL,
        equipment_type VARCHAR(100),
        make VARCHAR(200),
        model VARCHAR(200),
        year INTEGER,
        serial_number VARCHAR(200),
        status VARCHAR(50) DEFAULT 'Active',
        assigned_project_id INTEGER,
        assigned_operator VARCHAR(200),
        daily_log_entries JSONB DEFAULT '[]',
        maintenance_records JSONB DEFAULT '[]',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(100)`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS make VARCHAR(200)`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS model VARCHAR(200)`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS year INTEGER`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS serial_number VARCHAR(200)`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS assigned_project_id INTEGER`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS assigned_operator VARCHAR(200)`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS daily_log_entries JSONB DEFAULT '[]'`);
      await db.query(`ALTER TABLE equipment ADD COLUMN IF NOT EXISTS maintenance_records JSONB DEFAULT '[]'`);
    } catch (e2) {
      console.error('equipment fallback migration error:', e2.message);
    }
  }
})();

// GET all equipment — project-level OR company-level (no project_id = all)
router.get('/', authenticate, async (req, res) => {
  try {
    const { project_id, status, assigned_project_id } = req.query;
    let sql = 'SELECT e.*, p.name as assigned_project_name FROM equipment e LEFT JOIN projects p ON e.assigned_project_id = p.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (project_id) { sql += ' AND (e.project_id = $' + idx + ' OR e.project_id IS NULL)'; params.push(project_id); idx++; }
    if (status) { sql += ' AND e.status = $' + idx; params.push(status); idx++; }
    if (assigned_project_id) { sql += ' AND e.assigned_project_id = $' + idx; params.push(assigned_project_id); idx++; }
    sql += ' ORDER BY e.name ASC';
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT e.*, p.name as assigned_project_name FROM equipment e LEFT JOIN projects p ON e.assigned_project_id = p.id WHERE e.id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      project_id, name, equipment_type, make, model, year, serial_number,
      status, assigned_project_id, assigned_operator,
      daily_log_entries, maintenance_records
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const { rows } = await db.query(
      `INSERT INTO equipment (project_id, name, equipment_type, make, model, year, serial_number,
        status, assigned_project_id, assigned_operator,
        daily_log_entries, maintenance_records, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        project_id || null, name, equipment_type || null,
        make || null, model || null, year || null, serial_number || null,
        status || 'Active', assigned_project_id || null, assigned_operator || null,
        JSON.stringify(daily_log_entries || []), JSON.stringify(maintenance_records || []),
        req.user.id
      ]
    );
    await logChange('equipment', rows[0].id, 'INSERT', null, null, JSON.stringify(rows[0]), req.user.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update
router.put('/:id', authenticate, async (req, res) => {
  try {
    const fields = [
      'project_id', 'name', 'equipment_type', 'make', 'model', 'year', 'serial_number',
      'status', 'assigned_project_id', 'assigned_operator',
      'daily_log_entries', 'maintenance_records'
    ];
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === 'daily_log_entries' || f === 'maintenance_records') {
          sets.push(f + ' = $' + idx);
          vals.push(JSON.stringify(req.body[f]));
        } else {
          sets.push(f + ' = $' + idx);
          vals.push(req.body[f]);
        }
        idx++;
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = NOW()');
    vals.push(req.params.id);
    const { rows } = await db.query(
      'UPDATE equipment SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' RETURNING *',
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logChange('equipment', rows[0].id, 'UPDATE', null, null, JSON.stringify(req.body), req.user.id);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM equipment WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logChange('equipment', rows[0].id, 'DELETE', JSON.stringify(rows[0]), null, null, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
