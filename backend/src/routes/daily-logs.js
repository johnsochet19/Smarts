var router = require('express').Router({ mergeParams: true });
var db = require('../db');
var { logChange } = require('../db/changelog');
var { authenticate, requireRole } = require('../middleware/auth');

/* ── constants ───────────────────────────────────────── */
var WEATHER_VALUES = ['sunny','cloudy','partly_cloudy','rainy','snowy','windy','foggy'];

/* ── auto-migrate ────────────────────────────────────── */
(async function () {
  try {
    /* core table */
    await db.query(`CREATE TABLE IF NOT EXISTS daily_logs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) NOT NULL,
      log_date DATE NOT NULL,
      weather VARCHAR(50),
      temperature_high INTEGER,
      temperature_low INTEGER,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, log_date)
    )`);
    /* sub-tables */
    await db.query(`CREATE TABLE IF NOT EXISTS daily_log_manpower (
      id SERIAL PRIMARY KEY,
      log_id INTEGER REFERENCES daily_logs(id) ON DELETE CASCADE,
      company_name VARCHAR(255),
      trade VARCHAR(100),
      worker_count INTEGER,
      hours_worked DECIMAL(5,2),
      notes TEXT
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS daily_log_equipment (
      id SERIAL PRIMARY KEY,
      log_id INTEGER REFERENCES daily_logs(id) ON DELETE CASCADE,
      equipment_name VARCHAR(255),
      quantity INTEGER DEFAULT 1,
      operating_hours DECIMAL(5,2),
      idle_hours DECIMAL(5,2),
      cost_code VARCHAR(50),
      notes TEXT
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS daily_log_materials (
      id SERIAL PRIMARY KEY,
      log_id INTEGER REFERENCES daily_logs(id) ON DELETE CASCADE,
      description VARCHAR(255),
      quantity DECIMAL(10,2),
      unit VARCHAR(50),
      delivered_by VARCHAR(255),
      notes TEXT
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS daily_log_work (
      id SERIAL PRIMARY KEY,
      log_id INTEGER REFERENCES daily_logs(id) ON DELETE CASCADE,
      description TEXT,
      cost_code VARCHAR(50),
      location VARCHAR(255),
      hours DECIMAL(5,2),
      notes TEXT
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS daily_log_visitors (
      id SERIAL PRIMARY KEY,
      log_id INTEGER REFERENCES daily_logs(id) ON DELETE CASCADE,
      name VARCHAR(255),
      company VARCHAR(255),
      time_in TIME,
      time_out TIME,
      reason VARCHAR(255)
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS daily_log_notes (
      id SERIAL PRIMARY KEY,
      log_id INTEGER REFERENCES daily_logs(id) ON DELETE CASCADE,
      note_text TEXT,
      private BOOLEAN DEFAULT false,
      created_by INTEGER REFERENCES users(id)
    )`);

    /* ── legacy migrations ── */
    // Rename weather_conditions → weather
    await db.query(`ALTER TABLE daily_logs RENAME COLUMN weather_conditions TO weather`).catch(function(){});
    // Add temperature_high / temperature_low, migrate from old temperature
    await db.query(`ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS temperature_high INTEGER`).catch(function(){});
    await db.query(`ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS temperature_low INTEGER`).catch(function(){});
    await db.query(`ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS notes TEXT`).catch(function(){});
    // Migrate old temperature string → temperature_high (best effort)
    await db.query(`UPDATE daily_logs SET temperature_high = CAST(NULLIF(REGEXP_REPLACE(temperature, '[^0-9\\-]', '', 'g'), '') AS INTEGER) WHERE temperature IS NOT NULL AND temperature_high IS NULL`).catch(function(){});
    await db.query(`ALTER TABLE daily_logs DROP COLUMN IF EXISTS temperature`).catch(function(){});

    // Rename daily_log_id → log_id on sub-tables
    var subTables = ['daily_log_manpower','daily_log_equipment','daily_log_materials','daily_log_work','daily_log_visitors','daily_log_notes'];
    for (var t of subTables) {
      await db.query('ALTER TABLE ' + t + ' RENAME COLUMN daily_log_id TO log_id').catch(function(){});
    }

    // Rename workers_count → worker_count
    await db.query(`ALTER TABLE daily_log_manpower RENAME COLUMN workers_count TO worker_count`).catch(function(){});
    // Add cost_code to equipment
    await db.query(`ALTER TABLE daily_log_equipment ADD COLUMN IF NOT EXISTS cost_code VARCHAR(50)`).catch(function(){});
    // Rename visitor_name → name
    await db.query(`ALTER TABLE daily_log_visitors RENAME COLUMN visitor_name TO name`).catch(function(){});
    // Rename is_private → private
    await db.query(`ALTER TABLE daily_log_notes RENAME COLUMN is_private TO private`).catch(function(){});
    // Add created_by FK to daily_log_notes
    await db.query(`ALTER TABLE daily_log_notes ADD COLUMN IF NOT EXISTS created_by INTEGER`).catch(function(){});

    // Migrate legacy weather values to lowercase
    await db.query(`UPDATE daily_logs SET weather = LOWER(REPLACE(weather, ' ', '_')) WHERE weather IS NOT NULL AND weather != LOWER(REPLACE(weather, ' ', '_'))`).catch(function(){});

    console.log('Daily log tables ready');
  } catch (err) {
    console.error('Daily log migration note:', err.message);
  }
})();

/* ── helpers ──────────────────────────────────────────── */
function validateProject(req, res, next) {
  var projectId = req.params.id || req.params.projectId || req.query.project_id;
  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  req.projectId = Number(projectId);
  next();
}

var SUB_SECTIONS = {
  manpower:  { table: 'daily_log_manpower',  cols: ['company_name','trade','worker_count','hours_worked','notes'],
    vals: function(b) { return [b.company_name||null, b.trade||null, b.worker_count||null, b.hours_worked||null, b.notes||null]; } },
  equipment: { table: 'daily_log_equipment',  cols: ['equipment_name','quantity','operating_hours','idle_hours','cost_code','notes'],
    vals: function(b) { return [b.equipment_name||null, b.quantity||1, b.operating_hours||null, b.idle_hours||null, b.cost_code||null, b.notes||null]; } },
  materials: { table: 'daily_log_materials',  cols: ['description','quantity','unit','delivered_by','notes'],
    vals: function(b) { return [b.description||null, b.quantity||null, b.unit||null, b.delivered_by||null, b.notes||null]; } },
  work:      { table: 'daily_log_work',       cols: ['description','cost_code','location','hours','notes'],
    vals: function(b) { return [b.description||null, b.cost_code||null, b.location||null, b.hours||null, b.notes||null]; } },
  visitors:  { table: 'daily_log_visitors',   cols: ['name','company','time_in','time_out','reason'],
    vals: function(b) { return [b.name||null, b.company||null, b.time_in||null, b.time_out||null, b.reason||null]; } },
  notes:     { table: 'daily_log_notes',      cols: ['note_text','private','created_by'],
    vals: function(b, userId) { return [b.note_text||null, b.private||false, b.created_by||userId]; } },
};

async function enrichDailyLogs(logs) {
  if (!logs.length) return logs;
  var ids = logs.map(function(l) { return l.id; });
  var results = await Promise.all([
    db.query('SELECT * FROM daily_log_manpower WHERE log_id = ANY($1) ORDER BY id', [ids]),
    db.query('SELECT * FROM daily_log_equipment WHERE log_id = ANY($1) ORDER BY id', [ids]),
    db.query('SELECT * FROM daily_log_materials WHERE log_id = ANY($1) ORDER BY id', [ids]),
    db.query('SELECT * FROM daily_log_work WHERE log_id = ANY($1) ORDER BY id', [ids]),
    db.query('SELECT * FROM daily_log_visitors WHERE log_id = ANY($1) ORDER BY id', [ids]),
    db.query('SELECT * FROM daily_log_notes WHERE log_id = ANY($1) ORDER BY id', [ids]),
  ]);
  var keys = ['manpower','equipment','materials','work','visitors','notes'];
  var maps = {};
  keys.forEach(function(k, i) {
    maps[k] = {};
    results[i].rows.forEach(function(r) {
      if (!maps[k][r.log_id]) maps[k][r.log_id] = [];
      maps[k][r.log_id].push(r);
    });
  });
  return logs.map(function(log) {
    keys.forEach(function(k) { log[k] = maps[k][log.id] || []; });
    log.total_workers = (log.manpower || []).reduce(function(s, m) { return s + (Number(m.worker_count) || 0); }, 0);
    log.total_hours = (log.manpower || []).reduce(function(s, m) { return s + (Number(m.hours_worked) || 0); }, 0);
    return log;
  });
}

async function insertSubSections(logId, body, userId) {
  for (var key in SUB_SECTIONS) {
    if (!Array.isArray(body[key])) continue;
    var sec = SUB_SECTIONS[key];
    for (var row of body[key]) {
      var vals = sec.vals(row, userId);
      var placeholders = vals.map(function(_, i) { return '$' + (i + 2); }).join(', ');
      await db.query(
        'INSERT INTO ' + sec.table + ' (log_id, ' + sec.cols.join(', ') + ') VALUES ($1, ' + placeholders + ')',
        [logId].concat(vals)
      );
    }
  }
}

/* ── routes ───────────────────────────────────────────── */

// GET / — list daily logs for project
router.get('/', authenticate, validateProject, async function(req, res) {
  try {
    var { start_date, end_date } = req.query;
    var where = 'WHERE d.project_id = $1';
    var params = [req.projectId];
    if (start_date) { params.push(start_date); where += ' AND d.log_date >= $' + params.length; }
    if (end_date)   { params.push(end_date);   where += ' AND d.log_date <= $' + params.length; }
    var result = await db.query(
      'SELECT d.*, u.name AS created_by_name FROM daily_logs d LEFT JOIN users u ON u.id = d.created_by ' +
      where + ' ORDER BY d.log_date DESC',
      params
    );
    var enriched = await enrichDailyLogs(result.rows);
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /date/:date — get log by date (YYYY-MM-DD)
router.get('/date/:date', authenticate, validateProject, async function(req, res) {
  try {
    var result = await db.query(
      'SELECT d.*, u.name AS created_by_name FROM daily_logs d LEFT JOIN users u ON u.id = d.created_by WHERE d.project_id = $1 AND d.log_date = $2',
      [req.projectId, req.params.date]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No daily log for ' + req.params.date });
    var enriched = await enrichDailyLogs(result.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST / — create daily log
router.post('/', authenticate, validateProject, async function(req, res) {
  try {
    var { log_date, weather, temperature_high, temperature_low, notes } = req.body;
    if (!log_date) return res.status(400).json({ error: 'log_date required' });
    if (weather && WEATHER_VALUES.indexOf(weather) === -1) {
      return res.status(400).json({ error: 'Invalid weather. Must be one of: ' + WEATHER_VALUES.join(', ') });
    }
    var result = await db.query(
      'INSERT INTO daily_logs (project_id, log_date, weather, temperature_high, temperature_low, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.projectId, log_date, weather || null, temperature_high || null, temperature_low || null, notes || null, req.user.id]
    );
    var dl = result.rows[0];
    await insertSubSections(dl.id, req.body, req.user.id);
    await logChange({ tableName: 'daily_logs', recordId: dl.id, operation: 'CREATE', newValue: JSON.stringify({ log_date: log_date, project_id: req.projectId }), userId: req.user.id });
    var enriched = await enrichDailyLogs([dl]);
    res.status(201).json(enriched[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A daily log already exists for this date' });
    res.status(500).json({ error: err.message });
  }
});

// GET /:logId — single log with all sub-sections
router.get('/:logId', authenticate, async function(req, res) {
  try {
    var result = await db.query(
      'SELECT d.*, u.name AS created_by_name FROM daily_logs d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = $1',
      [req.params.logId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Daily log not found' });
    var enriched = await enrichDailyLogs(result.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:logId — update header + replace sub-sections if provided
router.put('/:logId', authenticate, async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM daily_logs WHERE id = $1', [req.params.logId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Daily log not found' });
    var { weather, temperature_high, temperature_low, notes } = req.body;
    if (weather && WEATHER_VALUES.indexOf(weather) === -1) {
      return res.status(400).json({ error: 'Invalid weather value' });
    }
    await db.query(
      'UPDATE daily_logs SET weather = COALESCE($1, weather), temperature_high = COALESCE($2, temperature_high), temperature_low = COALESCE($3, temperature_low), notes = COALESCE($4, notes), updated_at = NOW() WHERE id = $5',
      [weather !== undefined ? weather : null, temperature_high !== undefined ? temperature_high : null, temperature_low !== undefined ? temperature_low : null, notes !== undefined ? notes : null, req.params.logId]
    );
    // Replace sub-sections if provided
    for (var key in SUB_SECTIONS) {
      if (!Array.isArray(req.body[key])) continue;
      var sec = SUB_SECTIONS[key];
      await db.query('DELETE FROM ' + sec.table + ' WHERE log_id = $1', [req.params.logId]);
      for (var row of req.body[key]) {
        var vals = sec.vals(row, req.user.id);
        var placeholders = vals.map(function(_, i) { return '$' + (i + 2); }).join(', ');
        await db.query(
          'INSERT INTO ' + sec.table + ' (log_id, ' + sec.cols.join(', ') + ') VALUES ($1, ' + placeholders + ')',
          [req.params.logId].concat(vals)
        );
      }
    }
    await logChange({ tableName: 'daily_logs', recordId: req.params.logId, operation: 'UPDATE', userId: req.user.id });
    var updated = await db.query('SELECT d.*, u.name AS created_by_name FROM daily_logs d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = $1', [req.params.logId]);
    var enriched = await enrichDailyLogs(updated.rows);
    res.json(enriched[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:logId
router.delete('/:logId', authenticate, requireRole('admin'), async function(req, res) {
  try {
    var existing = await db.query('SELECT * FROM daily_logs WHERE id = $1', [req.params.logId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Daily log not found' });
    await logChange({ tableName: 'daily_logs', recordId: req.params.logId, operation: 'DELETE', oldValue: JSON.stringify({ log_date: existing.rows[0].log_date }), userId: req.user.id });
    await db.query('DELETE FROM daily_logs WHERE id = $1', [req.params.logId]);
    res.json({ message: 'Daily log deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── sub-section individual add/delete ───────────────── */

// POST /:logId/:section — add entry
router.post('/:logId/:section', authenticate, async function(req, res) {
  var sec = SUB_SECTIONS[req.params.section];
  if (!sec) return res.status(400).json({ error: 'Invalid section: ' + req.params.section });
  try {
    // Verify log exists
    var log = await db.query('SELECT id FROM daily_logs WHERE id = $1', [req.params.logId]);
    if (!log.rows.length) return res.status(404).json({ error: 'Daily log not found' });
    var vals = sec.vals(req.body, req.user.id);
    var placeholders = vals.map(function(_, i) { return '$' + (i + 2); }).join(', ');
    var result = await db.query(
      'INSERT INTO ' + sec.table + ' (log_id, ' + sec.cols.join(', ') + ') VALUES ($1, ' + placeholders + ') RETURNING *',
      [req.params.logId].concat(vals)
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /:logId/:section/:entryId — remove entry
router.delete('/:logId/:section/:entryId', authenticate, async function(req, res) {
  var sec = SUB_SECTIONS[req.params.section];
  if (!sec) return res.status(400).json({ error: 'Invalid section' });
  try {
    var result = await db.query('DELETE FROM ' + sec.table + ' WHERE id = $1 AND log_id = $2 RETURNING id', [req.params.entryId, req.params.logId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Entry not found' });
    res.json({ message: 'Entry deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
