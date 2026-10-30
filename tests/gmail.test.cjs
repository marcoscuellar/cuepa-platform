const test = require('node:test');
const assert = require('node:assert');
process.env.GOOGLE_CLIENT_ID = 'id'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
process.env.GOOGLE_REDIRECT_URI = 'https://app.makingcuepa.com/api/google/callback';
process.env.AUTH_SECRET = 'x'.repeat(40);
const g = require('../lib/gmail');

test('redirect uri uses the app origin', () => {
  assert.equal(g.config().redirectUri, 'https://app.makingcuepa.com/api/gmail/callback');
  const u = new URL(g.authUrl('st'));
  assert.match(u.searchParams.get('scope'), /gmail\.readonly.*gmail\.send/);
  assert.equal(u.searchParams.get('access_type'), 'offline');
});
test('seal round-trips and is bound to its context', () => {
  const s = g.seal({ a: 1 }, 'gmail:x');
  assert.deepEqual(g.unseal(s, 'gmail:x'), { a: 1 });
  assert.throws(() => g.unseal(s, 'gmail:y'));
});
test('buildRaw makes a valid reply and blocks header injection', () => {
  const raw = Buffer.from(g.buildRaw({ to: 'Ana <ana@x.com>, bo@y.org', subject: 'Re: hola\r\nBcc: evil@z.com', body: 'Hi ñ\nthere', inReplyTo: '<m1@x>', references: '<m0@x>' }), 'base64url').toString();
  assert.match(raw, /^To: ana@x\.com, bo@y\.org\r\n/);
  assert.ok(!/\r\nBcc:/.test(raw));
  assert.match(raw, /In-Reply-To: <m1@x>/);
  assert.match(raw, /References: <m0@x> <m1@x>/);
  const body = raw.split('\r\n\r\n')[1];
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString(), 'Hi ñ\r\nthere');
  assert.match(Buffer.from(g.buildRaw({ to: 'a@b.co', subject: 'Año', body: 'x' }), 'base64url').toString(), /Subject: =\?UTF-8\?B\?/);
});
test('bad recipients and empty bodies are refused', () => {
  assert.throws(() => g.buildRaw({ to: 'nope', body: 'x' }), /doesn't look like/);
  assert.throws(() => g.buildRaw({ to: 'a@b.co', body: '  ' }), /Write a message/);
});
test('body text prefers plain, falls back to html', () => {
  const enc = s => Buffer.from(s).toString('base64url');
  assert.equal(g.bodyText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: enc('<p>H</p>') } }, { mimeType: 'text/plain', body: { data: enc('Plain') } }] }), 'Plain');
  assert.equal(g.bodyText({ mimeType: 'text/html', body: { data: enc('<style>x</style><p>Hi &amp; bye</p><br>ok') } }), 'Hi & bye\n\nok');
});
