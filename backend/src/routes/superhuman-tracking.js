const express = require('express');
const router = express.Router();
const db = require('../db');

// 1x1 tracking pixel — public endpoint (no auth)
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

router.get('/t/:pixelId', async (req, res) => {
  try {
    const { pixelId } = req.params;
    const result = await db.query(
      'UPDATE email_tracking SET opened = true, opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1 WHERE pixel_id = $1 RETURNING *',
      [pixelId]
    );
    // Emit socket event if io is attached
    if (req.app.get('io') && result.rows.length > 0) {
      req.app.get('io').emit('email:opened', {
        messageId: result.rows[0].message_id,
        recipient: result.rows[0].recipient,
        subject: result.rows[0].subject,
        openCount: result.rows[0].open_count,
        openedAt: result.rows[0].opened_at
      });
    }
  } catch (e) {
    console.error('Tracking pixel error:', e.message);
  }
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
  res.send(PIXEL_GIF);
});

// Get tracking stats for user
router.get('/tracking/stats', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM email_tracking ORDER BY created_at DESC LIMIT 50');
    const opened = result.rows.filter(r => r.opened).length;
    res.json({ tracked: result.rows, totalTracked: result.rows.length, totalOpened: opened, openRate: result.rows.length ? (opened / result.rows.length * 100).toFixed(1) : 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
