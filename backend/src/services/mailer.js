// Outbound email. Configured entirely by env; when SMTP is not configured the
// service is disabled and senders fall back to in-app-notification-only, so
// email is additive and can never break a core flow.
//
//   SMTP_HOST     e.g. smtp.sendgrid.net (required to enable)
//   SMTP_PORT     default 587
//   SMTP_SECURE   'true' for implicit TLS (port 465)
//   SMTP_USER / SMTP_PASS   auth (optional — some relays are IP-allowed)
//   MAIL_FROM     default no-reply@buildforge.local
const nodemailer = require('nodemailer');

let transport = null;

function isEnabled() {
  return !!process.env.SMTP_HOST;
}

function getTransport() {
  if (!isEnabled()) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
      // Never let a slow relay hold up a request path.
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transport;
}

/**
 * Send an email. Resolves { sent: boolean, reason?: string }.
 * Never throws — callers treat email as best-effort.
 */
async function sendMail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'no recipient' };
  const t = getTransport();
  if (!t) return { sent: false, reason: 'smtp not configured' };
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || 'no-reply@buildforge.local',
      to,
      subject: subject || '(no subject)',
      text: text || '',
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

/** Look up a user's email address by id; null if not found/inactive. */
async function userEmail(db, userId) {
  if (!userId) return null;
  try {
    const r = await db.query('SELECT email FROM users WHERE id = $1 AND is_active IS NOT FALSE', [userId]);
    return r.rows.length ? r.rows[0].email : null;
  } catch {
    return null;
  }
}

// Test hook: allows unit tests to reset the cached transport between configs.
function _resetTransport() { transport = null; }

module.exports = { sendMail, userEmail, isEnabled, _resetTransport };
