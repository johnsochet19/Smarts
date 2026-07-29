const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const totp = require('../auth/totp');
const { authenticate } = require('../middleware/auth');

// How long a password reset token stays valid.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Ensure MFA columns exist (idempotent).
(async () => {
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(64)`);
  } catch (err) { console.error('[auth] MFA migration note:', err.message); }
})();

// Ensure password reset tokens table exists (idempotent; migration 007 also creates it).
(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(128) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at    TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
  } catch (err) { console.error('[auth] password reset migration note:', err.message); }
})();

router.post('/login', async (req, res) => {
  const { email, password, token: mfaToken } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Second factor, if enabled for this user.
    if (user.mfa_enabled && user.mfa_secret) {
      if (!mfaToken) return res.status(401).json({ mfa_required: true, error: 'Two-factor code required' });
      if (!totp.verify(user.mfa_secret, mfaToken)) return res.status(401).json({ mfa_required: true, error: 'Invalid two-factor code' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, mfa_enabled: !!user.mfa_enabled } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Password reset ────────────────────────────────────────────────────
// Request a reset: look up the user, issue a time-limited token, store it.
// Always returns a generic response so it can't be used to probe for accounts.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const generic = { message: 'If an account exists for that email, a password reset link has been sent.' };
  try {
    const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length) {
      const userId = result.rows[0].id;
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      // Invalidate any outstanding tokens for this user, then store the new one.
      await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await db.query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, token, expiresAt]
      );
      // The token would normally be emailed. Log it in non-production so it can
      // be tested without leaking account existence through the API response.
      if (process.env.NODE_ENV !== 'production') {
        console.log('[auth] password reset token for ' + email + ': ' + token);
      }
    }
    res.json(generic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Redeem a reset token: validate it, hash the new password, invalidate the token.
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password required' });
  try {
    const result = await db.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()',
      [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired reset token' });
    const reset = result.rows[0];

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, reset.user_id]);
    await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [reset.id]);

    res.json({ message: 'Password has been reset. You can now log in with your new password.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MFA management (authenticated) ────────────────────────────────────
// Begin setup: generate + store a secret (not yet enabled), return provisioning info.
router.post('/mfa/setup', authenticate, async (req, res) => {
  try {
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [secret, req.user.id]);
    res.json({ secret, otpauth: totp.otpauthURL(secret, req.user.email || String(req.user.id)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Confirm setup: verify a code against the stored secret, then enable.
router.post('/mfa/enable', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    const { rows } = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = rows[0] && rows[0].mfa_secret;
    if (!secret) return res.status(400).json({ error: 'Start MFA setup first' });
    if (!totp.verify(secret, token)) return res.status(400).json({ error: 'Invalid code — try again' });
    await db.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user.id]);
    res.json({ enabled: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Disable: require a valid current code (proof of possession).
router.post('/mfa/disable', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    const { rows } = await db.query('SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1', [req.user.id]);
    if (rows[0] && rows[0].mfa_enabled && !totp.verify(rows[0].mfa_secret, token)) {
      return res.status(400).json({ error: 'Invalid code' });
    }
    await db.query('UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1', [req.user.id]);
    res.json({ enabled: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    const result = await db.query('SELECT id, name, email, role, mfa_enabled FROM users WHERE id = $1', [decoded.id]);
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
