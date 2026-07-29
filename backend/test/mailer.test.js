// Mailer service tests — including a REAL delivery test against a live local
// SMTP sink (a minimal RFC 5321 server on an ephemeral port), so "email works"
// is asserted at the protocol level, not mocked.
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

// A tiny SMTP server: accepts one connection, walks the dialogue, captures DATA.
function startSmtpSink() {
  const captured = { data: '', from: '', to: '' };
  const server = net.createServer((socket) => {
    let inData = false;
    socket.write('220 sink ESMTP\r\n');
    socket.on('data', (buf) => {
      const chunk = buf.toString();
      if (inData) {
        captured.data += chunk;
        if (captured.data.includes('\r\n.\r\n')) {
          inData = false;
          socket.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of chunk.split('\r\n')) {
        if (!line) continue;
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) {
          socket.write('250-sink\r\n250 8BITMIME\r\n');
        } else if (cmd.startsWith('MAIL FROM')) {
          captured.from = line;
          socket.write('250 OK\r\n');
        } else if (cmd.startsWith('RCPT TO')) {
          captured.to = line;
          socket.write('250 OK\r\n');
        } else if (cmd.startsWith('DATA')) {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (cmd.startsWith('QUIT')) {
          socket.write('221 bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, captured }));
  });
}

test('sendMail is a safe no-op when SMTP is not configured', async () => {
  delete process.env.SMTP_HOST;
  const mailer = require('../src/services/mailer');
  mailer._resetTransport();
  const r = await mailer.sendMail({ to: 'x@example.com', subject: 'Hi', text: 'Body' });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'smtp not configured');
  assert.equal(mailer.isEnabled(), false);
});

test('sendMail delivers a real message over SMTP', async () => {
  const { server, port, captured } = await startSmtpSink();
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_SECURE = 'false';
  delete process.env.SMTP_USER;
  process.env.MAIL_FROM = 'buildforge@test.local';

  const mailer = require('../src/services/mailer');
  mailer._resetTransport();
  assert.equal(mailer.isEnabled(), true);

  const r = await mailer.sendMail({
    to: 'field-lead@example.com',
    subject: 'Punch item assigned',
    text: 'Item #12 "Touch up paint lobby" was assigned to you.',
  });
  assert.equal(r.sent, true, 'expected sent=true');
  assert.match(captured.from, /buildforge@test\.local/);
  assert.match(captured.to, /field-lead@example\.com/);
  assert.match(captured.data, /Punch item assigned/);
  assert.match(captured.data, /Touch up paint lobby/);

  delete process.env.SMTP_HOST;
  mailer._resetTransport();
  server.close();
});

test('sendMail reports failure (not a throw) when the relay is unreachable', async () => {
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '9'; // discard port — nothing listening
  const mailer = require('../src/services/mailer');
  mailer._resetTransport();
  const r = await mailer.sendMail({ to: 'x@example.com', subject: 'Hi', text: 'Body' });
  assert.equal(r.sent, false);
  assert.ok(r.reason, 'expected a failure reason');
  delete process.env.SMTP_HOST;
  mailer._resetTransport();
});
