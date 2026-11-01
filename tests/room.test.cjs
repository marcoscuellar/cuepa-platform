const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

function load(session) {
  const sess = require.resolve('../api/_session.js');
  require.cache[sess] = { id: sess, filename: sess, loaded: true, exports: { readSession: () => session, canSee: (s, ws) => !!s && s.ws === ws } };
  delete require.cache[require.resolve('../api/room.js')];
  return require('../api/room.js');
}
function call(handler, url) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
  handler({ url }, res); return res;
}

test('signed out goes to sign-in', () => {
  const r = call(load(null), '/api/room?ws=cirques-experience');
  assert.equal(r.statusCode, 302); assert.equal(r.headers.location, '/?next=/cirques-experience');
});
test('unknown workspace is not found', () => {
  assert.equal(call(load({ ws: 'nope', name: 'A' }), '/api/room?ws=nope').statusCode, 404);
});
test('signed in gets The Room, escaped, with no sample data', () => {
  const r = call(load({ ws: 'cirques-experience', name: '<b>Chris</b>' }), '/api/room?ws=cirques-experience&room=1');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /The Room · Cirques Experience/);
  assert.match(r.body, /aria-current="page">.*The Room/);
  assert.ok(!r.body.includes('<b>Chris</b>'));
  assert.ok(!/\[#\]|\[HRS\]|Test Sender/.test(r.body));
  assert.equal(r.headers['x-frame-options'], 'DENY');
});
test('Google connect return goes to onboarding', () => {
  const r = call(load(null), '/api/room?ws=cirques-experience&google=ok');
  assert.equal(r.statusCode, 302); assert.equal(r.headers.location, '/cirques-experience/start?google=ok');
});
test('home route points to The Room, Today keeps its own page', () => {
  const v = require(path.join(__dirname, '..', 'vercel.json'));
  const home = v.rewrites.find(r => r.source.startsWith('/:ws((?!'));
  assert.equal(home.destination, '/api/room?ws=:ws');
  assert.ok(v.rewrites.some(r => r.source === '/:ws([a-z0-9-]+)/today' && r.destination === '/api/today?ws=:ws'));
});
