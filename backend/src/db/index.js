const { Pool } = require('pg');

// TLS policy, explicit and configurable:
//   PGSSL=disable -> no TLS (local dev)
//   PGSSL=verify  -> TLS with full cert verification
//   default       -> TLS, tolerating managed-PG self-signed chains (Railway/Heroku style)
function sslConfig() {
  const mode = (process.env.PGSSL || '').toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'verify') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: sslConfig() }
    : { user: process.env.PGUSER, password: process.env.PGPASSWORD, host: process.env.PGHOST, port: parseInt(process.env.PGPORT || '5432'), database: process.env.PGDATABASE, ssl: process.env.PGHOST && process.env.PGHOST !== 'localhost' ? sslConfig() : false }
);

pool.on('error', (err) => console.error('Unexpected DB error', err));

// Deadlock-aware query. Route modules run their idempotent boot DDL
// concurrently at require time, and Postgres occasionally picks one as a
// deadlock victim (40P01) — the victim's statement is rolled back, so a short
// randomized retry always converges. Without this, boot leaves random tables
// missing until the next restart.
const RETRYABLE = new Set(['40P01']);
async function query(text, params) {
  let attempt = 0;
  for (;;) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (!RETRYABLE.has(err.code) || attempt >= 4) throw err;
      attempt += 1;
      const delay = 50 * attempt + Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = {
  query,
  pool
};
