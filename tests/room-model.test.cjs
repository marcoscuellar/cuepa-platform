const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../assets/room-model.js');
const ready = () => ({cal:{connected:true,selected:1},mail:{connected:true},tc:{team:[]},needs:[],inbox:[]});
test('connected Gmail with failed list is unknown, never zero workload', () => {
 const s=ready(); s.mail.error='request failed';
 assert.equal(model.mailReady(s),false);
 assert.equal(model.sourcesReady(s),false);
 assert.match(model.healthText(s),/Gmail unavailable/);
 assert.match(model.assistantReply('inbox',s,[],'day'),/unknown/);
});
test('unselected or failed calendar cannot be summarized as a free day', () => {
 for (const cal of [{connected:true,selected:0},{connected:true,selected:1,error:'down'},null]) {
  const s=ready();s.cal=cal;
  assert.equal(model.calendarReady(s),false);
  assert.match(model.assistantReply('calendar',s,[],'day'),/cannot tell whether your day is free/);
 }
});
test('timecard errors remain visible even when other sources succeed', () => {
 const s=ready();s.tc={error:'unavailable'};
 assert.match(model.healthText(s),/Timecards unavailable/);
});
test('assistant distinguishes unread from reply obligations', () => {
 const s=ready();s.inbox=[{unread:true},{unread:false},{unread:true}];
 assert.match(model.assistantReply('mail',s,[],'day'),/^2 unread.*Unread does not necessarily mean a reply/);
});
test('Ideas mode does not use workspace mail, calendar, or needs', () => {
 const s=ready();s.needs=[{t:'PRIVATE NEED'}];s.inbox=[{subject:'PRIVATE MAIL'}];
 const reply=model.assistantReply('Improve attendance',s,[{title:'PRIVATE EVENT'}],'ideas');
 assert.match(reply,/Improve attendance/); assert.doesNotMatch(reply,/PRIVATE/);
 assert.match(reply,/worksheet, not an AI recommendation/);
});
