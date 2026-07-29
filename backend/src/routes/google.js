const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const db = require('../db');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://scheduler-production-f3e1.up.railway.app/api/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://buildforge-six.vercel.app';

var tokens = { access_token: '', refresh_token: '', expires_at: 0 };

// Auto-create google_tokens table + load persisted tokens
(async function() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY DEFAULT 1,
      access_token TEXT, refresh_token TEXT, expires_at BIGINT,
      CHECK (id = 1)
    )`);
    var r = await db.query('SELECT * FROM google_tokens WHERE id = 1');
    if (r.rows.length > 0) {
      tokens.access_token = r.rows[0].access_token || '';
      tokens.refresh_token = r.rows[0].refresh_token || '';
      tokens.expires_at = parseInt(r.rows[0].expires_at) || 0;
      console.log('Google tokens loaded from DB');
    }
  } catch(e) { console.error('Google token table init error:', e.message); }
})();

async function saveTokens() {
  try {
    await db.query(`INSERT INTO google_tokens (id, access_token, refresh_token, expires_at)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET access_token=$1, refresh_token=$2, expires_at=$3`,
      [tokens.access_token, tokens.refresh_token, tokens.expires_at]);
  } catch(e) { console.error('Save google tokens error:', e); }
}

function getOAuth2Client() {
  var client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  if (tokens.access_token) {
    client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expires_at
    });
  }
  return client;
}

async function getAuthClient() {
  if (!tokens.access_token) return null;
  var client = getOAuth2Client();
  // Auto refresh if expired or expiring within 2 minutes
  if (Date.now() > tokens.expires_at - 120000) {
    if (!tokens.refresh_token) {
      console.error('Google token expired and no refresh token available');
      return null;
    }
    try {
      var { credentials } = await client.refreshAccessToken();
      tokens.access_token = credentials.access_token;
      if (credentials.refresh_token) tokens.refresh_token = credentials.refresh_token;
      tokens.expires_at = credentials.expiry_date || (Date.now() + 3600000);
      await saveTokens();
      client.setCredentials(credentials);
      console.log('Google token refreshed successfully');
    } catch(e) {
      console.error('Google token refresh failed:', e.message);
      // If refresh fails due to revoked token, clear tokens so user is prompted to re-auth
      if (e.message && (e.message.includes('invalid_grant') || e.message.includes('Token has been expired or revoked'))) {
        tokens.access_token = '';
        tokens.expires_at = 0;
        await saveTokens();
      }
      return null;
    }
  }
  return client;
}

// Check config status
router.get('/config-status', (req, res) => {
  res.json({ configured: !!(CLIENT_ID && CLIENT_SECRET) });
});

// Initiate OAuth flow
router.get('/auth', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(400).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.' });
  }
  var client = getOAuth2Client();
  // Pass the frontend origin in state so callback can redirect back to the correct URL (beta vs production)
  var frontendOrigin = req.query.origin || FRONTEND_URL;
  var url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state: frontendOrigin,
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ]
  });
  res.json({ auth_url: url });
});

// OAuth callback
router.get('/callback', async (req, res) => {
  var code = req.query.code;
  if (!code) return res.status(400).send('No auth code');
  try {
    var client = getOAuth2Client();
    var { tokens: t } = await client.getToken(code);
    tokens.access_token = t.access_token;
    tokens.refresh_token = t.refresh_token || tokens.refresh_token;
    tokens.expires_at = t.expiry_date || (Date.now() + 3600000);
    await saveTokens();
    // Use the frontend origin from state parameter, fall back to FRONTEND_URL
    var redirectBase = req.query.state || FRONTEND_URL;
    res.redirect(redirectBase + '/#/gmail?google=connected');
  } catch(e) {
    console.error('Google OAuth error:', e);
    res.status(500).send('Auth failed: ' + e.message);
  }
});

// Connection status
router.get('/status', (req, res) => {
  res.json({ connected: !!tokens.access_token && !!tokens.refresh_token });
});

// Disconnect
router.post('/disconnect', async (req, res) => {
  tokens = { access_token: '', refresh_token: '', expires_at: 0 };
  await saveTokens();
  res.json({ ok: true });
});

// -- Gmail endpoints --

// Get user profile
router.get('/gmail/profile', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    var profile = await gmail.users.getProfile({ userId: 'me' });
    res.json(profile.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// List messages (inbox)
router.get('/gmail/messages', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    var q = req.query.q || '';
    var label = req.query.label || 'INBOX';
    var maxResults = parseInt(req.query.max) || 20;
    var pageToken = req.query.pageToken || undefined;
    var list = await gmail.users.messages.list({
      userId: 'me', labelIds: [label], q: q, maxResults: maxResults, pageToken: pageToken
    });
    var messages = list.data.messages || [];
    // Fetch details for each message
    var details = await Promise.all(messages.map(async function(m) {
      var msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date', 'To'] });
      var headers = {};
      (msg.data.payload.headers || []).forEach(function(h) { headers[h.name] = h.value; });
      return {
        id: msg.data.id,
        threadId: msg.data.threadId,
        snippet: msg.data.snippet,
        subject: headers['Subject'] || '(no subject)',
        from: headers['From'] || '',
        to: headers['To'] || '',
        date: headers['Date'] || '',
        labelIds: msg.data.labelIds || [],
        isUnread: (msg.data.labelIds || []).includes('UNREAD'),
      };
    }));
    res.json({ messages: details, nextPageToken: list.data.nextPageToken, resultSizeEstimate: list.data.resultSizeEstimate });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get single message with body
router.get('/gmail/messages/:id', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    var msg = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    var headers = {};
    (msg.data.payload.headers || []).forEach(function(h) { headers[h.name] = h.value; });
    // Extract body
    var body = '';
    function extractBody(part) {
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf8');
      } else if (part.mimeType === 'text/plain' && part.body && part.body.data && !body) {
        body = Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      if (part.parts) part.parts.forEach(extractBody);
    }
    extractBody(msg.data.payload);
    res.json({
      id: msg.data.id,
      threadId: msg.data.threadId,
      snippet: msg.data.snippet,
      subject: headers['Subject'] || '',
      from: headers['From'] || '',
      to: headers['To'] || '',
      date: headers['Date'] || '',
      body: body,
      labelIds: msg.data.labelIds || [],
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send email
router.post('/gmail/send', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    var { to, subject, body, inReplyTo, threadId } = req.body;
    var raw = [
      'To: ' + to,
      'Subject: ' + subject,
      inReplyTo ? 'In-Reply-To: ' + inReplyTo : '',
      inReplyTo ? 'References: ' + inReplyTo : '',
      'Content-Type: text/html; charset=utf-8',
      '',
      body
    ].filter(Boolean).join('\r\n');
    var encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    var result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded, threadId: threadId || undefined } });
    res.json({ id: result.data.id, threadId: result.data.threadId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Modify message labels (archive, star, mark read, etc.)
router.post('/gmail/messages/:id/modify', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    var result = await gmail.users.messages.modify({
      userId: 'me', id: req.params.id,
      requestBody: { addLabelIds: req.body.addLabelIds || [], removeLabelIds: req.body.removeLabelIds || [] }
    });
    res.json({ id: result.data.id, labelIds: result.data.labelIds });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Trash message
router.post('/gmail/messages/:id/trash', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.trash({ userId: 'me', id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Untrash message
router.post('/gmail/messages/:id/untrash', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.untrash({ userId: 'me', id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// List Gmail labels
router.get('/gmail/labels', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var gmail = google.gmail({ version: 'v1', auth });
    var result = await gmail.users.labels.list({ userId: 'me' });
    res.json({ labels: result.data.labels || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// -- Calendar endpoints --

// List calendars
router.get('/calendar/list', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var cal = google.calendar({ version: 'v3', auth });
    var list = await cal.calendarList.list();
    res.json({ calendars: list.data.items || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// List events
router.get('/calendar/events', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var cal = google.calendar({ version: 'v3', auth });
    var now = new Date();
    var timeMin = req.query.timeMin || now.toISOString();
    var timeMax = req.query.timeMax || new Date(now.getTime() + 7 * 86400000).toISOString();
    var calendarId = req.query.calendarId || 'primary';
    var events = await cal.events.list({
      calendarId: calendarId,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: parseInt(req.query.max) || 50,
    });
    res.json({ events: events.data.items || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create event
router.post('/calendar/events', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var cal = google.calendar({ version: 'v3', auth });
    var event = await cal.events.insert({
      calendarId: req.body.calendarId || 'primary',
      requestBody: {
        summary: req.body.summary,
        description: req.body.description || '',
        location: req.body.location || '',
        start: req.body.start,
        end: req.body.end,
        attendees: req.body.attendees || [],
      }
    });
    res.json(event.data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Helper: translate Google API errors into user-friendly messages for Sheets
function sheetsErrorMessage(e) {
  var code = e.code || (e.response && e.response.status) || 0;
  var msg = e.message || '';
  if (code === 403 || msg.includes('forbidden') || msg.includes('PERMISSION_DENIED')) {
    return 'Access denied - this sheet is private. Ask the sheet owner to share it with your Google account email, or reconnect your Google account in Settings.';
  }
  if (code === 404 || msg.includes('not found') || msg.includes('Requested entity was not found')) {
    return 'Sheet not found - it may have been deleted or the link is invalid.';
  }
  if (code === 401 || msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
    return 'Google session expired - please reconnect your Google account in Settings.';
  }
  if (msg.includes('insufficientPermissions') || msg.includes('scope')) {
    return 'Missing permissions - reconnect your Google account in Settings to grant spreadsheet access.';
  }
  if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('network')) {
    return 'Network error - could not reach Google servers. Please try again.';
  }
  return 'Failed to access sheet: ' + msg;
}

// -- Google Sheets / Drive endpoints --

// List all Google Sheets shared with / owned by user
router.get('/sheets/list', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    var drive = google.drive({ version: 'v3', auth });
    var q = req.query.q || '';
    var query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
    if (q) query += " and name contains '" + q.replace(/'/g, "\\'") + "'";
    var result = await drive.files.list({
      q: query,
      fields: 'nextPageToken, files(id, name, modifiedTime, owners, shared, sharingUser, webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: parseInt(req.query.max) || 50,
      pageToken: req.query.pageToken || undefined,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    res.json({ files: result.data.files || [], nextPageToken: result.data.nextPageToken });
  } catch(e) {
    console.error('Sheets list error:', e.code, e.message);
    var userMsg = sheetsErrorMessage(e);
    res.status(500).json({ error: userMsg });
  }
});

// Get sheet metadata (sheet names, row counts)
router.get('/sheets/:spreadsheetId', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Sheet is private - connect your Google account in Settings to access shared spreadsheets.', need_auth: true });
  try {
    var sheets = google.sheets({ version: 'v4', auth });
    var meta = await sheets.spreadsheets.get({ spreadsheetId: req.params.spreadsheetId });
    var sheetList = (meta.data.sheets || []).map(function(s) {
      return { title: s.properties.title, sheetId: s.properties.sheetId, rowCount: s.properties.gridProperties.rowCount, colCount: s.properties.gridProperties.columnCount };
    });
    res.json({ title: meta.data.properties.title, spreadsheetId: meta.data.spreadsheetId, url: meta.data.spreadsheetUrl, sheets: sheetList });
  } catch(e) {
    console.error('Sheets metadata error:', e.code, e.message);
    var userMsg = sheetsErrorMessage(e);
    var status = e.code === 404 ? 404 : e.code === 403 ? 403 : e.code === 401 ? 401 : 500;
    res.status(status).json({ error: userMsg, code: e.code || 'UNKNOWN' });
  }
});

// Get sheet data (with optional sheet name and range)
router.get('/sheets/:spreadsheetId/data', async (req, res) => {
  var auth = await getAuthClient();
  if (!auth) return res.status(401).json({ error: 'Sheet is private - connect your Google account in Settings to access shared spreadsheets.', need_auth: true });
  try {
    var sheets = google.sheets({ version: 'v4', auth });
    var range = req.query.sheet ? (req.query.sheet + '!A1:Z1000') : 'A1:Z1000';
    var response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.params.spreadsheetId,
      range: range,
    });
    var rows = response.data.values || [];
    var headers = rows.length > 0 ? rows[0] : [];
    var dataRows = rows.slice(1).filter(function(r) { return r.some(function(c) { return c && c.toString().trim(); }); });
    res.json({ headers: headers, rows: dataRows, totalRows: dataRows.length, range: response.data.range });
  } catch(e) {
    console.error('Sheets data error:', e.code, e.message);
    var userMsg = sheetsErrorMessage(e);
    var status = e.code === 404 ? 404 : e.code === 403 ? 403 : e.code === 401 ? 401 : 500;
    res.status(status).json({ error: userMsg, code: e.code || 'UNKNOWN' });
  }
});

// List user's Google Sheets from Drive
router.get('/sheets', async (req, res) => {
  try {
    var auth = await getAuthClient();
    if (!auth) return res.status(401).json({ error: 'Google not connected. Please connect your Google account first.' });
    var drive = google.drive({ version: 'v3', auth: auth });
    var query = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
    var search = req.query.q;
    if (search) query += " and name contains '" + search.replace(/'/g, "\\'") + "'";
    var response = await drive.files.list({
      q: query,
      fields: 'files(id, name, modifiedTime, owners, webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 50,
    });
    var sheets = (response.data.files || []).map(function(f) {
      return {
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        owner: f.owners && f.owners[0] ? f.owners[0].displayName : '',
        url: f.webViewLink || 'https://docs.google.com/spreadsheets/d/' + f.id,
      };
    });
    res.json({ sheets: sheets });
  } catch(e) {
    console.error('List sheets error:', e.message);
    if (e.message && (e.message.includes('Insufficient Permission') || e.message.includes('insufficientPermissions') || e.message.includes('scope'))) {
      return res.status(403).json({ error: 'Insufficient Permission. Please reconnect your Google account to grant Drive access.', needReauth: true });
    }
    res.status(500).json({ error: 'Failed to list sheets: ' + e.message });
  }
});

module.exports = router;
module.exports.getAuthClient = getAuthClient;
