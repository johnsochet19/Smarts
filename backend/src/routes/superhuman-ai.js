const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function askClaude(systemPrompt, userPrompt) {
  const client = getClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  return response.content[0].text;
}

// AI Reply draft
router.post('/reply', async (req, res) => {
  try {
    const { emailBody, senderName, subject, tone, instructions } = req.body;
    const system = `You are an expert email assistant. Write a professional email reply.
Tone: ${tone || 'professional'}. Be concise and direct. Output ONLY the reply body, no subject line.`;
    const prompt = `Original email from ${senderName || 'sender'}:
Subject: ${subject || ''}
---
${emailBody || ''}
---
${instructions ? 'Additional instructions: ' + instructions : ''}
Write a reply:`;
    const reply = await askClaude(system, prompt);
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Notes to email
router.post('/from-notes', async (req, res) => {
  try {
    const { notes, recipientName, tone, context } = req.body;
    const system = `You are an expert email composer. Convert rough notes into a polished professional email.
Tone: ${tone || 'professional'}. Output subject line on first line prefixed with "Subject: " then a blank line, then the email body.`;
    const prompt = `Notes: ${notes}
Recipient: ${recipientName || 'recipient'}
${context ? 'Context: ' + context : ''}
Compose the email:`;
    const result = await askClaude(system, prompt);
    let subject = '', body = result;
    if (result.startsWith('Subject:')) {
      const lines = result.split('\n');
      subject = lines[0].replace('Subject:', '').trim();
      body = lines.slice(2).join('\n').trim();
    }
    res.json({ subject, body });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Follow-up suggestion
router.post('/followup', async (req, res) => {
  try {
    const { emailBody, subject, senderName, daysSince } = req.body;
    const system = `You are an email assistant. Write a brief, polite follow-up email. Be concise. Output ONLY the email body.`;
    const prompt = `Original email subject: ${subject}
Sent to: ${senderName || 'recipient'}
Days since sent: ${daysSince || 3}
Original message snippet: ${(emailBody || '').substring(0, 500)}
Write a follow-up:`;
    const followup = await askClaude(system, prompt);
    res.json({ followup });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Thread summary
router.post('/summarize-thread', async (req, res) => {
  try {
    const { messages } = req.body;
    const system = `You are an email assistant. Summarize the email thread in 2-4 bullet points. Focus on key decisions, action items, and outcomes.`;
    const threadText = (messages || []).map((m, i) =>
      `Message ${i + 1} from ${m.from || 'unknown'} (${m.date || ''}):\n${m.snippet || m.body || ''}`
    ).join('\n---\n');
    const summary = await askClaude(system, `Summarize this thread:\n${threadText}`);
    res.json({ summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tone analysis
router.post('/analyze-tone', async (req, res) => {
  try {
    const { text } = req.body;
    const system = `You are an email tone analyzer. Analyze the tone of the given text and respond with a JSON object:
{"tone": "professional|casual|urgent|friendly|formal|aggressive", "confidence": 0.0-1.0, "suggestions": ["suggestion1"], "sentiment": "positive|neutral|negative"}
Output ONLY valid JSON, nothing else.`;
    const result = await askClaude(system, `Analyze this text:\n${text}`);
    try {
      const parsed = JSON.parse(result);
      res.json(parsed);
    } catch {
      res.json({ tone: 'professional', confidence: 0.5, suggestions: [], sentiment: 'neutral' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Contact insight
router.post('/contact-insight', async (req, res) => {
  try {
    const { email, name, recentEmails } = req.body;
    const db = require('../db');
    const contact = await db.query('SELECT * FROM email_contacts WHERE email = $1', [email]);
    const system = `You are an email assistant providing brief contact context. Respond in 2-3 sentences about the contact relationship based on email history.`;
    const emailSummary = (recentEmails || []).slice(0, 5).map(e => `- ${e.subject} (${e.date})`).join('\n');
    const prompt = `Contact: ${name || email}
Email: ${email}
Total emails exchanged: ${contact.rows[0]?.email_count || 'unknown'}
Recent emails:\n${emailSummary || 'No recent emails available'}
Provide a brief relationship insight:`;
    const insight = await askClaude(system, prompt);
    res.json({ insight, contact: contact.rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
