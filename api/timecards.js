// Timecards API.
// Owner side (signed-in CUEPA user with access to the workspace): team list, week view, approvals, payroll spreadsheet.
// Staff side (private link, no password): load and send their own card for the current or last week.
const crypto = require('node:crypto');
const { readSession, canSee } = require('./_session');
const WORKSPACES = require('../lib/workspaces');
const tc = require('../lib/timecards');
const { fail } = tc;

function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { if (req.body.length > 20000) throw fail(413, 'Request is too large.'); try { return JSON.parse(req.body); } catch { throw fail(400, 'Invalid request.'); } }
  let text = ''; for await (const c of req) { text += c; if (text.length > 20000) throw fail(413, 'Request is too large.'); }
  try { return JSON.parse(text || '{}'); } catch { throw fail(400, 'Invalid request.'); }
}
function sameOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return !!host && req.headers.origin === 'https://' + host;
}
function linkFor(req, ws, m) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'app.makingcuepa.com';
  return `https://${host}/t/${tc.makeToken(ws, m)}`;
}
function publicMember(req, ws, m) { return { id: m.id, name: m.name, role: m.role, email: m.email, phone: m.phone, link: linkFor(req, ws, m) }; }
function summary(card) {
  if (!card) return { status: 'notin', hours: 0, days: {}, flags: [] };
  return { status: card.status, hours: tc.total(card.days), days: card.days, note: card.note || '', fixNote: card.fixNote || '', submittedAt: card.submittedAt, reviewedAt: card.reviewedAt || null, flags: tc.flags(card) };
}
// Staff may only send this week or last week (Chicago-agnostic: allow a day of slack either side).
function staffWeekOk(week) {
  const now = Date.now(); const cur = tc.mondayOf(new Date(now + 86400000)); const prev = tc.mondayOf(new Date(now - 8 * 86400000));
  const curAlt = tc.mondayOf(new Date(now - 86400000));
  return [cur, curAlt, prev, tc.mondayOf(new Date(now - 6 * 86400000))].includes(week);
}

const OWNER = { week: 'GET', export: 'GET', 'team-add': 'POST', 'team-update': 'POST', 'team-remove': 'POST', 'team-relink': 'POST', review: 'POST' };
const STAFF = { card: 'GET', submit: 'POST' };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, 'https://local.invalid');
  const action = url.searchParams.get('action');
  try {
    if (STAFF[action]) {
      if (req.method !== STAFF[action]) { res.setHeader('Allow', STAFF[action]); throw fail(405, 'Method not allowed.'); }
      const data = req.method === 'POST' ? await body(req) : {};
      if (req.method === 'POST' && !sameOrigin(req)) throw fail(403, 'Please use your timecard link.');
      const tok = tc.parseToken(req.method === 'POST' ? data.t : url.searchParams.get('t'));
      const NOPE = fail(404, 'This timecard link isn’t active anymore. Ask for a new one.');
      if (!tok || !WORKSPACES[tok.ws]) throw NOPE;
      const team = await tc.readTeam(tok.ws);
      const m = team.members.find(x => x.id === tok.id);
      if (!m || m.v !== tok.v) throw NOPE;
      const week = req.method === 'POST' ? data.week : url.searchParams.get('week');
      if (!tc.isMonday(week) || !staffWeekOk(week)) throw fail(400, 'Choose this week or last week.');
      const card = await tc.readCard(tok.ws, week, m.id);
      if (action === 'card') return json(res, 200, { name: m.name, business: WORKSPACES[tok.ws].name, week, days: tc.weekDays(week), card: summary(card) });
      if (card && card.status === 'approved') throw fail(409, 'These hours are already approved. Ask your manager if something needs to change.');
      const days = tc.cleanDays(week, data.days);
      const next = { days, note: String(data.note || '').slice(0, 300), status: 'sent', submittedAt: new Date().toISOString() };
      await tc.writeCard(tok.ws, week, m.id, next);
      return json(res, 200, { ok: true, card: summary(next) });
    }

    if (!OWNER[action]) throw fail(404, 'Not found.');
    if (req.method !== OWNER[action]) { res.setHeader('Allow', OWNER[action]); throw fail(405, 'Method not allowed.'); }
    const s = readSession(req);
    if (!s || s.temp) throw fail(401, 'Please sign in again.');
    if (req.method === 'POST' && !sameOrigin(req)) throw fail(403, 'Please use your CUEPA hub to make changes.');
    const data = req.method === 'POST' ? await body(req) : {};
    const ws = req.method === 'POST' ? data.ws : url.searchParams.get('ws');
    if (!WORKSPACES[ws] || !canSee(s, ws)) throw fail(403, 'You cannot access this workspace.');
    const team = await tc.readTeam(ws);
    const find = id => { const m = team.members.find(x => x.id === id); if (!m) throw fail(404, 'That person isn’t on your team list.'); return m; };

    if (action === 'team-add') {
      if (team.members.length >= 100) throw fail(400, 'Team list is full.');
      const m = { id: crypto.randomBytes(6).toString('hex'), v: 1, ...tc.cleanMember(data), addedAt: new Date().toISOString() };
      team.members.push(m); await tc.writeTeam(ws, team);
      return json(res, 200, { member: publicMember(req, ws, m) });
    }
    if (action === 'team-update') {
      const m = find(data.id); Object.assign(m, tc.cleanMember(data)); await tc.writeTeam(ws, team);
      return json(res, 200, { member: publicMember(req, ws, m) });
    }
    if (action === 'team-remove') {
      find(data.id); team.members = team.members.filter(x => x.id !== data.id); await tc.writeTeam(ws, team);
      return json(res, 200, { ok: true });
    }
    if (action === 'team-relink') {
      const m = find(data.id); m.v += 1; await tc.writeTeam(ws, team);
      return json(res, 200, { member: publicMember(req, ws, m) });
    }

    const week = req.method === 'POST' ? data.week : url.searchParams.get('week');
    if (!tc.isMonday(week)) throw fail(400, 'Choose a week.');
    if (action === 'review') {
      const m = find(data.id); const card = await tc.readCard(ws, week, m.id);
      if (!card) throw fail(409, `${m.name} hasn’t sent hours for this week yet.`);
      if (data.decision === 'approve') { if (card.status !== 'sent') throw fail(409, 'Only sent hours can be approved.'); Object.assign(card, { status: 'approved', fixNote: '', reviewedAt: new Date().toISOString(), reviewedBy: s.name }); }
      else if (data.decision === 'fix') { if (card.status !== 'sent') throw fail(409, 'Only sent hours can be sent back.'); Object.assign(card, { status: 'fix', fixNote: String(data.note || '').slice(0, 300), reviewedAt: new Date().toISOString(), reviewedBy: s.name }); }
      else if (data.decision === 'undo') { if (card.status !== 'approved' && card.status !== 'fix') throw fail(409, 'Nothing to undo.'); Object.assign(card, { status: 'sent', fixNote: '', reviewedAt: null, reviewedBy: null }); }
      else throw fail(400, 'Choose approve, fix or undo.');
      await tc.writeCard(ws, week, m.id, card);
      return json(res, 200, { id: m.id, card: summary(card) });
    }

    const cards = {};
    await Promise.all(team.members.map(async m => { cards[m.id] = summary(await tc.readCard(ws, week, m.id)); }));
    if (action === 'week') return json(res, 200, { week, days: tc.weekDays(week), team: team.members.map(m => publicMember(req, ws, m)), cards });

    // export: approved hours only
    const rows = [['Employee', 'Date', 'Hours', 'Worked on', 'Approved by']];
    for (const m of team.members) {
      const c = await tc.readCard(ws, week, m.id);
      if (!c || c.status !== 'approved') continue;
      for (const d of tc.weekDays(week)) if (c.days[d]) rows.push([m.name, d, c.days[d].hours, c.days[d].work || '', c.reviewedBy || '']);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="timecards-${ws}-${week}.csv"`);
    return res.end(tc.csv(rows));
  } catch (e) {
    console.error('Timecards request failed', { action, status: e.status || 500, message: e.status ? undefined : e.message });
    return json(res, e.status || 500, { error: e.status ? e.message : 'Timecards are unavailable right now. Please try again.' });
  }
};
