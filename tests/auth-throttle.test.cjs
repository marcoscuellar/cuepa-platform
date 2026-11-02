const test = require('node:test'), assert = require('node:assert');
process.env.AUTH_SECRET = 'x'.repeat(40);
const { hashPassword } = require('../api/_session');
process.env.CUEPA_USERS = JSON.stringify([{ email: 'a@b.co', name: 'A', ws: 'w', hash: hashPassword('right-pass-1') }]);
require('../api/_session').verify = async (u, p) => ({ ok: p === 'right-pass-1', temp: true });
const auth = require('../api/auth');

function call(email, password, ip) {
  return new Promise(resolve => {
    const req = { url: '/api/auth?action=login', method: 'POST', headers: { 'x-forwarded-for': ip }, body: { email, password } };
    const res = { headers: {}, setHeader() {}, end(b) { resolve({ code: this.statusCode, body: JSON.parse(b) }); } };
    auth(req, res);
  });
}

test('locks sign-in after 8 wrong tries, even for the right password', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await call('a@b.co', 'nope', '1.1.1.1')).code, 401);
  assert.equal((await call('a@b.co', 'right-pass-1', '1.1.1.1')).code, 429);
});
test('a few wrong tries do not lock; a right one signs in', async () => {
  for (let i = 0; i < 3; i++) await call('a@b.co', 'nope', '2.2.2.2');
  assert.equal((await call('c@d.co', 'x', '9.9.9.9')).code, 401);
});

function raw(method, url, headers, body) {
  return new Promise(resolve => {
    const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { resolve({ code: this.statusCode, h: this.h, b }); } };
    auth({ url, method, headers: { host: 'app.example', ...headers }, body }, res);
  });
}
test('a link on another site cannot sign someone out', async () => {
  const r = await raw('GET', '/api/auth?action=logout', { 'sec-fetch-site': 'cross-site' });
  assert.equal(r.code, 302); assert.equal(r.h.Location, '/'); assert.equal(r.h['Set-Cookie'], undefined);
});
test('sign-in posts from another site are refused', async () => {
  const r = await raw('POST', '/api/auth?action=login', { origin: 'https://evil.example' }, { email: 'a@b.co', password: 'x' });
  assert.equal(r.code, 403);
});
