require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const { buildCorsOptions, socketCorsOptions, securityHeaders, rateLimit, errorHandler } = require('./middleware/security');
const { authenticate, requireRole } = require('./middleware/auth');

// Fail fast if the JWT secret is missing in production — a silently-undefined
// secret is a serious auth vulnerability.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[fatal] JWT_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  } else {
    console.warn('[security] JWT_SECRET not set — using insecure dev fallback. Set it before deploying.');
    process.env.JWT_SECRET = 'dev-insecure-secret-change-me';
  }
}

const app = express();
app.set('trust proxy', 1); // req.ip reflects the real client behind Railway/Vercel proxies
const server = http.createServer(app);
const io = new Server(server, { cors: socketCorsOptions() });
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// Phase 4: Box + Excel routes
const boxRoutes = require('./routes/box');
const scheduleRoutes = require('./routes/schedule');
const attachmentRoutes = require('./routes/attachments');
const reminderRoutes = require('./routes/reminders');
const exportRoutes = require('./routes/export');
const aiRoutes = require('./routes/ai');
const excelRoutes = require('./routes/excel');
app.use(securityHeaders);
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '10mb' }));
// Throttle auth to blunt brute-force / credential-stuffing on login.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: 'login' }));
// Throttle password-reset requests the same way to blunt abuse / account probing.
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: 'forgot-password' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/workspaces', require('./routes/workspaces'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/projects/:id/tasks', require('./routes/tasks'));
// Legacy: keep /api/tasks for backward compat (schedule page, etc.)
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/users', require('./routes/users'));
app.use('/api/dependencies', require('./routes/dependencies'));
app.use('/api/changelog', require('./routes/changelog'));
app.use('/api/projects/:id/audit-log', require('./routes/audit-log'));
app.use('/api/audit-log', require('./routes/audit-log'));
app.use('/api/projects/:id/related-items', require('./routes/related-items'));
app.use('/api/related-items', require('./routes/related-items'));
app.use('/api/themes', require('./routes/themes'));
app.use('/api/search', require('./routes/search'));
app.use('/api/export', require('./routes/exportRoutes'));
app.use('/api/import', require('./routes/importRoutes'));
app.use('/api/google', require('./routes/google'));
app.use('/api/projects/:id/rfis', require('./routes/rfis'));
// Legacy: keep /api/rfis for backward compat
app.use('/api/rfis', require('./routes/rfis'));
app.use('/api/projects/:id/submittals', require('./routes/submittals'));
app.use('/api/submittals', require('./routes/submittals'));
app.use('/api/projects/:id/daily-logs', require('./routes/daily-logs'));
app.use('/api/daily-logs', require('./routes/daily-logs'));
app.use('/api/projects/:id/inspections', require('./routes/project-inspections'));
app.use('/api/project-inspections', require('./routes/project-inspections'));
app.use('/api', require('./routes/observations'));
app.use('/api/projects/:id/punch-items', require('./routes/punch-items'));
app.use('/api/punch-items', require('./routes/punch-items'));
app.use('/api/projects/:id/drawings', require('./routes/drawings'));
app.use('/api/drawings', require('./routes/drawings'));
app.use('/api/projects/:id/specifications', require('./routes/specifications'));
app.use('/api/specifications', require('./routes/specifications'));
app.use('/api/projects/:id/cost', require('./routes/cost-management'));
app.use('/api/cost', require('./routes/cost-management'));
app.use('/api/projects/:id/schedule', require('./routes/schedule-items'));
app.use('/api/schedule-items', require('./routes/schedule-items'));
app.use('/api/projects/:id/timesheets', require('./routes/timesheets'));
app.use('/api/timesheets', require('./routes/timesheets'));
app.use('/api/projects/:id/meetings', require('./routes/meetings'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api/correspondence', require('./routes/correspondence'));
app.use('/api/projects/:id/incidents', require('./routes/incidents'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/projects/:id/permits', require('./routes/permits'));
app.use('/api/permits', require('./routes/permits'));
app.use('/api/projects/:id/companies', require('./routes/companies'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/projects/:id/photos', require('./routes/photos'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/projects/:id/documents', require('./routes/project-documents'));
app.use('/api/documents', require('./routes/project-documents'));
app.use('/api/project-documents', require('./routes/project-documents'));
app.get('/', (req, res) => res.json({ status: 'ok' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

async function migrate() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS changelog (
      id SERIAL PRIMARY KEY,
      table_name VARCHAR(100),
      record_id INTEGER,
      operation VARCHAR(20),
      field_changed VARCHAR(100),
      old_value TEXT,
      new_value TEXT,
      changed_by INTEGER REFERENCES users(id),
      changed_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Migration: changelog table ready');
  } catch (err) {
    console.error('Migration error:', err.message);
  }
}

const PORT = process.env.PORT || 4000;

// Phase 4: Mount Box and Excel routes
app.use('/api/box', boxRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/projects/:id/notifications', require('./routes/notifications'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/uploads', require('express').static(require('path').join(__dirname, '..', 'uploads')));
app.use('/api/excel', excelRoutes);
app.use('/api/budget', require('./routes/budget'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/drafts', require('./routes/drafts'));

// Sheets module — generic Smartsheet-style grid engine
app.use('/api/projects/:id/sheets', require('./routes/sheets'));
app.use('/api/sheets', require('./routes/sheets'));

// Automation engine — no-code trigger/condition/action rules
app.use('/api/projects/:id/automations', require('./routes/automations'));
app.use('/api/automations', require('./routes/automations'));

// Forms module — public/internal forms with submissions (public routes inside)
app.use('/api/projects/:id/forms', require('./routes/forms'));
app.use('/api/forms', require('./routes/forms'));

// Demo data seeder — guarded by SEED_TOKEN (disabled unless set)
app.use('/api/demo', require('./routes/demo'));

// Superhuman email client routes
const superhumanTracking = require('./routes/superhuman-tracking');
app.use('/', superhumanTracking); // Public tracking pixel at /t/:pixelId
app.use('/api/superhuman', require('./routes/superhuman-emails'));
app.use('/api/superhuman/ai', require('./routes/superhuman-ai'));
app.use('/api/superhuman', superhumanTracking); // Also mount stats under /api/superhuman/tracking/stats

// Claude Code — AI debugger integration
app.use('/api/claude-code', require('./routes/claude-code'));

// Admin Debug Report endpoint — writes to .claude-debug-request.txt
const fs = require('fs');
const path = require('path');
app.post('/api/debug-report', authenticate, requireRole('admin', 'superadmin'), (req, res) => {
  const report = req.body;
  const debugFile = path.join(__dirname, '..', '..', '.claude-debug-request.txt');
  const content = [
    '=== DEBUG REPORT ===',
    'Time: ' + (report.timestamp || new Date().toISOString()),
    'Route: ' + (report.route || 'unknown'),
    'URL: ' + (report.url || 'unknown'),
    'Viewport: ' + (report.viewport || 'unknown'),
    'User Agent: ' + (report.userAgent || 'unknown'),
    '',
    'ISSUE DESCRIPTION:',
    report.description || '(empty)',
    '',
    // Note: never persist auth tokens to disk. Record the reporting user instead.
    'REPORTED BY: user#' + (req.user?.id || '?') + ' (' + (req.user?.email || 'unknown') + '), project=' + (report.localStorage?.activeProject || 'none') + ', theme=' + (report.localStorage?.theme || 'dark'),
    '',
  ];
  if (report.consoleErrors && report.consoleErrors.length > 0) {
    content.push('CONSOLE ERRORS (' + report.consoleErrors.length + '):');
    report.consoleErrors.forEach(function(e) {
      content.push('  [' + (e.time || '') + '] ' + (e.msg || ''));
    });
    content.push('');
  }
  content.push('=== END REPORT ===');
  try {
    fs.writeFileSync(debugFile, content.join('\n'), 'utf8');
    console.log('[DEBUG] Report written to .claude-debug-request.txt');
    res.json({ ok: true });
  } catch (err) {
    console.error('[DEBUG] Failed to write report:', err.message);
    res.status(500).json({ error: 'Failed to write debug report' });
  }
});

const createSuperhumanTables = require('./db/superhuman-tables');
const { startSuperhumanCron } = require('./services/superhuman-cron');

const { startDueDateCron } = require('./notification-triggers');

// Central error handler — mounted last so it catches errors from all routes
// and keeps stack traces out of client responses in production.
app.use(errorHandler);

server.listen(PORT, async () => {
  console.log('Backend running on port ' + PORT);
  await migrate();
  // Auto-apply SQL migrations on boot so deploys need no manual step.
  try {
    const { runMigrations } = require('../migrate');
    await runMigrations();
  } catch (err) {
    console.error('[boot] migration runner error:', err.message);
  }
  await createSuperhumanTables();
  startSuperhumanCron();
  startDueDateCron();

  // Auto-seed demo data on boot when SEED_TOKEN is configured. The seeder is
  // idempotent (creates the demo project once, then only tops up modules that
  // are still empty), so running it on every boot is safe and means a deploy
  // backfills demo data with no manual step. Set SEED_ON_BOOT=false to skip.
  if (process.env.SEED_TOKEN && process.env.SEED_ON_BOOT !== 'false') {
    try {
      const { seedDemo } = require('./seed/demoSeed');
      const result = await seedDemo();
      console.log('[boot] demo seed ' + (result?.status || 'ok') + (result?.created ? ' — ' + JSON.stringify(result.created) : ''));
    } catch (err) {
      console.error('[boot] demo seed error:', err.message);
    }
  }
});





