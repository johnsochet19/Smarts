// RFC 6238 TOTP / RFC 4226 HOTP — dependency-free (Node crypto only).
// Used for optional two-factor authentication.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(keyBuf, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  const hmac = crypto.createHmac('sha1', keyBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

function totp(secretB32, timeSec = Math.floor(Date.now() / 1000), step = 30, digits = 6) {
  return hotp(base32Decode(secretB32), Math.floor(timeSec / step), digits);
}

// Verify with a ±window tolerance for clock drift.
function verify(secretB32, token, { timeSec = Math.floor(Date.now() / 1000), step = 30, digits = 6, window = 1 } = {}) {
  if (!token || !secretB32) return false;
  const t = String(token).trim();
  for (let w = -window; w <= window; w++) {
    if (totp(secretB32, timeSec + w * step, step, digits) === t) return true;
  }
  return false;
}

function otpauthURL(secretB32, label, issuer = 'BuildForge') {
  const l = encodeURIComponent(label);
  const i = encodeURIComponent(issuer);
  return `otpauth://totp/${i}:${l}?secret=${secretB32}&issuer=${i}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totp, verify, otpauthURL };
