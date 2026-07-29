const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function parseMSProjectXML(xmlStr) {
  var tasks = [];
  var taskRegex = /<Task>([\s\S]*?)<\/Task>/gi;
  var match;
  while ((match = taskRegex.exec(xmlStr)) !== null) {
    var block = match[1];
    var get = function(tag) {
      var m = block.match(new RegExp('<' + tag + '>(.*?)<\/' + tag + '>', 'i'));
      return m ? m[1] : '';
    };
    var uid = get('UID');
    var name = get('Name');
    var start = get('Start');
    var finish = get('Finish');
    var duration = get('Duration');
    var pctComplete = get('PercentComplete') || '0';
    var outlineLevel = get('OutlineLevel') || '0';
    var summary = get('Summary') || '0';
    var milestone = get('Milestone') || '0';
    var wbs = get('WBS');
    var notes = get('Notes');
    var predecessors = [];
    var predRegex = /<PredecessorLink>([\s\S]*?)<\/PredecessorLink>/gi;
    var pm;
    while ((pm = predRegex.exec(block)) !== null) {
      var predUid = pm[1].match(/<PredecessorUID>(.*?)<\/PredecessorUID>/i);
      if (predUid) predecessors.push(predUid[1]);
    }
    if (name && name !== '') {
      tasks.push({ uid: uid, name: name, start: start ? start.substring(0, 10) : '', finish: finish ? finish.substring(0, 10) : '', duration: duration, percent_complete: parseInt(pctComplete) || 0, outline_level: parseInt(outlineLevel) || 0, is_summary: summary === '1', is_milestone: milestone === '1', wbs: wbs, notes: notes, predecessors: predecessors });
    }
  }
  return tasks;
}

function parseExcel(buffer) {
  var wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  var sheet = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) return [];
  var headers = Object.keys(rows[0]);
  function findCol(keywords) {
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i].toLowerCase();
      for (var j = 0; j < keywords.length; j++) { if (h.indexOf(keywords[j]) >= 0) return headers[i]; }
    }
    return null;
  }
  var nameCol = findCol(['task','name','activity','description','item']);
  var startCol = findCol(['start','begin','from']);
  var finishCol = findCol(['finish','end','to','due']);
  var durationCol = findCol(['duration','days','length']);
  var pctCol = findCol(['percent','pct','%','progress','complete']);
  var wbsCol = findCol(['wbs','id','#','number']);
  var predCol = findCol(['predecessor','depends','dependency']);
  var notesCol = findCol(['notes','comment','remarks']);
  function parseDate(val) {
    if (!val) return '';
    if (val instanceof Date) return val.toISOString().substring(0,10);
    var d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0,10);
    return String(val);
  }
  return rows.map(function(row, i) {
    var name = nameCol ? String(row[nameCol]) : '';
    if (!name || name === 'undefined') return null;
    return { uid: String(i+1), name: name, start: startCol ? parseDate(row[startCol]) : '', finish: finishCol ? parseDate(row[finishCol]) : '', duration: durationCol ? String(row[durationCol]) : '', percent_complete: pctCol ? (parseInt(row[pctCol]) || 0) : 0, outline_level: 0, is_summary: false, is_milestone: false, wbs: wbsCol ? String(row[wbsCol]) : String(i+1), notes: notesCol ? String(row[notesCol]) : '', predecessors: predCol ? String(row[predCol]).split(/[,;]/).filter(Boolean) : [] };
  }).filter(Boolean);
}

router.post('/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    var fn = req.file.originalname.toLowerCase();
    var tasks;
    if (fn.endsWith('.xml')) { tasks = parseMSProjectXML(req.file.buffer.toString('utf-8')); }
    else if (fn.endsWith('.xlsx') || fn.endsWith('.xls') || fn.endsWith('.csv')) { tasks = parseExcel(req.file.buffer); }
    else { return res.status(400).json({ error: 'Unsupported format. Use .xml, .xlsx, .xls, or .csv' }); }
    res.json({ tasks: tasks, total: tasks.length, filename: req.file.originalname, source: fn.endsWith('.xml') ? 'Microsoft Project' : 'Excel' });
  } catch(e) { console.error('Schedule import error:', e); res.status(500).json({ error: 'Failed to parse: ' + e.message }); }
});

module.exports = router;
