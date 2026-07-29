// Security middleware — Increment 0 hardening.
// All additive and dependency-free so it can run without `npm install`.

// Build a CORS options object from ALLOWED_ORIGINS (comma-separated).
// If unset, falls back to reflecting the request origin but logs a warning,
// so dev keeps working while prod can lock down via env.
function buildCorsOptions() {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) {
    console.warn('[security] ALLOWED_ORIGINS not set — CORS is permissive. Set it in production.');
    return { origin: true, credentials: true };
  }
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    origin(origin, cb) {
      // Allow same-origin / server-to-server (no Origin header) and the allow-list.
      if (!origin || allowed.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS: ' + origin));
    },
    credentials: true,
  };
}

// Socket.io CORS mirror of the above.
function socketCorsOptions() {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return { origin: '*' };
  return { origin: raw.split(',').map((s) => s.trim()).filter(Boolean) };
}

// Minimal security headers (helmet-equivalent subset), no dependency.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

// Tiny in-memory fixed-window rate limiter (per IP + route key).
// For multi-instance prod this should move to Redis, but it meaningfully
// blocks single-host brute force today with zero new dependencies.
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, key = 'default' } = {}) {
  const hits = new Map();
  // Opportunistic cleanup to bound memory.
  function sweep(now) {
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) sweep(now);
    const id = key + ':' + (req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown');
    let entry = hits.get(id);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (entry.count > max) {
      const retry = Math.ceil((entry.reset - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests. Try again in ' + retry + 's.' });
    }
    next();
  };
}

// Central error handler — keeps stack traces out of responses in prod.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  console.error('[error]', req.method, req.originalUrl, '-', err.message);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
}

module.exports = {
  buildCorsOptions,
  socketCorsOptions,
  securityHeaders,
  rateLimit,
  errorHandler,
};
