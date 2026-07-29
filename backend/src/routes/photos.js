const router = require('express').Router({ mergeParams: true });
const db = require('../db');

// ── Schema migration (IIFE) ───────────────────────────────────────────
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS photo_albums (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      album_id INTEGER REFERENCES photo_albums(id) ON DELETE SET NULL,
      file_url VARCHAR(500),
      thumbnail_url VARCHAR(500),
      caption TEXT,
      location VARCHAR(255),
      gps_lat DECIMAL(10,7),
      gps_lng DECIMAL(10,7),
      taken_at TIMESTAMP,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TIMESTAMP DEFAULT NOW(),
      linked_log_id INTEGER,
      linked_inspection_id INTEGER,
      linked_punch_item_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Add columns that may be missing on older installs
    const photoCols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='photos'`)).rows.map(r => r.column_name);
    const addP = async (col, def) => { if (!photoCols.includes(col)) await db.query(`ALTER TABLE photos ADD COLUMN ${col} ${def}`); };
    await addP('thumbnail_url', 'VARCHAR(500)');
    await addP('gps_lat', 'DECIMAL(10,7)');
    await addP('gps_lng', 'DECIMAL(10,7)');
    await addP('uploaded_by', 'INTEGER REFERENCES users(id)');
    await addP('linked_log_id', 'INTEGER');
    await addP('linked_inspection_id', 'INTEGER');
    await addP('linked_punch_item_id', 'INTEGER');

    const albumCols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='photo_albums'`)).rows.map(r => r.column_name);
    if (!albumCols.includes('sort_order')) await db.query(`ALTER TABLE photo_albums ADD COLUMN sort_order INTEGER DEFAULT 0`);

    // Legacy migration: taken_by → uploaded_by, linked_daily_log_id → linked_log_id
    if (photoCols.includes('taken_by') && photoCols.includes('uploaded_by')) {
      await db.query(`UPDATE photos SET uploaded_by = taken_by WHERE uploaded_by IS NULL AND taken_by IS NOT NULL`);
    }
    if (photoCols.includes('linked_daily_log_id') && photoCols.includes('linked_log_id')) {
      await db.query(`UPDATE photos SET linked_log_id = linked_daily_log_id WHERE linked_log_id IS NULL AND linked_daily_log_id IS NOT NULL`);
    }

    console.log('[photos] tables ready');
  } catch (err) {
    console.error('[photos] migration error:', err.message);
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
async function enrichPhotos(rows) {
  if (!rows.length) return rows;
  const userIds = [...new Set(rows.map(r => r.uploaded_by).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const { rows: users } = await db.query('SELECT id, name, email FROM users WHERE id = ANY($1)', [userIds]);
    users.forEach(u => { userMap[u.id] = u; });
  }
  const albumIds = [...new Set(rows.map(r => r.album_id).filter(Boolean))];
  const albumMap = {};
  if (albumIds.length) {
    const { rows: albums } = await db.query('SELECT id, name FROM photo_albums WHERE id = ANY($1)', [albumIds]);
    albums.forEach(a => { albumMap[a.id] = a; });
  }
  return rows.map(r => {
    const uploader = userMap[r.uploaded_by];
    const album = albumMap[r.album_id];
    return {
      ...r,
      uploaded_by_name: uploader ? uploader.name : null,
      album_name: album ? album.name : null
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ALBUM ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ── GET /albums ──────────────────────────────────────────────────────
router.get('/albums', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const { rows } = await db.query(
      `SELECT a.*, (SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id) as photo_count
       FROM photo_albums a WHERE a.project_id = $1 ORDER BY a.sort_order ASC, a.name ASC`,
      [pid]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /albums ─────────────────────────────────────────────────────
router.post('/albums', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.body.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const { rows } = await db.query(
      `INSERT INTO photo_albums (project_id, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [pid, b.name, b.description || null, b.sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /albums/:albumId ─────────────────────────────────────────────
router.put('/albums/:albumId', async (req, res) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM photo_albums WHERE id=$1', [req.params.albumId]);
    if (!existing.length) return res.status(404).json({ error: 'Album not found' });
    const old = existing[0];
    const b = req.body;
    const { rows } = await db.query(
      `UPDATE photo_albums SET name=$1, description=$2, sort_order=$3 WHERE id=$4 RETURNING *`,
      [
        b.name !== undefined ? b.name : old.name,
        b.description !== undefined ? b.description : old.description,
        b.sort_order !== undefined ? b.sort_order : old.sort_order,
        req.params.albumId
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /albums/:albumId ──────────────────────────────────────────
router.delete('/albums/:albumId', async (req, res) => {
  try {
    await db.query('UPDATE photos SET album_id = NULL WHERE album_id = $1', [req.params.albumId]);
    const { rowCount } = await db.query('DELETE FROM photo_albums WHERE id=$1', [req.params.albumId]);
    if (!rowCount) return res.status(404).json({ error: 'Album not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PHOTO ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ── GET / ─ list photos ──────────────────────────────────────────────
router.get('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    let where = 'WHERE p.project_id=$1';
    const params = [pid];
    let idx = 2;
    if (req.query.album_id) { where += ` AND p.album_id=$${idx++}`; params.push(req.query.album_id); }
    if (req.query.linked_log_id) { where += ` AND p.linked_log_id=$${idx++}`; params.push(req.query.linked_log_id); }
    if (req.query.linked_inspection_id) { where += ` AND p.linked_inspection_id=$${idx++}`; params.push(req.query.linked_inspection_id); }
    if (req.query.linked_punch_item_id) { where += ` AND p.linked_punch_item_id=$${idx++}`; params.push(req.query.linked_punch_item_id); }
    const { rows } = await db.query(`SELECT p.* FROM photos p ${where} ORDER BY p.taken_at DESC NULLS LAST, p.uploaded_at DESC`, params);
    const enriched = await enrichPhotos(rows);
    res.json(enriched);
  } catch (err) {
    console.error('[photos] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /summary ─────────────────────────────────────────────────────
router.get('/summary', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const { rows } = await db.query('SELECT * FROM photos WHERE project_id=$1', [pid]);
    const { rows: albums } = await db.query('SELECT COUNT(*) as cnt FROM photo_albums WHERE project_id=$1', [pid]);
    let geoTagged = 0, linkedLogs = 0, linkedInspections = 0, linkedPunch = 0;
    rows.forEach(p => {
      if (p.gps_lat && p.gps_lng) geoTagged++;
      if (p.linked_log_id) linkedLogs++;
      if (p.linked_inspection_id) linkedInspections++;
      if (p.linked_punch_item_id) linkedPunch++;
    });
    res.json({ total: rows.length, album_count: Number(albums[0].cnt), geo_tagged: geoTagged, linked_logs: linkedLogs, linked_inspections: linkedInspections, linked_punch: linkedPunch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:photoId ────────────────────────────────────────────────────
router.get('/:photoId', validateProject, async (req, res) => {
  try {
    if (['albums', 'summary'].includes(req.params.photoId)) return;
    const { rows } = await db.query('SELECT * FROM photos WHERE id=$1', [req.params.photoId]);
    if (!rows.length) return res.status(404).json({ error: 'Photo not found' });
    const enriched = await enrichPhotos(rows);
    res.json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ─ create photo ────────────────────────────────────────────
router.post('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.body.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const b = req.body;
    const { rows } = await db.query(
      `INSERT INTO photos (project_id, album_id, file_url, thumbnail_url, caption, location,
        gps_lat, gps_lng, taken_at, uploaded_by, linked_log_id, linked_inspection_id, linked_punch_item_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [pid, b.album_id || null, b.file_url || null, b.thumbnail_url || null,
        b.caption || null, b.location || null, b.gps_lat || null, b.gps_lng || null,
        b.taken_at || null, b.uploaded_by || null,
        b.linked_log_id || null, b.linked_inspection_id || null, b.linked_punch_item_id || null]
    );
    const enriched = await enrichPhotos(rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    console.error('[photos] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:photoId ─ update photo ─────────────────────────────────────
router.put('/:photoId', validateProject, async (req, res) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM photos WHERE id=$1', [req.params.photoId]);
    if (!existing.length) return res.status(404).json({ error: 'Photo not found' });
    const old = existing[0];
    const b = req.body;
    const { rows } = await db.query(
      `UPDATE photos SET album_id=$1, file_url=$2, thumbnail_url=$3, caption=$4, location=$5,
        gps_lat=$6, gps_lng=$7, taken_at=$8, uploaded_by=$9,
        linked_log_id=$10, linked_inspection_id=$11, linked_punch_item_id=$12, updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [
        b.album_id !== undefined ? b.album_id : old.album_id,
        b.file_url !== undefined ? b.file_url : old.file_url,
        b.thumbnail_url !== undefined ? b.thumbnail_url : old.thumbnail_url,
        b.caption !== undefined ? b.caption : old.caption,
        b.location !== undefined ? b.location : old.location,
        b.gps_lat !== undefined ? b.gps_lat : old.gps_lat,
        b.gps_lng !== undefined ? b.gps_lng : old.gps_lng,
        b.taken_at !== undefined ? b.taken_at : old.taken_at,
        b.uploaded_by !== undefined ? b.uploaded_by : old.uploaded_by,
        b.linked_log_id !== undefined ? b.linked_log_id : old.linked_log_id,
        b.linked_inspection_id !== undefined ? b.linked_inspection_id : old.linked_inspection_id,
        b.linked_punch_item_id !== undefined ? b.linked_punch_item_id : old.linked_punch_item_id,
        req.params.photoId
      ]
    );
    const enriched = await enrichPhotos(rows);
    res.json(enriched[0]);
  } catch (err) {
    console.error('[photos] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:photoId ─────────────────────────────────────────────────
router.delete('/:photoId', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM photos WHERE id=$1', [req.params.photoId]);
    if (!rowCount) return res.status(404).json({ error: 'Photo not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
