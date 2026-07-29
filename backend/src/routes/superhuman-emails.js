const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { getAuthClient } = require('./google');

// Helper: get Gmail client
async function getGmail() {
  const auth = await getAuthClient();
  if (!auth) return null;
  return google.gmail({ version: 'v1', auth });
}

// List emails with category support
router.get('/emails', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    const { q, label, max, pageToken, category } = req.query;
    const labelIds = label ? [label] : ['INBOX'];
    let query = q || '';
    if (category === 'important') query += ' is:important';
    else if (category === 'newsletters') query += ' category:promotions OR category:updates';
    else if (category === 'team') query += ' from:team OR from:noreply';
    const list = await gmail.users.messages.list({
      userId: 'me', labelIds, q: query.trim(),
      maxResults: parseInt(max) || 30, pageToken: pageToken || undefined
    });
    const messages = list.data.messages || [];
    const details = await Promise.all(messages.map(async (m) => {
      const msg = await gmail.users.messages.get({
        userId: 'me', id: m.id, format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date', 'To', 'Message-ID']
      });
      const headers = {};
      (msg.data.payload.headers || []).forEach(h => { headers[h.name] = h.value; });
      // Check tracking status
      const tracking = await db.query('SELECT opened, open_count, opened_at FROM email_tracking WHERE message_id = $1', [m.id]);
      return {
        id: msg.data.id, threadId: msg.data.threadId, snippet: msg.data.snippet,
        subject: headers['Subject'] || '(no subject)', from: headers['From'] || '',
        to: headers['To'] || '', date: headers['Date'] || '', messageIdHeader: headers['Message-ID'] || '',
        labelIds: msg.data.labelIds || [], isUnread: (msg.data.labelIds || []).includes('UNREAD'),
        isStarred: (msg.data.labelIds || []).includes('STARRED'),
        tracking: tracking.rows[0] || null
      };
    }));
    res.json({ messages: details, nextPageToken: list.data.nextPageToken });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get single email with full body
router.get('/emails/:id', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    const msg = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    const headers = {};
    (msg.data.payload.headers || []).forEach(h => { headers[h.name] = h.value; });
    let body = '';
    function extractBody(part) {
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf8');
      } else if (part.mimeType === 'text/plain' && part.body && part.body.data && !body) {
        body = Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      if (part.parts) part.parts.forEach(extractBody);
    }
    extractBody(msg.data.payload);
    const attachments = [];
    function extractAttachments(part) {
      if (part.filename && part.body && part.body.attachmentId) {
        attachments.push({ filename: part.filename, mimeType: part.mimeType, size: part.body.size, attachmentId: part.body.attachmentId });
      }
      if (part.parts) part.parts.forEach(extractAttachments);
    }
    extractAttachments(msg.data.payload);
    // Get thread messages
    const thread = await gmail.users.threads.get({ userId: 'me', id: msg.data.threadId, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
    const threadMessages = (thread.data.messages || []).map(tm => {
      const th = {};
      (tm.payload.headers || []).forEach(h => { th[h.name] = h.value; });
      return { id: tm.id, snippet: tm.snippet, from: th['From'] || '', date: th['Date'] || '', subject: th['Subject'] || '' };
    });
    // Get comments
    const comments = await db.query('SELECT * FROM email_comments WHERE thread_id = $1 ORDER BY created_at ASC', [msg.data.threadId]);
    // Get tracking
    const tracking = await db.query('SELECT * FROM email_tracking WHERE message_id = $1', [req.params.id]);
    res.json({
      id: msg.data.id, threadId: msg.data.threadId, snippet: msg.data.snippet,
      subject: headers['Subject'] || '', from: headers['From'] || '', to: headers['To'] || '',
      cc: headers['Cc'] || '', date: headers['Date'] || '', messageIdHeader: headers['Message-ID'] || '',
      body, attachments, labelIds: msg.data.labelIds || [],
      thread: threadMessages, comments: comments.rows, tracking: tracking.rows[0] || null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send email with optional tracking pixel
router.post('/emails/send', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    const { to, cc, subject, body, inReplyTo, threadId, enableTracking } = req.body;
    let finalBody = body;
    let pixelId = null;
    if (enableTracking) {
      pixelId = uuidv4();
      const backendUrl = process.env.BACKEND_URL || 'https://scheduler-production-f3e1.up.railway.app';
      finalBody += `<img src="${backendUrl}/t/${pixelId}" width="1" height="1" style="display:none" />`;
    }
    const raw = [
      'To: ' + to, cc ? 'Cc: ' + cc : '', 'Subject: ' + subject,
      inReplyTo ? 'In-Reply-To: ' + inReplyTo : '', inReplyTo ? 'References: ' + inReplyTo : '',
      'Content-Type: text/html; charset=utf-8', '', finalBody
    ].filter(Boolean).join('\r\n');
    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded, threadId: threadId || undefined } });
    if (enableTracking && pixelId) {
      await db.query('INSERT INTO email_tracking (message_id, pixel_id, recipient, subject) VALUES ($1, $2, $3, $4)',
        [result.data.id, pixelId, to, subject]);
    }
    // Update metrics
    await db.query(`INSERT INTO email_metrics (date, emails_sent) VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET emails_sent = email_metrics.emails_sent + 1`);
    res.json({ id: result.data.id, threadId: result.data.threadId, pixelId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Archive email
router.post('/emails/:id/archive', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['INBOX'] } });
    await db.query(`INSERT INTO email_metrics (date, emails_archived) VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET emails_archived = email_metrics.emails_archived + 1`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Star/unstar
router.post('/emails/:id/star', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    const { star } = req.body;
    await gmail.users.messages.modify({
      userId: 'me', id: req.params.id,
      requestBody: star ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark read/unread
router.post('/emails/:id/read', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    const { read } = req.body;
    await gmail.users.messages.modify({
      userId: 'me', id: req.params.id,
      requestBody: read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trash
router.post('/emails/:id/trash', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    await gmail.users.messages.trash({ userId: 'me', id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark as spam
router.post('/emails/:id/spam', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    await gmail.users.messages.modify({
      userId: 'me', id: req.params.id,
      requestBody: { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark important / unmark important
router.post('/emails/:id/important', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    const { important } = req.body;
    await gmail.users.messages.modify({
      userId: 'me', id: req.params.id,
      requestBody: important ? { addLabelIds: ['IMPORTANT'] } : { removeLabelIds: ['IMPORTANT'] }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Snooze email
router.post('/emails/:id/snooze', async (req, res) => {
  const gmail = await getGmail();
  if (!gmail) return res.status(401).json({ error: 'Not connected', need_auth: true });
  try {
    const { wakeAt, threadId } = req.body;
    await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['INBOX'] } });
    await db.query('INSERT INTO email_snoozes (message_id, thread_id, wake_at) VALUES ($1, $2, $3)',
      [req.params.id, threadId || null, new Date(wakeAt)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Schedule send
router.post('/emails/schedule', async (req, res) => {
  try {
    const { to, subject, body, sendAt, threadId, inReplyTo } = req.body;
    const result = await db.query(
      'INSERT INTO email_scheduled_sends (to_address, subject, body, send_at, thread_id, in_reply_to) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [to, subject, body, new Date(sendAt), threadId || null, inReplyTo || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Snippets CRUD ---
router.get('/snippets', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM email_snippets ORDER BY use_count DESC');
    res.json({ snippets: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/snippets', async (req, res) => {
  try {
    const { name, shortcut, content, category } = req.body;
    const result = await db.query('INSERT INTO email_snippets (name, shortcut, content, category) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, shortcut || null, content, category || 'general']);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/snippets/:id', async (req, res) => {
  try {
    const { name, shortcut, content, category } = req.body;
    const result = await db.query('UPDATE email_snippets SET name=$1, shortcut=$2, content=$3, category=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
      [name, shortcut, content, category, req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/snippets/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM email_snippets WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/snippets/:id/use', async (req, res) => {
  try {
    await db.query('UPDATE email_snippets SET use_count = use_count + 1 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Comments ---
router.get('/comments/:threadId', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM email_comments WHERE thread_id = $1 ORDER BY created_at ASC', [req.params.threadId]);
    res.json({ comments: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/comments', async (req, res) => {
  try {
    const { threadId, messageId, author, content } = req.body;
    const result = await db.query('INSERT INTO email_comments (thread_id, message_id, author, content) VALUES ($1,$2,$3,$4) RETURNING *',
      [threadId, messageId || null, author, content]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Contacts ---
router.get('/contacts', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM email_contacts ORDER BY last_contacted DESC NULLS LAST LIMIT 100');
    res.json({ contacts: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/contacts/upsert', async (req, res) => {
  try {
    const { email, name, company, notes } = req.body;
    const result = await db.query(`INSERT INTO email_contacts (email, name, company, notes, last_contacted, email_count)
      VALUES ($1,$2,$3,$4,NOW(),1) ON CONFLICT (email) DO UPDATE SET
      name=COALESCE($2, email_contacts.name), company=COALESCE($3, email_contacts.company),
      notes=COALESCE($4, email_contacts.notes), last_contacted=NOW(), email_count=email_contacts.email_count+1,
      updated_at=NOW() RETURNING *`, [email, name || null, company || null, notes || null]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Metrics ---
router.get('/metrics', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const result = await db.query('SELECT * FROM email_metrics WHERE date >= CURRENT_DATE - $1::integer ORDER BY date DESC', [days]);
    res.json({ metrics: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
