const { test } = require('node:test');
const assert = require('node:assert');
const { rateLimit, securityHeaders, buildCorsOptions, socketCorsOptions } = require('../src/middleware/security');

// Tiny mock res that records headers and status/json.
function mockRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('securityHeaders sets hardening headers', () => {
  const res = mockRes();
  let called = false;
  securityHeaders({}, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN');
});

test('rateLimit allows up to max then blocks with 429', () => {
  const mw = rateLimit({ windowMs: 60000, max: 3, key: 't' });
  const req = { ip: '1.2.3.4', headers: {} };
  let passes = 0;
  for (let i = 0; i < 3; i++) {
    const res = mockRes();
    mw(req, res, () => { passes++; });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(passes, 3);
  // 4th request over the window limit is blocked.
  const res = mockRes();
  let blockedPassed = false;
  mw(req, res, () => { blockedPassed = true; });
  assert.equal(blockedPassed, false);
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['Retry-After']);
});

test('rateLimit isolates different IPs', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, key: 'iso' });
  const a = mockRes(); let aPass = false;
  mw({ ip: 'a', headers: {} }, a, () => { aPass = true; });
  const b = mockRes(); let bPass = false;
  mw({ ip: 'b', headers: {} }, b, () => { bPass = true; });
  assert.equal(aPass, true);
  assert.equal(bPass, true); // different IP not affected by a's usage
});

test('buildCorsOptions is permissive when ALLOWED_ORIGINS unset', () => {
  delete process.env.ALLOWED_ORIGINS;
  const opts = buildCorsOptions();
  assert.equal(opts.origin, true);
});

test('buildCorsOptions enforces allow-list when set', () => {
  process.env.ALLOWED_ORIGINS = 'https://app.example.com, https://www.example.com';
  const opts = buildCorsOptions();
  // allowed origin
  opts.origin('https://app.example.com', (err, ok) => {
    assert.equal(err, null);
    assert.equal(ok, true);
  });
  // disallowed origin
  opts.origin('https://evil.example.com', (err) => {
    assert.ok(err instanceof Error);
  });
  // no-origin (server-to-server) allowed
  opts.origin(undefined, (err, ok) => {
    assert.equal(err, null);
    assert.equal(ok, true);
  });
  delete process.env.ALLOWED_ORIGINS;
});

test('socketCorsOptions reflects env', () => {
  delete process.env.ALLOWED_ORIGINS;
  assert.deepEqual(socketCorsOptions(), { origin: '*' });
  process.env.ALLOWED_ORIGINS = 'https://a.com,https://b.com';
  assert.deepEqual(socketCorsOptions(), { origin: ['https://a.com', 'https://b.com'] });
  delete process.env.ALLOWED_ORIGINS;
});
