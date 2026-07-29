// Demo seeding endpoint — guarded by SEED_TOKEN so it's disabled by default.
// Visit  /api/demo/seed?token=YOUR_TOKEN  once to populate demo data.
const router = require('express').Router();
const { seedDemo } = require('../seed/demoSeed');

function guard(req, res, next) {
  if (!process.env.SEED_TOKEN) {
    return res.status(403).json({ error: 'Seeding is disabled. Set the SEED_TOKEN env var on the backend to enable it.' });
  }
  if (req.query.token !== process.env.SEED_TOKEN) {
    return res.status(403).json({ error: 'Invalid or missing token.' });
  }
  next();
}

// GET so it can be triggered from a browser address bar.
router.get('/seed', guard, async (req, res) => {
  try {
    const result = await seedDemo();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[demo-seed] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
