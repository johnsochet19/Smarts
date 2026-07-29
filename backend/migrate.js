#!/usr/bin/env node
// Forward-only migration runner. Importable (runMigrations) so the server can
// auto-apply on boot, and runnable as a CLI (`npm run migrate`).
// Idempotent migrations mean re-running is always safe.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/db');

async function runMigrations({ silent = false } = {}) {
  const log = (m) => { if (!silent) console.log(m); };
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return { applied: 0, skipped: 0 };

  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT NOW()
  )`);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await db.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log('  applied ' + file);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      // Don't crash the server on a single migration issue; route-level
      // auto-migrations are a backstop. Surface it and continue.
      console.error('  migration failed ' + file + ': ' + err.message);
    } finally {
      client.release();
    }
  }
  log(`Migrations: ${count} applied, ${files.length - count} already up to date.`);
  return { applied: count, skipped: files.length - count };
}

module.exports = { runMigrations };

// CLI entry
if (require.main === module) {
  runMigrations()
    .then(() => db.pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error('Migration run failed:', err.message); process.exit(1); });
}
