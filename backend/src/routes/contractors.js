const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate: auth } = require('../middleware/auth');

// GET all companies
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM companies ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET companies for a project
router.get('/projects/:id/contractors', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT c.*, pc.role, pc.status, pc.start_date, pc.end_date, pc.id as assignment_id FROM companies c JOIN project_contractors pc ON c.id = pc.company_id WHERE pc.project_id = $1 ORDER BY c.name ASC', [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create company
router.post('/', auth, async (req, res) => {
  try {
    const { name, type, license_number, license_expiry, insurance_expiry, prequalified, trades, address, city, state, zip, phone, email, website, notes } = req.body;
    const result = await pool.query('INSERT INTO companies (name, type, license_number, license_expiry, insurance_expiry, prequalified, trades, address, city, state, zip, phone, email, website, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *', [name, type, license_number, license_expiry, insurance_expiry, prequalified || false, JSON.stringify(trades || []), address, city, state, zip, phone, email, website, notes]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update company
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, type, license_number, license_expiry, insurance_expiry, prequalified, trades, address, city, state, zip, phone, email, website, notes } = req.body;
    const result = await pool.query('UPDATE companies SET name=$1, type=$2, license_number=$3, license_expiry=$4, insurance_expiry=$5, prequalified=$6, trades=$7, address=$8, city=$9, state=$10, zip=$11, phone=$12, email=$13, website=$14, notes=$15 WHERE id=$16 RETURNING *', [name, type, license_number, license_expiry, insurance_expiry, prequalified || false, JSON.stringify(trades || []), address, city, state, zip, phone, email, website, notes, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE company
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST assign company to project
router.post('/projects/:id/contractors', auth, async (req, res) => {
  try {
    const { company_id, role, status, start_date, end_date } = req.body;
    const result = await pool.query('INSERT INTO project_contractors (project_id, company_id, role, status, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (project_id, company_id) DO UPDATE SET role=$3, status=$4, start_date=$5, end_date=$6 RETURNING *', [req.params.id, company_id, role, status || 'active', start_date, end_date]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE remove company from project
router.delete('/projects/:id/contractors/:companyId', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM project_contractors WHERE project_id=$1 AND company_id=$2', [req.params.id, req.params.companyId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;