const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { logChange } = require('../db/changelog');
const { authenticate, requireRole } = require('../middleware/auth');

/* ── constants ── */
var MTG_TYPES = ['owner_meeting', 'oac', 'subcontractor', 'safety', 'design_review', 'kickoff', 'closeout', 'other'];
var MTG_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
var MTG_TRANSITIONS = {
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};
var ACTION_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];

/* ── schema migration ── */
const tablesReady = (async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS meetings (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      title VARCHAR(255) NOT NULL,
      type VARCHAR(100) DEFAULT 'oac',
      status VARCHAR(20) DEFAULT 'scheduled',
      meeting_number INTEGER,
      meeting_date DATE,
      start_time TIME,
      end_time TIME,
      location VARCHAR(255),
      virtual_link VARCHAR(500),
      minutes_exported BOOLEAN DEFAULT false,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS meeting_attendees (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      present BOOLEAN DEFAULT false,
      UNIQUE(meeting_id, user_id)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS meeting_agenda_items (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
      number INTEGER,
      title VARCHAR(255),
      description TEXT,
      presenter_id INTEGER REFERENCES users(id),
      duration_minutes INTEGER,
      sort_order INTEGER DEFAULT 0
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS meeting_action_items (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
      agenda_item_id INTEGER REFERENCES meeting_agenda_items(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      assignee_id INTEGER REFERENCES users(id),
      due_date DATE,
      status VARCHAR(20) DEFAULT 'open',
      completed_at TIMESTAMP
    )`);

    console.log('Migration: meetings + attendees + agenda + action tables ready');
  } catch (err) {
    console.error('meetings migration error:', err.message);
  }
})();

/* ── legacy migration ── */
(async function migrateLegacy() {
  await tablesReady; // run only after this module's CREATE TABLEs finish (fresh-DB race)
  try {
    /* add new columns */
    await db.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS type VARCHAR(100) DEFAULT 'oac'`);
    await db.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_date DATE`);
    await db.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS start_time TIME`);
    await db.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS end_time TIME`);
    await db.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS virtual_link VARCHAR(500)`);

    /* migrate meeting_type → type (lowercase) */
    var typeMap = {
      'Owner Meeting': 'owner_meeting', 'OAC': 'oac', 'Subcontractor': 'subcontractor',
      'Safety': 'safety', 'Pre-Construction': 'other', 'Progress': 'other',
      'Kickoff': 'kickoff', 'Close-Out': 'closeout', 'Design Review': 'design_review', 'Other': 'other'
    };
    var { rows: hasOldType } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'meeting_type'`);
    if (hasOldType.length) {
      for (var oldVal in typeMap) {
        await db.query(`UPDATE meetings SET type = $1 WHERE meeting_type = $2 AND (type IS NULL OR type = 'oac')`, [typeMap[oldVal], oldVal]);
      }
    }

    /* migrate date → meeting_date */
    var { rows: hasDate } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'date'`);
    if (hasDate.length) {
      await db.query(`UPDATE meetings SET meeting_date = date WHERE meeting_date IS NULL AND date IS NOT NULL`);
    }

    /* migrate time → start_time */
    var { rows: hasTime } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'time'`);
    if (hasTime.length) {
      await db.query(`UPDATE meetings SET start_time = time WHERE start_time IS NULL AND time IS NOT NULL`);
    }

    /* migrate uppercase statuses → lowercase */
    var statusMap = { 'Scheduled': 'scheduled', 'In Progress': 'in_progress', 'Completed': 'completed' };
    for (var os in statusMap) {
      await db.query(`UPDATE meetings SET status = $1 WHERE status = $2`, [statusMap[os], os]);
    }

    /* migrate JSONB attendees → meeting_attendees */
    var { rows: hasAttendees } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'attendees'`);
    if (hasAttendees.length) {
      var { rows: old } = await db.query(`SELECT id, attendees FROM meetings WHERE attendees IS NOT NULL AND attendees::text != '[]' AND attendees::text != 'null'`);
      for (var i = 0; i < old.length; i++) {
        var atts = old[i].attendees;
        if (typeof atts === 'string') try { atts = JSON.parse(atts); } catch(e) { continue; }
        if (!Array.isArray(atts)) continue;
        /* check if already migrated */
        var { rows: existing } = await db.query('SELECT COUNT(*) as c FROM meeting_attendees WHERE meeting_id = $1', [old[i].id]);
        if (Number(existing[0].c) > 0) continue;
        for (var j = 0; j < atts.length; j++) {
          var a = atts[j];
          var uid = a.user_id ? Number(a.user_id) : null;
          if (!uid) continue;
          try {
            await db.query('INSERT INTO meeting_attendees (meeting_id, user_id, present) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [old[i].id, uid, a.present || false]);
          } catch(e) { /* skip */ }
        }
      }
      if (old.length) console.log('Legacy JSONB attendees migrated:', old.length);
    }

    /* migrate JSONB agenda_items → meeting_agenda_items + meeting_action_items */
    var { rows: hasAgenda } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'agenda_items'`);
    if (hasAgenda.length) {
      var { rows: old2 } = await db.query(`SELECT id, agenda_items FROM meetings WHERE agenda_items IS NOT NULL AND agenda_items::text != '[]' AND agenda_items::text != 'null'`);
      for (var k = 0; k < old2.length; k++) {
        var items = old2[k].agenda_items;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch(e) { continue; }
        if (!Array.isArray(items)) continue;
        var { rows: existAg } = await db.query('SELECT COUNT(*) as c FROM meeting_agenda_items WHERE meeting_id = $1', [old2[k].id]);
        if (Number(existAg[0].c) > 0) continue;
        for (var m = 0; m < items.length; m++) {
          var ai = items[m];
          var { rows: aiRow } = await db.query(
            'INSERT INTO meeting_agenda_items (meeting_id, number, title, description, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [old2[k].id, ai.number || (m + 1), ai.title || '', ai.description || '', m]
          );
          /* migrate nested action_items */
          var actions = ai.action_items || [];
          for (var n = 0; n < actions.length; n++) {
            var ac = actions[n];
            var acStatus = (ac.status || 'open').toLowerCase();
            if (acStatus === 'closed') acStatus = 'completed';
            await db.query(
              'INSERT INTO meeting_action_items (meeting_id, agenda_item_id, description, due_date, status) VALUES ($1, $2, $3, $4, $5)',
              [old2[k].id, aiRow[0].id, ac.assignee || ac.description || 'Action item', ac.due_date || null, acStatus]
            );
          }
        }
      }
      if (old2.length) console.log('Legacy JSONB agenda_items migrated:', old2.length);
    }

    console.log('Legacy meetings migration complete');
  } catch (err) {
    console.error('meetings legacy migration error:', err.message);
  }
})();

/* ── helpers ── */
function validateProject(req, res, next) {
  var pid = parseInt(req.params.id, 10);
  if (!pid) return res.status(400).json({ error: 'Invalid project id' });
  req.projectId = pid;
  next();
}

async function getNextMeetingNumber(projectId) {
  var { rows } = await db.query('SELECT COALESCE(MAX(meeting_number), 0) + 1 as next_num FROM meetings WHERE project_id = $1', [projectId]);
  return rows[0].next_num;
}

async function enrichMeeting(row) {
  if (!row) return row;
  /* attendees */
  var { rows: atts } = await db.query(
    `SELECT ma.*, u.name as user_name, u.email as user_email
     FROM meeting_attendees ma LEFT JOIN users u ON ma.user_id = u.id
     WHERE ma.meeting_id = $1 ORDER BY u.name`, [row.id]
  );
  row.attendees = atts;

  /* agenda items */
  var { rows: agenda } = await db.query(
    `SELECT mai.*, u.name as presenter_name
     FROM meeting_agenda_items mai LEFT JOIN users u ON mai.presenter_id = u.id
     WHERE mai.meeting_id = $1 ORDER BY mai.sort_order, mai.number`, [row.id]
  );

  /* action items */
  var { rows: actions } = await db.query(
    `SELECT mact.*, u.name as assignee_name
     FROM meeting_action_items mact LEFT JOIN users u ON mact.assignee_id = u.id
     WHERE mact.meeting_id = $1 ORDER BY mact.id`, [row.id]
  );

  /* nest actions under agenda items */
  var actionMap = {};
  actions.forEach(function(a) {
    var key = a.agenda_item_id || 'unlinked';
    if (!actionMap[key]) actionMap[key] = [];
    actionMap[key].push(a);
  });
  agenda.forEach(function(ai) { ai.action_items = actionMap[ai.id] || []; });
  row.agenda_items = agenda;
  row.action_items = actions; /* flat list too */

  /* creator name */
  if (row.created_by) {
    var { rows: cu } = await db.query('SELECT name, email FROM users WHERE id = $1', [row.created_by]);
    row.created_by_name = cu.length ? (cu[0].name || cu[0].email) : null;
  }

  return row;
}

async function enrichMeetings(rows) {
  if (!rows.length) return rows;
  var ids = rows.map(function(r) { return r.id; });

  /* batch attendees */
  var { rows: allAtts } = await db.query(
    `SELECT ma.*, u.name as user_name, u.email as user_email
     FROM meeting_attendees ma LEFT JOIN users u ON ma.user_id = u.id
     WHERE ma.meeting_id = ANY($1) ORDER BY u.name`, [ids]
  );
  var attMap = {};
  allAtts.forEach(function(a) { if (!attMap[a.meeting_id]) attMap[a.meeting_id] = []; attMap[a.meeting_id].push(a); });

  /* batch agenda */
  var { rows: allAgenda } = await db.query(
    `SELECT mai.*, u.name as presenter_name
     FROM meeting_agenda_items mai LEFT JOIN users u ON mai.presenter_id = u.id
     WHERE mai.meeting_id = ANY($1) ORDER BY mai.sort_order, mai.number`, [ids]
  );
  var agendaMap = {};
  allAgenda.forEach(function(ai) { if (!agendaMap[ai.meeting_id]) agendaMap[ai.meeting_id] = []; agendaMap[ai.meeting_id].push(ai); });

  /* batch actions */
  var { rows: allActions } = await db.query(
    `SELECT mact.*, u.name as assignee_name
     FROM meeting_action_items mact LEFT JOIN users u ON mact.assignee_id = u.id
     WHERE mact.meeting_id = ANY($1) ORDER BY mact.id`, [ids]
  );
  var actionMap = {};
  allActions.forEach(function(a) {
    if (!actionMap[a.meeting_id]) actionMap[a.meeting_id] = {};
    var key = a.agenda_item_id || 'unlinked';
    if (!actionMap[a.meeting_id][key]) actionMap[a.meeting_id][key] = [];
    actionMap[a.meeting_id][key].push(a);
  });

  return rows.map(function(r) {
    r.attendees = attMap[r.id] || [];
    var agenda = agendaMap[r.id] || [];
    var meetingActions = actionMap[r.id] || {};
    agenda.forEach(function(ai) { ai.action_items = meetingActions[ai.id] || []; });
    r.agenda_items = agenda;
    /* computed counts */
    r.attendee_count = r.attendees.length;
    r.present_count = r.attendees.filter(function(a) { return a.present; }).length;
    r.agenda_count = agenda.length;
    r.action_count = allActions.filter(function(a) { return a.meeting_id === r.id; }).length;
    r.open_action_count = allActions.filter(function(a) { return a.meeting_id === r.id && (a.status === 'open' || a.status === 'in_progress'); }).length;
    return r;
  });
}

/* ── GET all ── */
router.get('/', authenticate, validateProject, async function(req, res) {
  try {
    var sql = 'SELECT * FROM meetings WHERE project_id = $1';
    var params = [req.projectId];
    var idx = 2;
    if (req.query.status) { sql += ' AND status = $' + idx; params.push(req.query.status); idx++; }
    if (req.query.type) { sql += ' AND type = $' + idx; params.push(req.query.type); idx++; }
    sql += ' ORDER BY meeting_date DESC NULLS LAST, start_time DESC NULLS LAST';
    var { rows } = await db.query(sql, params);
    var enriched = await enrichMeetings(rows);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET single ── */
router.get('/:mtgId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows } = await db.query('SELECT * FROM meetings WHERE id = $1 AND project_id = $2', [req.params.mtgId, req.projectId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    var enriched = await enrichMeeting(rows[0]);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST create ── */
router.post('/', authenticate, validateProject, async function(req, res) {
  try {
    var b = req.body;
    if (!b.title) return res.status(400).json({ error: 'title is required' });

    var type = (b.type || 'oac').toLowerCase();
    if (MTG_TYPES.indexOf(type) === -1) return res.status(400).json({ error: 'Invalid type: ' + type });
    var status = (b.status || 'scheduled').toLowerCase();
    if (MTG_STATUSES.indexOf(status) === -1) return res.status(400).json({ error: 'Invalid status: ' + status });

    var meetingNumber = await getNextMeetingNumber(req.projectId);

    var { rows } = await db.query(
      `INSERT INTO meetings (project_id, title, type, status, meeting_number, meeting_date, start_time, end_time,
        location, virtual_link, minutes_exported, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.projectId, b.title, type, status, meetingNumber,
       b.meeting_date || null, b.start_time || null, b.end_time || null,
       b.location || null, b.virtual_link || null, b.minutes_exported || false, req.user.id]
    );
    var mtg = rows[0];

    /* insert attendees */
    if (Array.isArray(b.attendees)) {
      for (var i = 0; i < b.attendees.length; i++) {
        var att = b.attendees[i];
        if (att.user_id) {
          await db.query('INSERT INTO meeting_attendees (meeting_id, user_id, present) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [mtg.id, att.user_id, att.present || false]);
        }
      }
    }

    /* insert agenda items + action items */
    if (Array.isArray(b.agenda_items)) {
      for (var j = 0; j < b.agenda_items.length; j++) {
        var ai = b.agenda_items[j];
        var { rows: aiRows } = await db.query(
          'INSERT INTO meeting_agenda_items (meeting_id, number, title, description, presenter_id, duration_minutes, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [mtg.id, ai.number || (j + 1), ai.title || '', ai.description || '', ai.presenter_id || null, ai.duration_minutes || null, j]
        );
        if (Array.isArray(ai.action_items)) {
          for (var k = 0; k < ai.action_items.length; k++) {
            var ac = ai.action_items[k];
            var acStatus = (ac.status || 'open').toLowerCase();
            if (ACTION_STATUSES.indexOf(acStatus) === -1) acStatus = 'open';
            await db.query(
              'INSERT INTO meeting_action_items (meeting_id, agenda_item_id, description, assignee_id, due_date, status) VALUES ($1,$2,$3,$4,$5,$6)',
              [mtg.id, aiRows[0].id, ac.description || '', ac.assignee_id || null, ac.due_date || null, acStatus]
            );
          }
        }
      }
    }

    await logChange('meetings', mtg.id, 'INSERT', null, null, JSON.stringify(mtg), req.user.id);
    var enriched = await enrichMeeting(mtg);
    res.status(201).json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT update ── */
router.put('/:mtgId', authenticate, validateProject, async function(req, res) {
  try {
    var { rows: existing } = await db.query('SELECT * FROM meetings WHERE id = $1 AND project_id = $2', [req.params.mtgId, req.projectId]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    var old = existing[0];
    var b = req.body;

    /* status machine */
    if (b.status !== undefined) {
      var newStatus = b.status.toLowerCase();
      if (MTG_STATUSES.indexOf(newStatus) === -1) return res.status(400).json({ error: 'Invalid status: ' + newStatus });
      var allowed = MTG_TRANSITIONS[old.status] || [];
      if (newStatus !== old.status && allowed.indexOf(newStatus) === -1) {
        return res.status(400).json({ error: 'Cannot transition from ' + old.status + ' to ' + newStatus + '. Allowed: ' + allowed.join(', ') });
      }
      b.status = newStatus;
    }

    /* type validation */
    if (b.type !== undefined) {
      b.type = b.type.toLowerCase();
      if (MTG_TYPES.indexOf(b.type) === -1) return res.status(400).json({ error: 'Invalid type: ' + b.type });
    }

    var fields = ['title', 'type', 'status', 'meeting_date', 'start_time', 'end_time', 'location', 'virtual_link', 'minutes_exported'];
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
    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      vals.push(req.params.mtgId);
      await db.query('UPDATE meetings SET ' + sets.join(', ') + ' WHERE id = $' + idx, vals);
    }

    /* replace attendees if provided */
    if (Array.isArray(b.attendees)) {
      await db.query('DELETE FROM meeting_attendees WHERE meeting_id = $1', [old.id]);
      for (var j = 0; j < b.attendees.length; j++) {
        var att = b.attendees[j];
        if (att.user_id) {
          await db.query('INSERT INTO meeting_attendees (meeting_id, user_id, present) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [old.id, att.user_id, att.present || false]);
        }
      }
    }

    /* replace agenda items + action items if provided */
    if (Array.isArray(b.agenda_items)) {
      /* delete old action items linked to old agenda items */
      await db.query('DELETE FROM meeting_action_items WHERE meeting_id = $1', [old.id]);
      await db.query('DELETE FROM meeting_agenda_items WHERE meeting_id = $1', [old.id]);
      for (var m = 0; m < b.agenda_items.length; m++) {
        var ai = b.agenda_items[m];
        var { rows: aiRows } = await db.query(
          'INSERT INTO meeting_agenda_items (meeting_id, number, title, description, presenter_id, duration_minutes, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [old.id, ai.number || (m + 1), ai.title || '', ai.description || '', ai.presenter_id || null, ai.duration_minutes || null, m]
        );
        if (Array.isArray(ai.action_items)) {
          for (var n = 0; n < ai.action_items.length; n++) {
            var ac = ai.action_items[n];
            var acStatus = (ac.status || 'open').toLowerCase();
            if (ACTION_STATUSES.indexOf(acStatus) === -1) acStatus = 'open';
            await db.query(
              'INSERT INTO meeting_action_items (meeting_id, agenda_item_id, description, assignee_id, due_date, status, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [old.id, aiRows[0].id, ac.description || '', ac.assignee_id || null, ac.due_date || null, acStatus, acStatus === 'completed' ? 'NOW()' : null]
            );
          }
        }
      }
    }

    await logChange('meetings', old.id, 'UPDATE', null, null, JSON.stringify(b), req.user.id);
    var { rows: updated } = await db.query('SELECT * FROM meetings WHERE id = $1', [old.id]);
    var enriched = await enrichMeeting(updated[0]);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── DELETE ── */
router.delete('/:mtgId', authenticate, validateProject, async function(req, res) {
  try {
    /* CASCADE handles attendees/agenda/actions */
    var { rows } = await db.query('DELETE FROM meetings WHERE id = $1 AND project_id = $2 RETURNING *', [req.params.mtgId, req.projectId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logChange('meetings', rows[0].id, 'DELETE', JSON.stringify(rows[0]), null, null, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PATCH action item status ── */
router.patch('/:mtgId/actions/:actionId', authenticate, validateProject, async function(req, res) {
  try {
    var b = req.body;
    var sets = [];
    var vals = [];
    var idx = 1;
    if (b.status !== undefined) {
      var s = b.status.toLowerCase();
      if (ACTION_STATUSES.indexOf(s) === -1) return res.status(400).json({ error: 'Invalid action status' });
      sets.push('status = $' + idx); vals.push(s); idx++;
      if (s === 'completed') { sets.push('completed_at = NOW()'); }
    }
    if (b.description !== undefined) { sets.push('description = $' + idx); vals.push(b.description); idx++; }
    if (b.assignee_id !== undefined) { sets.push('assignee_id = $' + idx); vals.push(b.assignee_id); idx++; }
    if (b.due_date !== undefined) { sets.push('due_date = $' + idx); vals.push(b.due_date); idx++; }
    if (!sets.length) return res.status(400).json({ error: 'No fields' });
    vals.push(req.params.actionId);
    vals.push(req.params.mtgId);
    var { rows } = await db.query(
      'UPDATE meeting_action_items SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' AND meeting_id = $' + (idx + 1) + ' RETURNING *',
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Action item not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
