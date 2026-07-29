const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const db = require('../db');

const CLIENT_ID = '52gmku42jwfowr1e0dusxpm6whs51uhh';
const CLIENT_SECRET = '3J8sHjF8sUmNr4ucW1V654ce4XZOQnlk';
const REDIRECT_URI = 'https://scheduler-production-f3e1.up.railway.app/api/box/callback';

var tokens = { access_token: '', refresh_token: '', expires_at: 0 };

async function initTokenTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS box_tokens (
    id INTEGER PRIMARY KEY DEFAULT 1,
    access_token TEXT, refresh_token TEXT, expires_at BIGINT,
    CHECK (id = 1)
  )`);
  var r = await db.query('SELECT * FROM box_tokens WHERE id = 1');
  if (r.rows.length > 0) {
    tokens.access_token = r.rows[0].access_token || '';
    tokens.refresh_token = r.rows[0].refresh_token || '';
    tokens.expires_at = parseInt(r.rows[0].expires_at) || 0;
    console.log('Box tokens loaded from DB');
  }
}
initTokenTable().catch(function(e) { console.error('Box token table init error:', e); });

async function saveTokens() {
  try {
    await db.query(`INSERT INTO box_tokens (id, access_token, refresh_token, expires_at)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET access_token=$1, refresh_token=$2, expires_at=$3`,
      [tokens.access_token, tokens.refresh_token, tokens.expires_at]);
  } catch(e) { console.error('Save tokens error:', e); }
}

async function refreshAccessToken() {
  if (!tokens.refresh_token) return false;
  try {
    var resp = await fetch('https://api.box.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
    });
    var data = await resp.json();
    if (data.access_token) {
      tokens.access_token = data.access_token;
      tokens.refresh_token = data.refresh_token;
      tokens.expires_at = Date.now() + (data.expires_in * 1000) - 60000;
      await saveTokens();
      console.log('Box token refreshed');
      return true;
    }
    console.error('Box refresh failed:', data);
    return false;
  } catch(e) { console.error('Box refresh error:', e); return false; }
}

async function getAuth() {
  if (!tokens.access_token) return null;
  if (Date.now() > tokens.expires_at) { var ok = await refreshAccessToken(); if (!ok) return null; }
  return { headers: { Authorization: 'Bearer ' + tokens.access_token } };
}

router.get('/auth', (req, res) => {
  res.json({ auth_url: 'https://account.box.com/api/oauth2/authorize?response_type=code&client_id=' + CLIENT_ID + '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) });
});

router.get('/callback', async (req, res) => {
  var code = req.query.code;
  if (!code) return res.status(400).send('No auth code');
  try {
    var resp = await fetch('https://api.box.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
    });
    var data = await resp.json();
    if (data.access_token) {
      tokens.access_token = data.access_token;
      tokens.refresh_token = data.refresh_token;
      tokens.expires_at = Date.now() + (data.expires_in * 1000) - 60000;
      await saveTokens();
      res.redirect('https://buildforge-six.vercel.app/documents?box=connected');
    } else { res.status(400).send('Auth failed: ' + JSON.stringify(data)); }
  } catch(e) { res.status(500).send('Error: ' + e.message); }
});

router.get('/status', (req, res) => { res.json({ connected: !!tokens.access_token && !!tokens.refresh_token }); });

router.get('/folders/:id', async (req, res) => {
  var auth = await getAuth();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var resp = await fetch('https://api.box.com/2.0/folders/' + req.params.id + '?fields=id,name,path_collection,item_collection&limit=1000&offset=0', auth);
    var data = await resp.json();
    if (data.type === 'error') return res.status(resp.status).json(data);
    var entries = data.item_collection ? data.item_collection.entries : [];
    res.json({ entries: entries, total_count: data.item_collection ? data.item_collection.total_count : 0, folder_id: data.id, folder_name: data.name, path_collection: data.path_collection });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/search', async (req, res) => {
  var auth = await getAuth();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var resp = await fetch('https://api.box.com/2.0/search?query=' + encodeURIComponent(req.query.q || '') + '&limit=50', auth);
    var data = await resp.json();
    res.json({ entries: data.entries || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/search-folder', async (req, res) => {
  var auth = await getAuth();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var resp = await fetch('https://api.box.com/2.0/search?query=' + encodeURIComponent(req.query.q || '') + '&type=folder&limit=10', auth);
    var data = await resp.json();
    res.json({ entries: data.entries || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/files/:id', async (req, res) => {
  var auth = await getAuth();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try { var resp = await fetch('https://api.box.com/2.0/files/' + req.params.id, auth); res.json(await resp.json()); } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/files/:id/thumbnail', async (req, res) => {
  var auth = await getAuth();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var resp = await fetch('https://api.box.com/2.0/files/' + req.params.id + '/thumbnail.png?min_height=256&min_width=256', auth);
    if ((resp.headers.get('content-type') || '').includes('image')) { res.set('Content-Type', 'image/png'); resp.body.pipe(res); }
    else { res.status(404).json({ error: 'No thumbnail' }); }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stream file content (for PDF preview, image preview, download)
router.get('/files/:id/content', async (req, res) => {
  var auth = await getAuth();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    // First get file info for content-type
    var infoResp = await fetch('https://api.box.com/2.0/files/' + req.params.id + '?fields=name,size', auth);
    var info = await infoResp.json();
    if (info.type === 'error') return res.status(infoResp.status).json(info);

    var ext = (info.name || '').split('.').pop().toLowerCase();
    var mimeTypes = {
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'application/xml',
      mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
      zip: 'application/zip', rar: 'application/x-rar-compressed',
    };
    var mime = mimeTypes[ext] || 'application/octet-stream';

    // Download the file content from Box
    var contentResp = await fetch('https://api.box.com/2.0/files/' + req.params.id + '/content', {
      headers: auth.headers, redirect: 'follow'
    });

    if (!contentResp.ok) return res.status(contentResp.status).json({ error: 'Failed to fetch file content' });

    res.set('Content-Type', mime);
    if (info.size) res.set('Content-Length', String(info.size));
    if (req.query.download === '1') {
      res.set('Content-Disposition', 'attachment; filename="' + (info.name || 'file') + '"');
    } else {
      res.set('Content-Disposition', 'inline; filename="' + (info.name || 'file') + '"');
    }
    contentResp.body.pipe(res);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get embed link for file
router.get('/files/:id/embed', async (req, res) => {
  var auth = await getAuth();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var resp = await fetch('https://api.box.com/2.0/files/' + req.params.id + '?fields=expiring_embed_link', auth);
    var data = await resp.json();
    if (data.expiring_embed_link && data.expiring_embed_link.url) {
      res.json({ embed_url: data.expiring_embed_link.url });
    } else {
      res.json({ embed_url: null });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/project-folder/:projectId', async (req, res) => {
  try {
    var r = await db.query('SELECT box_folder_id FROM projects WHERE id = $1', [req.params.projectId]);
    if (r.rows.length === 0) return res.json({ box_folder_id: null });
    res.json({ box_folder_id: r.rows[0].box_folder_id });
  } catch(e) { res.json({ box_folder_id: null }); }
});

module.exports = router;

