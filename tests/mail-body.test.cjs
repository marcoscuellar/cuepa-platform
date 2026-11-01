const test=require('node:test');const assert=require('node:assert');
const mailBody=require('../assets/mail-body.js');
test('email links become short, safe, clickable labels',()=>{
  const h=mailBody('remove\n<https://accounts.google.com/x?a=1&b\n=2>\nit.\n[image: Google]\nSee https://example.com/a. <b>hi</b> javascript:alert(1)');
  assert.match(h,/remove <a class="ib-link" href="https:\/\/accounts.google.com\/x\?a=1&amp;b=2"[^>]*>accounts.google.com ↗<\/a> it\./);
  assert.match(h,/>example.com ↗<\/a>\./);
  assert.doesNotMatch(h,/\[image/);
  assert.doesNotMatch(h,/<b>/);
  assert.doesNotMatch(h,/href="javascript/);
});
