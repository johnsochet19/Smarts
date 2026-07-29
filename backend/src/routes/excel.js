const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');

// Multer config for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'));
    }
  }
});

// Parse Excel and return preview data
router.post('/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetNames = workbook.SheetNames;
    const sheets = {};

    sheetNames.forEach(name => {
      const sheet = workbook.Sheets[name];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const headers = data.length > 0 ? Object.keys(data[0]) : [];
      sheets[name] = { headers, rows: data.slice(0, 50), totalRows: data.length };
    });

    res.json({ sheetNames, sheets });
  } catch (err) {
    console.error('Excel preview error:', err);
    res.status(400).json({ error: 'Failed to parse Excel file: ' + err.message });
  }
});

// Import Excel as tasks
router.post('/import-tasks', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { mapping, sheetName, projectId } = req.body;
    const columnMap = JSON.parse(mapping);

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[sheetName || workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const tasks = [];
    const errors = [];

    data.forEach((row, idx) => {
      try {
        const taskName = row[columnMap.task_name];
        if (!taskName) {
          errors.push(`Row ${idx + 2}: Missing task name`);
          return;
        }

        let startDate = null;
        let endDate = null;
        let duration = null;

        // Parse start date
        if (columnMap.start_date && row[columnMap.start_date]) {
          const val = row[columnMap.start_date];
          if (val instanceof Date) {
            startDate = val.toISOString().split('T')[0];
          } else {
            const parsed = new Date(val);
            if (!isNaN(parsed)) startDate = parsed.toISOString().split('T')[0];
          }
        }

        // Parse end date
        if (columnMap.end_date && row[columnMap.end_date]) {
          const val = row[columnMap.end_date];
          if (val instanceof Date) {
            endDate = val.toISOString().split('T')[0];
          } else {
            const parsed = new Date(val);
            if (!isNaN(parsed)) endDate = parsed.toISOString().split('T')[0];
          }
        }

        // Parse duration
        if (columnMap.duration && row[columnMap.duration]) {
          const val = row[columnMap.duration];
          duration = parseInt(val) || null;
        }

        // Calculate missing values
        if (startDate && endDate && !duration) {
          const s = new Date(startDate);
          const e = new Date(endDate);
          duration = Math.ceil((e - s) / (1000 * 60 * 60 * 24));
        } else if (startDate && duration && !endDate) {
          const s = new Date(startDate);
          s.setDate(s.getDate() + duration);
          endDate = s.toISOString().split('T')[0];
        }

        // Default start date to today
        if (!startDate) {
          startDate = new Date().toISOString().split('T')[0];
        }
        if (!duration) duration = 7;
        if (!endDate) {
          const s = new Date(startDate);
          s.setDate(s.getDate() + duration);
          endDate = s.toISOString().split('T')[0];
        }

        const task = {
          task_name: taskName,
          start_date: startDate,
          end_date: endDate,
          duration_days: duration,
          status: 'Not Started',
          phase: '',
          color: '#3b82f6'
        };

        // Optional fields
        if (columnMap.status && row[columnMap.status]) {
          const s = row[columnMap.status].toString().toLowerCase();
          if (s.includes('progress') || s.includes('active') || s.includes('ongoing')) task.status = 'In Progress';
          else if (s.includes('complete') || s.includes('done') || s.includes('finish')) task.status = 'Complete';
          else if (s.includes('not') || s.includes('pending') || s.includes('todo')) task.status = 'Not Started';
          else task.status = row[columnMap.status];
        }

        if (columnMap.phase && row[columnMap.phase]) {
          task.phase = row[columnMap.phase].toString();
        }

        if (columnMap.assigned_to && row[columnMap.assigned_to]) {
          task.assigned_to_name = row[columnMap.assigned_to].toString();
        }

        if (columnMap.notes && row[columnMap.notes]) {
          task.notes = row[columnMap.notes].toString();
        }

        tasks.push(task);
      } catch (rowErr) {
        errors.push(`Row ${idx + 2}: ${rowErr.message}`);
      }
    });

    // Return parsed tasks for the frontend to create via existing task API
    res.json({
      tasks,
      errors,
      totalParsed: tasks.length,
      totalErrors: errors.length,
      projectId: projectId || null
    });
  } catch (err) {
    console.error('Excel import error:', err);
    res.status(400).json({ error: 'Failed to import Excel: ' + err.message });
  }
});

module.exports = router;
