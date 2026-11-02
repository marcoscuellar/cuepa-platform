const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const ui = require('../lib/workspace-ui');
const page = '<html><body><p>hi</p></body></html>';

test('no popup when the policy is already accepted', () => {
  assert.equal(ui.policyNotice(page, false, '2026-11-02'), page);
});
test('popup shows when pending, links both documents, needs a tick, and its script is valid', () => {
  const out = ui.policyNotice(page, true, '2026-11-02');
  assert.match(out, /id="cuepa-policy"/);
  assert.match(out, /href="\/privacy"/); assert.match(out, /href="\/terms"/);
  assert.match(out, /id="cp-go" disabled/);
  assert.match(out, /version:"2026-11-02"/);
  for (const m of out.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
  assert.ok(out.indexOf('cuepa-policy') < out.indexOf('</body>'));
});
