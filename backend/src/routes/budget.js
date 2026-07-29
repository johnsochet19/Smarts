const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// Auto-create budget_items table + budget_versions table
(async function() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS budget_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      budget_version_id INTEGER,
      category VARCHAR(255) DEFAULT '',
      description VARCHAR(500) DEFAULT '',
      vendor VARCHAR(255) DEFAULT '',
      estimated NUMERIC(12,2) DEFAULT 0,
      actual NUMERIC(12,2) DEFAULT 0,
      status VARCHAR(50) DEFAULT 'pending',
      notes TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS budget_versions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT 'Default Budget',
      sheet_url TEXT DEFAULT '',
      last_sync_at TIMESTAMP,
      auto_sync BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    // Add budget_version_id column if it doesn't exist
    try { await db.query('ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS budget_version_id INTEGER'); } catch(e) {}
    console.log('Budget tables ready');
  } catch(e) { console.error('Budget table error:', e.message); }
})();

// --- Budget Versions ---

// GET all budget versions for a project
router.get('/:projectId/versions', authenticate, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM budget_versions WHERE project_id = $1 ORDER BY created_at DESC', [req.params.projectId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST create budget version
router.post('/:projectId/versions', authenticate, async (req, res) => {
  try {
    const { name, sheet_url } = req.body;
    const r = await db.query(
      'INSERT INTO budget_versions (project_id, name, sheet_url) VALUES ($1,$2,$3) RETURNING *',
      [req.params.projectId, name || 'Untitled Budget', sheet_url || '']
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT update budget version (name, sheet_url, auto_sync, last_sync_at)
router.put('/:projectId/versions/:versionId', authenticate, async (req, res) => {
  try {
    const { name, sheet_url, auto_sync, last_sync_at } = req.body;
    const r = await db.query(
      `UPDATE budget_versions SET name=COALESCE($1,name), sheet_url=COALESCE($2,sheet_url), auto_sync=COALESCE($3,auto_sync), last_sync_at=COALESCE($4,last_sync_at) WHERE id=$5 AND project_id=$6 RETURNING *`,
      [name, sheet_url, auto_sync, last_sync_at, req.params.versionId, req.params.projectId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE budget version and its items
router.delete('/:projectId/versions/:versionId', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM budget_items WHERE budget_version_id=$1 AND project_id=$2', [req.params.versionId, req.params.projectId]);
    await db.query('DELETE FROM budget_versions WHERE id=$1 AND project_id=$2', [req.params.versionId, req.params.projectId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- Budget Items (scoped to version) ---

// GET all budget items for a project (optionally filtered by version)
router.get('/:projectId', authenticate, async (req, res) => {
  try {
    const versionId = req.query.versionId;
    let r;
    if (versionId) {
      r = await db.query('SELECT * FROM budget_items WHERE project_id = $1 AND budget_version_id = $2 ORDER BY sort_order, id', [req.params.projectId, versionId]);
    } else {
      r = await db.query('SELECT * FROM budget_items WHERE project_id = $1 ORDER BY sort_order, id', [req.params.projectId]);
    }
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST create budget item
router.post('/:projectId', authenticate, async (req, res) => {
  try {
    const { category, description, vendor, estimated, actual, status, notes, sort_order, budget_version_id } = req.body;
    const r = await db.query(
      `INSERT INTO budget_items (project_id, budget_version_id, category, description, vendor, estimated, actual, status, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.projectId, budget_version_id || null, category || '', description || '', vendor || '', estimated || 0, actual || 0, status || 'pending', notes || '', sort_order || 0]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST bulk create (for import)
router.post('/:projectId/bulk', authenticate, async (req, res) => {
  try {
    const items = req.body.items || [];
    const budget_version_id = req.body.budget_version_id || null;
    const results = [];
    for (const item of items) {
      const r = await db.query(
        `INSERT INTO budget_items (project_id, budget_version_id, category, description, vendor, estimated, actual, status, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.params.projectId, budget_version_id, item.category || '', item.description || '', item.vendor || '', item.estimated || 0, item.actual || 0, item.status || 'pending', item.notes || '', item.sort_order || 0]
      );
      results.push(r.rows[0]);
    }
    res.json({ imported: results.length, items: results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST import from Google Sheets URL
router.post('/:projectId/import-sheets', authenticate, async (req, res) => {
  try {
    const { sheet_url, budget_version_id } = req.body;
    if (!sheet_url) return res.status(400).json({ error: 'sheet_url is required' });

    // Extract spreadsheet ID from URL
    const match = sheet_url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return res.status(400).json({ error: 'Invalid Google Sheets URL' });
    const spreadsheetId = match[1];

    // Use the public CSV export approach (works for public sheets)
    // or use the Google Sheets API with stored tokens
    let rows = [];
    try {
      // Try googleapis first if tokens available (handles shared/private sheets)
      const { google } = require('googleapis');
      const tokenRow = await db.query('SELECT * FROM google_tokens WHERE id = 1');
      if (tokenRow.rows.length > 0 && tokenRow.rows[0].access_token) {
        const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
        const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
        const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://scheduler-production-f3e1.up.railway.app/api/google/callback';
        const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
        oauth2Client.setCredentials({
          access_token: tokenRow.rows[0].access_token,
          refresh_token: tokenRow.rows[0].refresh_token,
          expiry_date: parseInt(tokenRow.rows[0].expires_at) || 0,
        });
        // Auto-refresh if expired
        if (Date.now() > (parseInt(tokenRow.rows[0].expires_at) || 0) - 60000) {
          try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            await db.query(`UPDATE google_tokens SET access_token=$1, refresh_token=COALESCE($2, refresh_token), expires_at=$3 WHERE id=1`,
              [credentials.access_token, credentials.refresh_token || null, credentials.expiry_date || (Date.now() + 3600000)]);
            oauth2Client.setCredentials(credentials);
          } catch(refreshErr) {
            console.error('Token refresh failed during sheet import:', refreshErr.message);
          }
        }
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId,
          range: 'A1:Z1000',
        });
        rows = response.data.values || [];
      } else {
        // Fallback: try public CSV export
        const fetch = require('node-fetch');
        const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
        const csvRes = await fetch(csvUrl);
        if (!csvRes.ok) throw new Error('Sheet not accessible. Connect your Google account first to import shared sheets.');
        const csvText = await csvRes.text();
        rows = csvText.split('\n').map(r => r.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
      }
    } catch(fetchErr) {
      return res.status(400).json({ error: 'Failed to fetch sheet: ' + fetchErr.message });
    }

    if (rows.length < 2) return res.status(400).json({ error: 'Sheet has no data rows' });

    // First row = headers
    const headers = rows[0].map(h => (h || '').toLowerCase().trim());
    const dataRows = rows.slice(1).filter(r => r.some(c => c && c.trim()));

    // Auto-map columns
    function findCol(names) {
      for (const n of names) {
        const idx = headers.findIndex(h => h.includes(n));
        if (idx >= 0) return idx;
      }
      return -1;
    }
    const catIdx = findCol(['category', 'cat', 'division']);
    const descIdx = findCol(['description', 'desc', 'item', 'line item', 'name']);
    const vendorIdx = findCol(['vendor', 'subcontractor', 'sub', 'contractor']);
    const estIdx = findCol(['estimated', 'estimate', 'budget', 'budgeted', 'amount', 'cost']);
    const actIdx = findCol(['actual', 'spent', 'cost to date']);
    const notesIdx = findCol(['notes', 'note', 'comments', 'comment']);

    const budgetItems = dataRows.map((row, i) => ({
      category: catIdx >= 0 ? (row[catIdx] || '') : '',
      description: descIdx >= 0 ? (row[descIdx] || '') : (row[0] || ''),
      vendor: vendorIdx >= 0 ? (row[vendorIdx] || '') : '',
      estimated: estIdx >= 0 ? parseFloat((row[estIdx] || '0').replace(/[^0-9.-]/g, '')) || 0 : 0,
      actual: actIdx >= 0 ? parseFloat((row[actIdx] || '0').replace(/[^0-9.-]/g, '')) || 0 : 0,
      notes: notesIdx >= 0 ? (row[notesIdx] || '') : '',
      status: 'pending',
      sort_order: i,
    })).filter(item => item.description || item.category);

    // If we have a version, clear existing items for it first
    if (budget_version_id) {
      await db.query('DELETE FROM budget_items WHERE budget_version_id=$1 AND project_id=$2', [budget_version_id, req.params.projectId]);
    }

    const results = [];
    for (const item of budgetItems) {
      const r = await db.query(
        `INSERT INTO budget_items (project_id, budget_version_id, category, description, vendor, estimated, actual, status, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.params.projectId, budget_version_id || null, item.category, item.description, item.vendor, item.estimated, item.actual, item.status, item.notes, item.sort_order]
      );
      results.push(r.rows[0]);
    }

    // Update version with sheet URL and sync time
    if (budget_version_id) {
      await db.query('UPDATE budget_versions SET sheet_url=$1, last_sync_at=NOW() WHERE id=$2', [sheet_url, budget_version_id]);
    }

    res.json({ imported: results.length, items: results, headers: headers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT bulk-save all budget items (upsert existing, insert new, delete removed)
router.put('/:projectId/bulk-save', authenticate, async (req, res) => {
  try {
    const { items, budget_version_id } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items array is required' });
    const projectId = req.params.projectId;

    // Get existing item IDs for this project/version
    let existingQuery = 'SELECT id FROM budget_items WHERE project_id = $1';
    const params = [projectId];
    if (budget_version_id) {
      existingQuery += ' AND budget_version_id = $2';
      params.push(budget_version_id);
    }
    const existingRows = await db.query(existingQuery, params);
    const existingIds = new Set(existingRows.rows.map(r => r.id));

    const incomingIds = new Set();
    const results = [];

    for (const item of items) {
      if (item.id && existingIds.has(item.id)) {
        // Update existing item
        incomingIds.add(item.id);
        const r = await db.query(
          `UPDATE budget_items SET category=$1, description=$2, vendor=$3, estimated=$4, actual=$5, status=$6, notes=$7, sort_order=$8, updated_at=NOW()
           WHERE id=$9 AND project_id=$10 RETURNING *`,
          [item.category || '', item.description || '', item.vendor || '', item.estimated || 0, item.actual || 0, item.status || 'pending', item.notes || '', item.sort_order || 0, item.id, projectId]
        );
        if (r.rows.length > 0) results.push(r.rows[0]);
      } else {
        // Insert new item
        const r = await db.query(
          `INSERT INTO budget_items (project_id, budget_version_id, category, description, vendor, estimated, actual, status, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [projectId, budget_version_id || null, item.category || '', item.description || '', item.vendor || '', item.estimated || 0, item.actual || 0, item.status || 'pending', item.notes || '', item.sort_order || 0]
        );
        results.push(r.rows[0]);
      }
    }

    // Delete items that were removed on the client
    for (const existingId of existingIds) {
      if (!incomingIds.has(existingId)) {
        await db.query('DELETE FROM budget_items WHERE id=$1 AND project_id=$2', [existingId, projectId]);
      }
    }

    res.json({ saved: results.length, items: results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT update budget item
router.put('/:projectId/:id', authenticate, async (req, res) => {
  try {
    const { category, description, vendor, estimated, actual, status, notes, sort_order } = req.body;
    const r = await db.query(
      `UPDATE budget_items SET category=$1, description=$2, vendor=$3, estimated=$4, actual=$5, status=$6, notes=$7, sort_order=$8, updated_at=NOW()
       WHERE id=$9 AND project_id=$10 RETURNING *`,
      [category, description, vendor, estimated, actual, status, notes, sort_order, req.params.id, req.params.projectId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE budget item
router.delete('/:projectId/:id', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM budget_items WHERE id=$1 AND project_id=$2', [req.params.id, req.params.projectId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE all budget items for a project (for reimport)
router.delete('/:projectId', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM budget_items WHERE project_id=$1', [req.params.projectId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
