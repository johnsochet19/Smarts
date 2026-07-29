const router = require('express').Router({ mergeParams: true });
const db = require('../db');

// ── Constants ──────────────────────────────────────────────────────────
const DOC_FILE_TYPES = ['pdf', 'dwg', 'dxf', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'jpg', 'jpeg', 'png', 'tiff', 'bmp', 'csv', 'txt', 'zip', 'rar', 'ifc', 'rvt', 'skp', 'other'];

// ── Schema migration (IIFE) ───────────────────────────────────────────
(async () => {
  try {
    // document_folders table
    await db.query(`CREATE TABLE IF NOT EXISTS document_folders (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      parent_folder_id INTEGER REFERENCES document_folders(id) ON DELETE CASCADE,
      box_folder_id VARCHAR(255),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // documents table (new schema)
    await db.query(`CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      folder_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      file_url VARCHAR(500),
      file_size INTEGER DEFAULT 0,
      file_type VARCHAR(50),
      version_number INTEGER DEFAULT 1,
      previous_version_id INTEGER REFERENCES documents(id),
      box_file_id VARCHAR(255),
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at TIMESTAMP DEFAULT NOW(),
      description TEXT,
      tags JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Add columns that may be missing on older installs
    const docCols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='documents'`)).rows.map(r => r.column_name);
    const addDoc = async (col, def) => { if (!docCols.includes(col)) await db.query(`ALTER TABLE documents ADD COLUMN ${col} ${def}`); };
    await addDoc('folder_id', 'INTEGER REFERENCES document_folders(id) ON DELETE SET NULL');
    await addDoc('previous_version_id', 'INTEGER REFERENCES documents(id)');
    await addDoc('box_file_id', 'VARCHAR(255)');
    await addDoc('tags', "JSONB DEFAULT '[]'::jsonb");
    await addDoc('description', 'TEXT');
    await addDoc('updated_at', 'TIMESTAMP DEFAULT NOW()');

    const folderCols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='document_folders'`)).rows.map(r => r.column_name);
    const addFolder = async (col, def) => { if (!folderCols.includes(col)) await db.query(`ALTER TABLE document_folders ADD COLUMN ${col} ${def}`); };
    await addFolder('box_folder_id', 'VARCHAR(255)');
    await addFolder('created_by', 'INTEGER REFERENCES users(id)');

    // Legacy migration: migrate project_documents → documents if old table exists
    const { rows: oldTableCheck } = await db.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='project_documents') as exists`);
    if (oldTableCheck[0].exists) {
      const { rows: oldDocs } = await db.query(`SELECT * FROM project_documents WHERE id NOT IN (SELECT COALESCE(previous_version_id, 0) FROM documents WHERE previous_version_id IS NOT NULL) LIMIT 0`);
      // Count how many we haven't migrated yet
      const { rows: countCheck } = await db.query(`SELECT COUNT(*) as cnt FROM project_documents pd WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.name = pd.name AND d.project_id = pd.project_id AND d.file_url = pd.file_url)`);
      if (Number(countCheck[0].cnt) > 0) {
        const { rows: toMigrate } = await db.query(`SELECT pd.* FROM project_documents pd WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.name = pd.name AND d.project_id = pd.project_id AND d.file_url = pd.file_url)`);
        for (const doc of toMigrate) {
          // Create folder if folder_path specified
          let folderId = null;
          if (doc.folder_path && doc.folder_path !== '/') {
            const folderName = doc.folder_path.replace(/^\//, '').replace(/\/$/, '');
            const { rows: existing } = await db.query(`SELECT id FROM document_folders WHERE project_id=$1 AND name=$2 AND parent_folder_id IS NULL`, [doc.project_id, folderName]);
            if (existing.length) {
              folderId = existing[0].id;
            } else {
              const { rows: created } = await db.query(`INSERT INTO document_folders (project_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`, [doc.project_id, folderName, doc.uploaded_by || doc.created_by]);
              folderId = created[0].id;
            }
          }
          await db.query(
            `INSERT INTO documents (project_id, folder_id, name, file_url, file_size, file_type, version_number, uploaded_by, uploaded_at, description, tags)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [doc.project_id, folderId, doc.name, doc.file_url, doc.file_size || 0, doc.file_type,
              doc.version_number || 1, doc.uploaded_by, doc.uploaded_at || doc.created_at,
              doc.description, '[]']
          );
        }
        if (toMigrate.length) console.log('[documents] migrated', toMigrate.length, 'from project_documents');
      }
    }

    console.log('[documents] tables ready');
  } catch (err) {
    console.error('[documents] migration error:', err.message);
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
async function enrichDocuments(rows) {
  if (!rows.length) return rows;
  const userIds = [...new Set(rows.map(r => r.uploaded_by).filter(Boolean))];
  const userMap = {};
  if (userIds.length) {
    const { rows: users } = await db.query('SELECT id, name, email FROM users WHERE id = ANY($1)', [userIds]);
    users.forEach(u => { userMap[u.id] = u; });
  }
  // Load folder names
  const folderIds = [...new Set(rows.map(r => r.folder_id).filter(Boolean))];
  const folderMap = {};
  if (folderIds.length) {
    const { rows: folders } = await db.query('SELECT id, name, parent_folder_id FROM document_folders WHERE id = ANY($1)', [folderIds]);
    folders.forEach(f => { folderMap[f.id] = f; });
  }
  return rows.map(r => {
    const uploader = userMap[r.uploaded_by];
    const folder = folderMap[r.folder_id];
    return {
      ...r,
      tags: r.tags || [],
      uploaded_by_name: uploader ? uploader.name : null,
      folder_name: folder ? folder.name : null
    };
  });
}

// ── GET /folders ─ list folders for project ──────────────────────────
router.get('/folders', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const { rows } = await db.query(
      `SELECT df.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM documents d WHERE d.folder_id = df.id) as doc_count
       FROM document_folders df
       LEFT JOIN users u ON u.id = df.created_by
       WHERE df.project_id = $1
       ORDER BY df.name ASC`, [pid]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /folders ─ create folder ────────────────────────────────────
router.post('/folders', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.body.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const { rows } = await db.query(
      `INSERT INTO document_folders (project_id, name, parent_folder_id, box_folder_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pid, b.name, b.parent_folder_id || null, b.box_folder_id || null, b.created_by || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /folders/:folderId ─ rename folder ───────────────────────────
router.put('/folders/:folderId', validateProject, async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await db.query(
      `UPDATE document_folders SET name=COALESCE($1, name), parent_folder_id=$2, box_folder_id=COALESCE($3, box_folder_id)
       WHERE id=$4 RETURNING *`,
      [b.name || null, b.parent_folder_id !== undefined ? b.parent_folder_id : null, b.box_folder_id || null, req.params.folderId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Folder not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /folders/:folderId ────────────────────────────────────────
router.delete('/folders/:folderId', async (req, res) => {
  try {
    // Move documents in this folder to no folder
    await db.query('UPDATE documents SET folder_id = NULL WHERE folder_id = $1', [req.params.folderId]);
    const { rowCount } = await db.query('DELETE FROM document_folders WHERE id=$1', [req.params.folderId]);
    if (!rowCount) return res.status(404).json({ error: 'Folder not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / ─ list documents ───────────────────────────────────────────
router.get('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    let where = 'WHERE d.project_id=$1';
    const params = [pid];
    let idx = 2;
    if (req.query.folder_id) { where += ` AND d.folder_id=$${idx++}`; params.push(req.query.folder_id); }
    if (req.query.file_type) { where += ` AND d.file_type=$${idx++}`; params.push(req.query.file_type); }
    if (req.query.tag) { where += ` AND d.tags @> $${idx++}::jsonb`; params.push(JSON.stringify([req.query.tag])); }
    if (req.query.search) {
      where += ` AND (d.name ILIKE $${idx} OR d.description ILIKE $${idx})`;
      params.push('%' + req.query.search + '%'); idx++;
    }
    const { rows } = await db.query(`SELECT d.* FROM documents d ${where} ORDER BY d.uploaded_at DESC`, params);
    const enriched = await enrichDocuments(rows);
    res.json(enriched);
  } catch (err) {
    console.error('[documents] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /summary ─────────────────────────────────────────────────────
router.get('/summary', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.query.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const { rows } = await db.query('SELECT * FROM documents WHERE project_id=$1', [pid]);
    const { rows: folders } = await db.query('SELECT COUNT(*) as cnt FROM document_folders WHERE project_id=$1', [pid]);
    const by_type = {};
    let totalSize = 0;
    rows.forEach(d => {
      const ft = d.file_type || 'other';
      by_type[ft] = (by_type[ft] || 0) + 1;
      totalSize += Number(d.file_size || 0);
    });
    res.json({ total: rows.length, folder_count: Number(folders[0].cnt), total_size: totalSize, by_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:docId ──────────────────────────────────────────────────────
router.get('/:docId', validateProject, async (req, res) => {
  try {
    if (['folders', 'summary'].includes(req.params.docId)) return;
    const { rows } = await db.query('SELECT * FROM documents WHERE id=$1', [req.params.docId]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });
    const enriched = await enrichDocuments(rows);
    // Load version history
    const { rows: versions } = await db.query(
      `SELECT id, version_number, file_url, file_size, uploaded_at, uploaded_by FROM documents
       WHERE name = $1 AND project_id = $2 ORDER BY version_number DESC`,
      [rows[0].name, rows[0].project_id]
    );
    enriched[0].versions = versions;
    res.json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ─ create document ─────────────────────────────────────────
router.post('/', validateProject, async (req, res) => {
  try {
    const pid = req.projectId || req.body.project_id;
    if (!pid) return res.status(400).json({ error: 'project_id required' });
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const tags = Array.isArray(b.tags) ? JSON.stringify(b.tags) : (b.tags || '[]');
    const { rows } = await db.query(
      `INSERT INTO documents (project_id, folder_id, name, file_url, file_size, file_type,
        version_number, previous_version_id, box_file_id, uploaded_by, description, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [pid, b.folder_id || null, b.name, b.file_url || null, b.file_size || 0,
        b.file_type || null, b.version_number || 1, b.previous_version_id || null,
        b.box_file_id || null, b.uploaded_by || null, b.description || null, tags]
    );
    const enriched = await enrichDocuments(rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    console.error('[documents] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:docId/version ─ create new version ────────────────────────
router.post('/:docId/version', validateProject, async (req, res) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM documents WHERE id=$1', [req.params.docId]);
    if (!existing.length) return res.status(404).json({ error: 'Document not found' });
    const orig = existing[0];
    const b = req.body;
    const tags = b.tags !== undefined ? (Array.isArray(b.tags) ? JSON.stringify(b.tags) : b.tags) : JSON.stringify(orig.tags || []);
    const { rows } = await db.query(
      `INSERT INTO documents (project_id, folder_id, name, file_url, file_size, file_type,
        version_number, previous_version_id, box_file_id, uploaded_by, description, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [orig.project_id, orig.folder_id, orig.name,
        b.file_url || orig.file_url, b.file_size || orig.file_size, b.file_type || orig.file_type,
        (orig.version_number || 1) + 1, orig.id,
        b.box_file_id || orig.box_file_id, b.uploaded_by || orig.uploaded_by,
        b.description || orig.description, tags]
    );
    const enriched = await enrichDocuments(rows);
    res.status(201).json(enriched[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:docId ─ update document ────────────────────────────────────
router.put('/:docId', validateProject, async (req, res) => {
  try {
    const { rows: existing } = await db.query('SELECT * FROM documents WHERE id=$1', [req.params.docId]);
    if (!existing.length) return res.status(404).json({ error: 'Document not found' });
    const old = existing[0];
    const b = req.body;
    const tags = b.tags !== undefined ? (Array.isArray(b.tags) ? JSON.stringify(b.tags) : b.tags) : JSON.stringify(old.tags || []);
    const { rows } = await db.query(
      `UPDATE documents SET folder_id=$1, name=$2, file_url=$3, file_size=$4, file_type=$5,
        box_file_id=$6, description=$7, tags=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [
        b.folder_id !== undefined ? b.folder_id : old.folder_id,
        b.name !== undefined ? b.name : old.name,
        b.file_url !== undefined ? b.file_url : old.file_url,
        b.file_size !== undefined ? b.file_size : old.file_size,
        b.file_type !== undefined ? b.file_type : old.file_type,
        b.box_file_id !== undefined ? b.box_file_id : old.box_file_id,
        b.description !== undefined ? b.description : old.description,
        tags,
        req.params.docId
      ]
    );
    const enriched = await enrichDocuments(rows);
    res.json(enriched[0]);
  } catch (err) {
    console.error('[documents] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:docId ───────────────────────────────────────────────────
router.delete('/:docId', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM documents WHERE id=$1', [req.params.docId]);
    if (!rowCount) return res.status(404).json({ error: 'Document not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
