const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate: auth } = require('../middleware/auth');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// Map routes to their relevant source files
var ROUTE_FILE_MAP = {
  '/dashboard': ['frontend/src/App.jsx'],
  '/tasks': ['frontend/src/App.jsx', 'backend/src/routes/tasks.js'],
  '/schedule': ['frontend/src/App.jsx', 'backend/src/routes/schedule.js'],
  '/timeline': ['frontend/src/App.jsx'],
  '/documents': ['frontend/src/pages/Documents.jsx', 'backend/src/routes/box.js'],
  '/sheets': ['frontend/src/pages/GoogleSheets.jsx', 'backend/src/routes/google.js'],
  '/budget': ['frontend/src/App.jsx', 'backend/src/routes/budget.js'],
  '/gmail': ['frontend/src/superhuman/SuperhumanApp.jsx', 'frontend/src/superhuman/SuperhumanContext.jsx', 'frontend/src/superhuman/EmailDetail.jsx', 'frontend/src/superhuman/ComposeModal.jsx', 'frontend/src/superhuman/EmailList.jsx', 'backend/src/routes/superhuman-emails.js'],
  '/calendar': ['frontend/src/App.jsx', 'backend/src/routes/google.js'],
  '/contractors': ['frontend/src/App.jsx'],
  '/settings': ['frontend/src/App.jsx'],
  '/users': ['frontend/src/App.jsx', 'backend/src/routes/users.js'],
  '/permits': ['frontend/src/App.jsx'],
  '/filing-status': ['frontend/src/App.jsx'],
  '/inspections': ['frontend/src/App.jsx'],
  '/projects': ['frontend/src/App.jsx', 'backend/src/routes/projects.js'],
  '/audit': ['frontend/src/App.jsx'],
};

// Read a source file safely (truncate if huge)
function readSourceFile(relPath, maxLines) {
  maxLines = maxLines || 200;
  var projectRoot = path.join(__dirname, '..', '..', '..');
  var fullPath = path.join(projectRoot, relPath);
  try {
    if (!fs.existsSync(fullPath)) return null;
    var content = fs.readFileSync(fullPath, 'utf8');
    var lines = content.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join('\n') + '\n... (' + (lines.length - maxLines) + ' more lines)';
    }
    return content;
  } catch (e) {
    return null;
  }
}

// Collect DB diagnostics
async function collectDbDiagnostics() {
  var diagnostics = {};
  try {
    var tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    diagnostics.tables = tables.rows.map(function(r) { return r.tablename; });
  } catch (e) { diagnostics.tables = 'Error: ' + e.message; }

  try {
    var counts = {};
    var key_tables = ['users', 'projects', 'tasks', 'budget_items', 'superhuman_emails', 'notifications'];
    for (var i = 0; i < key_tables.length; i++) {
      try {
        var r = await db.query('SELECT COUNT(*) as cnt FROM ' + key_tables[i]);
        counts[key_tables[i]] = parseInt(r.rows[0].cnt);
      } catch (e) { counts[key_tables[i]] = 'table missing'; }
    }
    diagnostics.rowCounts = counts;
  } catch (e) { diagnostics.rowCounts = 'Error: ' + e.message; }

  return diagnostics;
}

// Collect route/API diagnostics
function collectRouteDiagnostics() {
  var app;
  try {
    // Get the express app from the parent
    app = require('../index');
  } catch (e) {}

  return {
    backendPort: process.env.PORT || 4000,
    nodeEnv: process.env.NODE_ENV || 'development',
    hasAnthropicKey: !!ANTHROPIC_KEY,
    hasGoogleCreds: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    uptime: Math.round(process.uptime()) + 's',
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };
}

// Main diagnostic + AI chat endpoint
router.post('/diagnose', auth, async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set. Claude Code requires this to work.' });

  try {
    var { message, route, consoleErrors, history } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    // 1. Collect context
    var dbDiag = await collectDbDiagnostics();
    var routeDiag = collectRouteDiagnostics();

    // 2. Read relevant source files
    var sourceContext = {};
    var relevantFiles = ROUTE_FILE_MAP[route] || ['frontend/src/App.jsx'];
    // Always include the main entry
    if (relevantFiles.indexOf('frontend/src/App.jsx') === -1) {
      relevantFiles.push('frontend/src/App.jsx');
    }
    // For large files like App.jsx, only include first 150 lines + search for relevant section
    for (var i = 0; i < relevantFiles.length; i++) {
      var f = relevantFiles[i];
      var maxLines = f === 'frontend/src/App.jsx' ? 100 : 300;
      var content = readSourceFile(f, maxLines);
      if (content) sourceContext[f] = content;
    }

    // 3. If the issue mentions a specific component/page, try to find it in App.jsx
    var projectRoot = path.join(__dirname, '..', '..', '..');
    var appJsxPath = path.join(projectRoot, 'frontend', 'src', 'App.jsx');
    if (fs.existsSync(appJsxPath)) {
      var fullApp = fs.readFileSync(appJsxPath, 'utf8');

      // Find the page component for the current route
      if (route) {
        var routeClean = route.replace('/', '');
        // Search for the component function
        var patterns = [
          new RegExp('function\\s+\\w*' + routeClean + '\\w*\\s*\\(', 'i'),
          new RegExp('route\\s*===\\s*"' + route + '"', 'i'),
        ];
        for (var p = 0; p < patterns.length; p++) {
          var match = fullApp.match(patterns[p]);
          if (match) {
            var idx = fullApp.indexOf(match[0]);
            var start = Math.max(0, idx - 200);
            var end = Math.min(fullApp.length, idx + 3000);
            sourceContext['App.jsx (route section for ' + route + ')'] = fullApp.slice(start, end);
            break;
          }
        }
      }
    }

    // 4. Build the system prompt
    var systemPrompt = `You are Claude Code, an AI debugger integrated into the BuildForge construction management app.

YOUR ROLE: When a user reports something is broken or not working, you:
1. Analyze the issue using the source code, database state, and error logs provided
2. Identify the root cause
3. Explain what's wrong in plain language
4. Provide the exact fix (code changes needed)

IMPORTANT RULES:
- Be specific. Don't say "check your code" — point to exact lines and files.
- If you see the bug in the source code, show the fix with before/after.
- If it's a backend issue (API not responding, DB error), say so clearly.
- If it's a frontend issue (component crash, wrong state), say so clearly.
- If data is missing from the DB, say what needs to be added.
- Keep responses concise but complete. No fluff.

APP ARCHITECTURE:
- Frontend: React 19 + Vite 7, deployed on Vercel
- Backend: Express.js on Railway (PostgreSQL)
- API base: /api/* routes
- Auth: JWT token stored as cpm_token in localStorage
- Email: Gmail API via Superhuman UI (frontend/src/superhuman/*)
- Sheets: Google Sheets API (backend/src/routes/google.js)
- All pages defined inline in App.jsx except Documents, GoogleSheets, AIChatPanel, SuperhumanApp

CURRENT DIAGNOSTICS:
- Backend: port=${routeDiag.backendPort}, uptime=${routeDiag.uptime}, memory=${routeDiag.memoryMB}MB
- Node env: ${routeDiag.nodeEnv}
- Anthropic API key: ${routeDiag.hasAnthropicKey ? 'configured' : 'MISSING'}
- Google credentials: ${routeDiag.hasGoogleCreds ? 'configured' : 'MISSING'}
- Database tables: ${JSON.stringify(dbDiag.tables)}
- Row counts: ${JSON.stringify(dbDiag.rowCounts)}

${Object.keys(sourceContext).length > 0 ? 'RELEVANT SOURCE CODE:\n' + Object.keys(sourceContext).map(function(k) {
  return '--- ' + k + ' ---\n' + sourceContext[k];
}).join('\n\n') : 'No source code available.'}

${consoleErrors && consoleErrors.length > 0 ? 'BROWSER CONSOLE ERRORS:\n' + consoleErrors.map(function(e) { return '[' + (e.time || '') + '] ' + (e.msg || ''); }).join('\n') : 'No console errors reported.'}`;

    // 5. Build messages array
    var apiMessages = [];
    if (history && Array.isArray(history)) {
      history.forEach(function(m) {
        apiMessages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text || m.content || '' });
      });
    }
    apiMessages.push({ role: 'user', content: message });

    // 6. Call Claude API
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: apiMessages
      })
    });

    var data = await resp.json();
    if (data.content && data.content[0]) {
      res.json({
        reply: data.content[0].text,
        diagnostics: {
          route: route,
          filesChecked: Object.keys(sourceContext),
          dbTables: dbDiag.tables,
          rowCounts: dbDiag.rowCounts,
          backendStatus: routeDiag
        }
      });
    } else {
      res.json({ reply: 'Sorry, I could not analyze this issue. Raw response: ' + JSON.stringify(data), diagnostics: {} });
    }
  } catch (e) {
    console.error('[Claude Code] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Quick health check endpoint
router.get('/status', async (req, res) => {
  var dbOk = false;
  try { await db.query('SELECT 1'); dbOk = true; } catch (e) {}
  res.json({
    status: 'ok',
    ai: !!ANTHROPIC_KEY,
    db: dbOk,
    uptime: Math.round(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  });
});

module.exports = router;
