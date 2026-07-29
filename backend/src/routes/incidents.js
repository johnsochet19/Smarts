const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { logChange } = require('../db/changelog');
const { authenticate, requireRole } = require('../middleware/auth');

/* ── constants ── */
var INC_TYPES = ['near_miss', 'first_aid', 'recordable', 'lost_time', 'fatality', 'property_damage', 'environmental'];
var INC_STATUSES = ['draft', 'under_investigation', 'corrective_action', 'closed'];
var INC_TRANSITIONS = {
  draft: ['under_investigation'],
  under_investigation: ['corrective_action', 'closed'],
  corrective_action: ['closed'],
  closed: []
};
var MEDICAL_TREATMENTS = ['none', 'first_aid', 'doctor', 'hospital', 'emergency'];

/* ── schema ── */
const tablesReady = (async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      incident_number INTEGER,
      incident_date DATE NOT NULL,
      incident_time TIME,
      location VARCHAR(255),
      type VARCHAR(50) DEFAULT 'near_miss',
      description TEXT NOT NULL,
      status VARCHAR(30) DEFAULT 'draft',
      osha_recordable BOOLEAN DEFAULT false,
      osha_case_number VARCHAR(100),
      root_cause TEXT,
      corrective_actions TEXT,
      reported_by_id INTEGER REFERENCES users(id),
      supervisor_id INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      closed_at TIMESTAMP
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS incident_involved_parties (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER REFERENCES incidents(id) ON DELETE CASCADE,
      name VARCHAR(255),
      company VARCHAR(255),
      injury_type VARCHAR(100),
      body_part VARCHAR(100),
      days_lost INTEGER DEFAULT 0,
      medical_treatment VARCHAR(50) DEFAULT 'none'
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS incident_witnesses (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER REFERENCES incidents(id) ON DELETE CASCADE,
      name VARCHAR(255),
      company VARCHAR(255),
      statement TEXT
    )`);

    console.log('Migration: incidents + involved_parties + witnesses tables ready');
  } catch (err) {
    console.error('incidents migration error:', err.message);
  }
})();

/* ── legacy migration ── */
(async function migrateLegacy() {
  await tablesReady; // run only after this module's CREATE TABLEs finish (fresh-DB race)
  try {
    /* add new columns */
    await db.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'near_miss'`);
    await db.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_date DATE`);
    await db.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_time TIME`);
    await db.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS osha_case_number VARCHAR(100)`);
    await db.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reported_by_id INTEGER`);
    await db.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS supervisor_id INTEGER`);
    await db.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`);

    /* migrate incident_type → type (lowercase) */
    var typeMap = {
      'Near Miss': 'near_miss', 'First Aid': 'first_aid', 'Recordable': 'recordable',
      'Lost Time': 'lost_time', 'Fatality': 'fatality', 'Property Damage': 'property_damage'
    };
    var { rows: hasOldType } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'incident_type'`);
    if (hasOldType.length) {
      for (var oldVal in typeMap) {
        await db.query(`UPDATE incidents SET type = $1 WHERE incident_type = $2 AND (type IS NULL OR type = 'near_miss')`, [typeMap[oldVal], oldVal]);
      }
    }

    /* migrate date → incident_date */
    var { rows: hasDate } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'date'`);
    if (hasDate.length) {
      await db.query(`UPDATE incidents SET incident_date = date WHERE incident_date IS NULL AND date IS NOT NULL`);
    }

    /* migrate time → incident_time */
    var { rows: hasTime } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'time'`);
    if (hasTime.length) {
      await db.query(`UPDATE incidents SET incident_time = time WHERE incident_time IS NULL AND time IS NOT NULL`);
    }

    /* migrate uppercase statuses → lowercase */
    var statusMap = { 'Draft': 'draft', 'Under Investigation': 'under_investigation', 'Closed': 'closed' };
    for (var os in statusMap) {
      await db.query(`UPDATE incidents SET status = $1 WHERE status = $2`, [statusMap[os], os]);
    }

    /* migrate JSONB involved_parties → incident_involved_parties */
    var { rows: hasParties } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'involved_parties'`);
    if (hasParties.length) {
      var { rows: old } = await db.query(`SELECT id, involved_parties FROM incidents WHERE involved_parties IS NOT NULL AND involved_parties::text != '[]' AND involved_parties::text != 'null'`);
      for (var i = 0; i < old.length; i++) {
        var parties = old[i].involved_parties;
        if (typeof parties === 'string') try { parties = JSON.parse(parties); } catch(e) { continue; }
        if (!Array.isArray(parties)) continue;
        var { rows: existing } = await db.query('SELECT COUNT(*) as c FROM incident_involved_parties WHERE incident_id = $1', [old[i].id]);
        if (Number(existing[0].c) > 0) continue;
        for (var j = 0; j < parties.length; j++) {
          var p = parties[j];
          await db.query(
            'INSERT INTO incident_involved_parties (incident_id, name, company, injury_type, body_part, days_lost, medical_treatment) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [old[i].id, p.name || '', p.company || '', p.injury_type || '', p.body_part || '', Number(p.days_lost) || 0, 'none']
          );
        }
      }
      if (old.length) console.log('Legacy JSONB involved_parties migrated:', old.length);
    }

    /* migrate JSONB witnesses → incident_witnesses */
    var { rows: hasWitnesses } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'witnesses'`);
    if (hasWitnesses.length) {
      var { rows: old2 } = await db.query(`SELECT id, witnesses FROM incidents WHERE witnesses IS NOT NULL AND witnesses::text != '[]' AND witnesses::text != 'null'`);
      for (var k = 0; k < old2.length; k++) {
        var wits = old2[k].witnesses;
        if (typeof wits === 'string') try { wits = JSON.parse(wits); } catch(e) { continue; }
        if (!Array.isArray(wits)) continue;
        var { rows: existW } = await db.query('SELECT COUNT(*) as c FROM incident_witnesses WHERE incident_id = $1', [old2[k].id]);
        if (Number(existW[0].c) > 0) continue;
        for (var m = 0; m < wits.length; m++) {
          var w = wits[m];
          await db.query(
            'INSERT INTO incident_witnesses (incident_id, name, company, statement) VALUES ($1,$2,$3,$4)',
            [old2[k].id, w.name || '', w.company || '', w.statement || '']
          );
        }
      }
      if (old2.length) console.log('Legacy JSONB witnesses migrated:', old2.length);
    }

    /* migrate created_by → reported_by_id */
    await db.query(`UPDATE incidents SET reported_by_id = created_by WHERE reported_by_id IS NULL AND created_by IS NOT NULL`);

    console.log('Legacy incidents migration complete');
  } catch (err) {
    console.error('incidents legacy migration error:', err.message);
  }
})();

/* ── helpers ── */
function validateProject(req, res, next) {
  var pid = parseInt(req.params.id, 10);
  if (!pid) return res.status(400).json({ error: 'Invalid project id' });
  req.projectId = pid;
  next();
}

async function getNextIncidentNumber(projectId) {
  var { rows } = await db.query('SELECT COALESCE(MAX(incident_number), 0) + 1 as next_num FROM incidents WHERE project_id = $1', [projectId]);
  return rows[0].next_num;
}

async function enrichIncident(row) {
  if (!row) return row;
  var { rows: parties } = await db.query('SELECT * FROM incident_involved_parties WHERE incident_id = $1 ORDER BY id', [row.id]);
  row.involved_parties = parties;
  var { rows: witnesses } = await db.query('SELECT * FROM incident_witnesses WHERE incident_id = $1 ORDER BY id', [row.id]);
  row.witnesses = witnesses;
  /* user names */
  if (row.reported_by_id) {
    var { rows: ru } = await db.query('SELECT name, email FROM users WHERE id = $1', [row.reported_by_id]);
    row.reported_by_name = ru.length ? (ru[0].name || ru[0].email) : null;
  }
  if (row.supervisor_id) {
    var { rows: su } = await db.query('SELECT name, email FROM users WHERE id = $1', [row.supervisor_id]);
    row.supervisor_name = su.length ? (su[0].name || su[0].email) : null;
  }
  /* computed */
  row.party_count = parties.length;
  row.total_days_lost = parties.reduce(function(s, p) { return s + (Number(p.days_lost) || 0); }, 0);
  row.witness_count = witnesses.length;
  return row;
}

async function enrichIncidents(rows) {
  if (!rows.length) return rows;
  var ids = rows.map(function(r) { return r.id; });

  var { rows: allParties } = await db.query('SELECT * FROM incident_involved_parties WHERE incident_id = ANY($1) ORDER BY id', [ids]);
  var partyMap = {};
  allParties.forEach(function(p) { if (!partyMap[p.incident_id]) partyMap[p.incident_id] = []; partyMap[p.incident_id].push(p); });

  var { rows: allWitnesses } = await db.query('SELECT * FROM incident_witnesses WHERE incident_id = ANY($1) ORDER BY id', [ids]);
  var witMap = {};
  allWitnesses.forEach(function(w) { if (!witMap[w.incident_id]) witMap[w.incident_id] = []; witMap[w.incident_id].push(w); });

  /* batch user names */
  var userIds = [...new Set(rows.map(function(r) { return r.reported_by_id; }).concat(rows.map(function(r) { return r.supervisor_id; })).filter(Boolean))];
  var userMap = {};
  if (userIds.length) {
    var { rows: uu } = await db.query('SELECT id, name, email FROM users WHERE id = ANY($1)', [userIds]);
    uu.forEach(function(u) { userMap[u.id] = u.name || u.email; });
  }

  return rows.map(function(r) {
    r.involved_parties = partyMap[r.id] || [];
    r.witnesses = witMap[r.id] || [];
    r.reported_by_name = userMap[r.reported_by_id] || null;
    r.supervisor_name = userMap[r.supervisor_id] || null;
    r.party_count = r.involved_parties.length;
    r.total_days_lost = r.involved_parties.reduce(function(s, p) { return s + (Number(p.days_lost) || 0); }, 0);
    r.witness_count = r.witnesses.length;
    return r;
  });
}

/* ── GET all ── */
router.get('/', authenticate, validateProject, async function(req, res) {
  try {
    var sql = 'SELECT * FROM incidents WHERE project_id = $1';
    var params = [req.projectId];
    var idx = 2;
    if (req.query.status) { sql += ' AND status = $' + idx; params.push(req.query.status); idx++; }
    if (req.query.type) { sql += ' AND type = $' + idx; params.push(req.query.type); idx++; }
    if (req.query.osha_recordable === 'true') { sql += ' AND osha_recordable = true'; }
    sql += ' ORDER BY incident_date DESC NULLS LAST, incident_time DESC NULLS LAST';
    var { rows } = await db.query(sql, params);
    var enriched = await enrichIncidents(rows);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET single ── */
router.get('/:incId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows } = await db.query('SELECT * FROM incidents WHERE id = $1 AND project_id = $2', [req.params.incId, req.projectId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    var enriched = await enrichIncident(rows[0]);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST create ── */
router.post('/', authenticate, validateProject, async function(req, res) {
  try {
    var b = req.body;
    if (!b.incident_date || !b.description) return res.status(400).json({ error: 'incident_date and description are required' });

    var type = (b.type || 'near_miss').toLowerCase();
    if (INC_TYPES.indexOf(type) === -1) return res.status(400).json({ error: 'Invalid type: ' + type });
    var status = (b.status || 'draft').toLowerCase();
    if (INC_STATUSES.indexOf(status) === -1) return res.status(400).json({ error: 'Invalid status: ' + status });

    var incNum = await getNextIncidentNumber(req.projectId);

    var { rows } = await db.query(
      `INSERT INTO incidents (project_id, incident_number, incident_date, incident_time, location, type,
        description, status, osha_recordable, osha_case_number, root_cause, corrective_actions,
        reported_by_id, supervisor_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.projectId, incNum, b.incident_date, b.incident_time || null, b.location || null, type,
       b.description, status, b.osha_recordable || false, b.osha_case_number || null,
       b.root_cause || null, b.corrective_actions || null,
       b.reported_by_id || req.user.id, b.supervisor_id || null, req.user.id]
    );
    var inc = rows[0];

    /* insert involved parties */
    if (Array.isArray(b.involved_parties)) {
      for (var i = 0; i < b.involved_parties.length; i++) {
        var p = b.involved_parties[i];
        var mt = (p.medical_treatment || 'none').toLowerCase();
        if (MEDICAL_TREATMENTS.indexOf(mt) === -1) mt = 'none';
        await db.query(
          'INSERT INTO incident_involved_parties (incident_id, name, company, injury_type, body_part, days_lost, medical_treatment) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [inc.id, p.name || '', p.company || '', p.injury_type || '', p.body_part || '', Number(p.days_lost) || 0, mt]
        );
      }
    }

    /* insert witnesses */
    if (Array.isArray(b.witnesses)) {
      for (var j = 0; j < b.witnesses.length; j++) {
        var w = b.witnesses[j];
        await db.query(
          'INSERT INTO incident_witnesses (incident_id, name, company, statement) VALUES ($1,$2,$3,$4)',
          [inc.id, w.name || '', w.company || '', w.statement || '']
        );
      }
    }

    await logChange('incidents', inc.id, 'INSERT', null, null, JSON.stringify(inc), req.user.id);
    var enriched = await enrichIncident(inc);
    res.status(201).json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT update ── */
router.put('/:incId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows: existing } = await db.query('SELECT * FROM incidents WHERE id = $1 AND project_id = $2', [req.params.incId, req.projectId]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    var old = existing[0];
    var b = req.body;

    /* status machine */
    if (b.status !== undefined) {
      var newStatus = b.status.toLowerCase();
      if (INC_STATUSES.indexOf(newStatus) === -1) return res.status(400).json({ error: 'Invalid status: ' + newStatus });
      var allowed = INC_TRANSITIONS[old.status] || [];
      if (newStatus !== old.status && allowed.indexOf(newStatus) === -1) {
        return res.status(400).json({ error: 'Cannot transition from ' + old.status + ' to ' + newStatus + '. Allowed: ' + allowed.join(', ') });
      }
      b.status = newStatus;
    }

    /* type validation */
    if (b.type !== undefined) {
      b.type = b.type.toLowerCase();
      if (INC_TYPES.indexOf(b.type) === -1) return res.status(400).json({ error: 'Invalid type: ' + b.type });
    }

    var fields = ['incident_date', 'incident_time', 'location', 'type', 'description', 'status',
      'osha_recordable', 'osha_case_number', 'root_cause', 'corrective_actions', 'reported_by_id', 'supervisor_id'];
    var sets = [];
    var vals = [];
    var idx = 1;
    for (var i = 0; i < fields.length; i++) {
      if (b[fields[i]] !== undefined) {
        sets.push(fields[i] + ' = $' + idx);
        vals.push(b[fields[i]]);
        idx++;
      }
    }

    /* set closed_at when transitioning to closed */
    if (b.status === 'closed' && old.status !== 'closed') {
      sets.push('closed_at = NOW()');
    }

    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      vals.push(req.params.incId);
      await db.query('UPDATE incidents SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
    }

    /* replace involved parties if provided */
    if (Array.isArray(b.involved_parties)) {
      await db.query('DELETE FROM incident_involved_parties WHERE incident_id = $1', [old.id]);
      for (var j = 0; j < b.involved_parties.length; j++) {
        var p = b.involved_parties[j];
        var mt = (p.medical_treatment || 'none').toLowerCase();
        if (MEDICAL_TREATMENTS.indexOf(mt) === -1) mt = 'none';
        await db.query(
          'INSERT INTO incident_involved_parties (incident_id, name, company, injury_type, body_part, days_lost, medical_treatment) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [old.id, p.name || '', p.company || '', p.injury_type || '', p.body_part || '', Number(p.days_lost) || 0, mt]
        );
      }
    }

    /* replace witnesses if provided */
    if (Array.isArray(b.witnesses)) {
      await db.query('DELETE FROM incident_witnesses WHERE incident_id = $1', [old.id]);
      for (var k = 0; k < b.witnesses.length; k++) {
        var w = b.witnesses[k];
        await db.query(
          'INSERT INTO incident_witnesses (incident_id, name, company, statement) VALUES ($1,$2,$3,$4)',
          [old.id, w.name || '', w.company || '', w.statement || '']
        );
      }
    }

    await logChange('incidents', old.id, 'UPDATE', null, null, JSON.stringify(b), req.user.id);
    var { rows: updated } = await db.query('SELECT * FROM incidents WHERE id = $1', [old.id]);
    var enriched = await enrichIncident(updated[0]);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── DELETE ── */
router.delete('/:incId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows } = await db.query('DELETE FROM incidents WHERE id = $1 AND project_id = $2 RETURNING *', [req.params.incId, req.projectId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logChange('incidents', rows[0].id, 'DELETE', JSON.stringify(rows[0]), null, null, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
