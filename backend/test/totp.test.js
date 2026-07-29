const { test } = require('node:test');
const assert = require('node:assert');
const { base32Decode, base32Encode, totp, verify, generateSecret } = require('../src/auth/totp');

// RFC 6238 test secret "12345678901234567890" (ASCII) in base32.
const SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('base32 decode matches the RFC ASCII secret', () => {
  assert.equal(base32Decode(SECRET_B32).toString('ascii'), '12345678901234567890');
});

test('base32 round-trips', () => {
  const buf = Buffer.from('hello world');
  assert.equal(base32Decode(base32Encode(buf)).toString(), 'hello world');
});

test('TOTP matches RFC 6238 vectors (6-digit)', () => {
  // RFC 6238 8-digit vectors truncated to 6 digits.
  assert.equal(totp(SECRET_B32, 59), '287082');
  assert.equal(totp(SECRET_B32, 1111111109), '081804');
  assert.equal(totp(SECRET_B32, 1234567890), '005924');
});

test('verify accepts current code and rejects wrong code', () => {
  const now = 1111111109;
  assert.equal(verify(SECRET_B32, '081804', { timeSec: now }), true);
  assert.equal(verify(SECRET_B32, '000000', { timeSec: now }), false);
});

test('verify tolerates one step of drift', () => {
  const now = 1111111109;
  const prev = totp(SECRET_B32, now - 30);
  assert.equal(verify(SECRET_B32, prev, { timeSec: now, window: 1 }), true);
});

test('generateSecret returns a valid base32 string', () => {
  const s = generateSecret();
  assert.match(s, /^[A-Z2-7]+$/);
  assert.ok(s.length >= 16);
});
