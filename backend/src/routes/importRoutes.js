const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.post('/csv', authenticate, requireRole('admin', 'editor'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const content = req.file.buffer.toString('utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || null; });
      if (row.name && row.start_date && row.finish_date) {
        await db.query(
          'INSERT INTO tasks (name, start_date, finish_date, duration_days, phase, status, color, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [row.name, row.start_date, row.finish_date, row.duration_days, row.phase, row.status || 'not_started', row.color || '#3b82f6', row.notes]
        );
        imported++;
      }
    }
    res.json({ message: imported + ' tasks imported' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
