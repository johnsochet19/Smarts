const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticate: auth } = require('../middleware/auth');

var uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

var storage = multer.diskStorage({
  destination: function(req, file, cb) { cb(null, uploadDir); },
  filename: function(req, file, cb) { cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')); }
});
var upload = multer({ storage: storage, limits: { fileSize: 25 * 1024 * 1024 } });

(async () => {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Attachments table ready');
  } catch(e) { console.error('Attachments migration error:', e.message); }
})();

router.get('/task/:taskId', auth, async (req, res) => {
  try {
    var r = await db.query('SELECT * FROM task_attachments WHERE task_id = $1 ORDER BY created_at DESC', [req.params.taskId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/task/:taskId', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    var r = await db.query(
      'INSERT INTO task_attachments (task_id, filename, original_name, file_size, mime_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.taskId, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype, req.user.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/download/:id', auth, async (req, res) => {
  try {
    var r = await db.query('SELECT * FROM task_attachments WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    var filePath = path.join(uploadDir, r.rows[0].filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
    res.download(filePath, r.rows[0].original_name);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    var r = await db.query('SELECT * FROM task_attachments WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    var filePath = path.join(uploadDir, r.rows[0].filename);
    try { fs.unlinkSync(filePath); } catch(e) {}
    await db.query('DELETE FROM task_attachments WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
