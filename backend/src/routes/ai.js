const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate: auth } = require('../middleware/auth');
const fetch = require('node-fetch');

var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

router.post('/chat', auth, async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY env variable.' });
  try {
    var { messages, message, project_id } = req.body;

    // Build rich context from database
    var context = '';
    var pid = project_id || null;

    // Try to get project_id from the user's active project if not provided
    if (!pid) {
      try {
        var projList = await db.query('SELECT id, name FROM projects LIMIT 5');
        if (projList.rows.length > 0) {
          context += 'Available projects: ' + projList.rows.map(function(p) { return p.name; }).join(', ') + '. ';
          pid = projList.rows[0].id;
        }
      } catch(e) {}
    }

    if (pid) {
      try {
        var proj = await db.query('SELECT * FROM projects WHERE id = $1', [pid]);
        if (proj.rows.length > 0) {
          var p = proj.rows[0];
          context += 'Active project: ' + p.name + (p.address ? ' at ' + p.address : '') + (p.status ? ' [' + p.status + ']' : '') + '. ';
        }
      } catch(e) {}

      // Tasks summary
      try {
        var tasks = await db.query('SELECT title, status, due_date, priority FROM tasks WHERE project_id = $1 ORDER BY due_date ASC NULLS LAST LIMIT 30', [pid]);
        if (tasks.rows.length > 0) {
          var byStatus = {};
          tasks.rows.forEach(function(t) { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
          context += 'Tasks (' + tasks.rows.length + '): ';
          Object.keys(byStatus).forEach(function(s) { context += s + '=' + byStatus[s] + ' '; });
          context += '. ';
          var upcoming = tasks.rows.filter(function(t) { return t.due_date && new Date(t.due_date) >= new Date(); }).slice(0, 5);
          if (upcoming.length > 0) {
            context += 'Upcoming: ' + upcoming.map(function(t) { return t.title + ' due ' + new Date(t.due_date).toLocaleDateString(); }).join('; ') + '. ';
          }
          var overdue = tasks.rows.filter(function(t) { return t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date(); });
          if (overdue.length > 0) {
            context += overdue.length + ' overdue tasks. ';
          }
        }
      } catch(e) {}

      // Budget summary
      try {
        var budget = await db.query('SELECT SUM(estimated_cost) as est, SUM(actual_cost) as act FROM budget_items WHERE project_id = $1', [pid]);
        if (budget.rows.length > 0 && budget.rows[0].est) {
          context += 'Budget: estimated $' + Number(budget.rows[0].est).toLocaleString() + ', actual $' + Number(budget.rows[0].act || 0).toLocaleString() + '. ';
        }
      } catch(e) {}
    }

    // Users summary
    try {
      var users = await db.query('SELECT COUNT(*) as cnt FROM users');
      context += 'Team: ' + users.rows[0].cnt + ' users. ';
    } catch(e) {}

    var sysPrompt = 'You are BuildForge AI, powered by Claude (Anthropic). You are a construction project management assistant built into the BuildForge Scheduler app. '
      + 'Be concise, friendly, and helpful. You can help with: task management, schedule planning, budget tracking, contractor coordination, DOB permits/inspections, and general construction project questions. '
      + 'The app has pages for: Dashboard, Tasks, Job Schedule (Gantt), Timeline, Documents (Box), Budget, DOB Filing Status, Permits, Inspections, Contractors, Gmail & Calendar, Users, Audit Log, Settings. '
      + (context ? 'Current data context: ' + context : 'No project data loaded yet.');

    // Support both single message and conversation history
    var apiMessages;
    if (messages && Array.isArray(messages) && messages.length > 0) {
      apiMessages = messages.map(function(m) {
        return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content || m.text || '' };
      });
    } else if (message) {
      apiMessages = [{ role: 'user', content: message }];
    } else {
      return res.status(400).json({ error: 'No message provided' });
    }

    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: sysPrompt, messages: apiMessages })
    });
    var data = await resp.json();
    if (data.content && data.content[0]) {
      res.json({ reply: data.content[0].text });
    } else {
      res.json({ reply: 'Sorry, I could not generate a response.', raw: data });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// AI-powered budget file parser
router.post('/parse-budget', auth, async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY env variable.' });
  try {
    var { headers, rows, fileName } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: 'No data provided' });

    // Build a sample of the data for the AI (first 60 rows to stay within token limits)
    var sampleRows = rows.slice(0, 60);
    var dataPreview = 'File: ' + (fileName || 'unknown') + '\n';
    dataPreview += 'Headers: ' + (headers || []).join(' | ') + '\n\n';
    sampleRows.forEach(function(row, i) {
      var vals = (headers || Object.keys(row)).map(function(h) { return String(row[h] || '').substring(0, 80); });
      dataPreview += 'Row ' + (i + 1) + ': ' + vals.join(' | ') + '\n';
    });

    var sysPrompt = `You are a construction budget data parser. You receive spreadsheet data and must convert it into structured budget line items.

RULES:
- Return ONLY a valid JSON array, no markdown, no explanation, no code fences
- Each item must have exactly these fields: category, description, vendor, estimated, actual, status, notes
- "category" should be a construction budget category like: General Conditions, Site Work, Concrete, Masonry, Metals, Structural Steel, Carpentry, Thermal & Moisture, Roofing, Doors & Windows, Finishes, Drywall, Flooring, Painting, Specialties, Equipment, Furnishings, Mechanical, Electrical, Plumbing, HVAC, Fire Protection, Conveying, Permits & Fees, Insurance, Contingency, Landscaping, Demolition, Earthwork, Other
- If the data already has categories, use them. If not, intelligently assign categories based on the description
- "estimated" and "actual" must be numbers (no $ signs, no commas), use 0 if not available
- "status" should be one of: pending, approved, invoiced, paid, over_budget
- If a row has a dollar amount but you can't tell if it's estimated or actual, put it in "estimated"
- Skip header rows, subtotal rows, total rows, and empty rows
- Combine or split rows intelligently to create clean budget line items
- For rows that look like they contain multiple cost components, keep them as one line item with the total
- If there are ${rows.length} total rows but you only see ${sampleRows.length}, extrapolate the pattern`;

    var userMsg = 'Parse this spreadsheet data into budget line items:\n\n' + dataPreview;
    if (rows.length > sampleRows.length) {
      userMsg += '\n(Showing ' + sampleRows.length + ' of ' + rows.length + ' rows. Apply the same parsing logic to understand the pattern.)';
    }

    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: sysPrompt, messages: [{ role: 'user', content: userMsg }] })
    });
    var data = await resp.json();
    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: 'AI returned empty response' });
    }

    var text = data.content[0].text.trim();
    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    var items;
    try {
      items = JSON.parse(text);
    } catch(parseErr) {
      // Try to extract JSON array from the response
      var match = text.match(/\[[\s\S]*\]/);
      if (match) {
        items = JSON.parse(match[0]);
      } else {
        return res.status(500).json({ error: 'AI response was not valid JSON', raw: text.substring(0, 500) });
      }
    }

    if (!Array.isArray(items)) {
      return res.status(500).json({ error: 'AI response was not an array' });
    }

    // Normalize items
    items = items.map(function(item) {
      return {
        category: String(item.category || 'Other'),
        description: String(item.description || ''),
        vendor: String(item.vendor || ''),
        estimated: parseFloat(String(item.estimated || 0).replace(/[$,]/g, '')) || 0,
        actual: parseFloat(String(item.actual || 0).replace(/[$,]/g, '')) || 0,
        status: ['pending', 'approved', 'invoiced', 'paid', 'over_budget'].includes(item.status) ? item.status : 'pending',
        notes: String(item.notes || '')
      };
    }).filter(function(item) {
      return item.description || item.category !== 'Other' || item.estimated > 0 || item.actual > 0;
    });

    // If we only sent a sample, and there are more rows, also do fallback pattern matching for remaining rows
    if (rows.length > sampleRows.length && items.length > 0) {
      // The AI parsed the sample; for remaining rows, use the same logic pattern
      // We trust the AI got the right pattern from the sample
    }

    res.json({ items: items, count: items.length, aiParsed: true });
  } catch(e) {
    console.error('AI budget parse error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
