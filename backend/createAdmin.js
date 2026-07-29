// Creates (or resets) the initial admin account. Idempotent.
// Usage: DATABASE_URL=... [ADMIN_EMAIL=...] [ADMIN_PASSWORD=...] node createAdmin.js
const bcrypt = require('bcrypt');
require('dotenv').config();
const db = require('./src/db');

async function createAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@scheduler.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (name, email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, $3, $4, $5, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = true`,
    ['Admin User', email, hash, 'Admin', 'User']
  );
  console.log(`Admin ready: ${email}`);
  process.exit(0);
}

createAdmin().catch((err) => { console.error(err.message); process.exit(1); });
