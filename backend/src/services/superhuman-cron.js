const cron = require('node-cron');
const { google } = require('googleapis');
const db = require('../db');
const { getAuthClient } = require('../routes/google');

async function processSnoozes() {
  try {
    const result = await db.query(
      'SELECT * FROM email_snoozes WHERE processed = false AND wake_at <= NOW()'
    );
    if (result.rows.length === 0) return;
    const auth = await getAuthClient();
    if (!auth) return;
    const gmail = google.gmail({ version: 'v1', auth });
    for (const snooze of result.rows) {
      try {
        await gmail.users.messages.modify({
          userId: 'me', id: snooze.message_id,
          requestBody: { addLabelIds: ['INBOX', 'UNREAD'] }
        });
        await db.query('UPDATE email_snoozes SET processed = true WHERE id = $1', [snooze.id]);
        console.log('Snooze processed:', snooze.message_id);
      } catch (e) {
        console.error('Snooze process error for', snooze.message_id, e.message);
      }
    }
  } catch (e) {
    console.error('processSnoozes error:', e.message);
  }
}

async function processScheduledSends() {
  try {
    const result = await db.query(
      'SELECT * FROM email_scheduled_sends WHERE sent = false AND send_at <= NOW()'
    );
    if (result.rows.length === 0) return;
    const auth = await getAuthClient();
    if (!auth) return;
    const gmail = google.gmail({ version: 'v1', auth });
    for (const scheduled of result.rows) {
      try {
        const raw = [
          'To: ' + scheduled.to_address,
          'Subject: ' + (scheduled.subject || ''),
          scheduled.in_reply_to ? 'In-Reply-To: ' + scheduled.in_reply_to : '',
          scheduled.in_reply_to ? 'References: ' + scheduled.in_reply_to : '',
          'Content-Type: text/html; charset=utf-8',
          '',
          scheduled.body || ''
        ].filter(Boolean).join('\r\n');
        const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encoded, threadId: scheduled.thread_id || undefined }
        });
        await db.query('UPDATE email_scheduled_sends SET sent = true WHERE id = $1', [scheduled.id]);
        console.log('Scheduled send processed:', scheduled.id);
      } catch (e) {
        console.error('Scheduled send error for', scheduled.id, e.message);
      }
    }
  } catch (e) {
    console.error('processScheduledSends error:', e.message);
  }
}

function startSuperhumanCron() {
  // Process snoozes every minute
  cron.schedule('* * * * *', processSnoozes);
  // Process scheduled sends every minute
  cron.schedule('* * * * *', processScheduledSends);
  console.log('Superhuman cron jobs started');
}

module.exports = { startSuperhumanCron, processSnoozes, processScheduledSends };
