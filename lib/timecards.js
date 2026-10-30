// Timecards: team list, private staff links, weekly cards. Stored as JSON in the private Blob store.
const crypto = require('node:crypto');

function fail(status, message) { return Object.assign(new Error(message), { status }); }
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw fail(503, 'Timecards are not configured. Contact CUEPA.');
  return s;
}
function linkKey() { return crypto.hkdfSync('sha256', secret(), 'cuepa-timecards-v1', 'staff-links', 32); }

// ---- storage (swappable in tests) ----
const store = {
  async get(path) {
    const { get } = await import('@vercel/blob');
    const r = await get(path, { access: 'private', useCache: false });
    if (!r) return null;
    if (r.statusCode !== 200 || !r.stream) throw fail(503, 'Timecard storage is unavailable. Try again.');
    return JSON.parse(await new Response(r.stream).text());
  },
  async put(path, value) {
    const { put } = await import('@vercel/blob');
    await put(path, JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  }
};
const teamPath = ws => `timecards/${ws}/team.json`;
const cardPath = (ws, week, id) => `timecards/${ws}/weeks/${week}/${id}.json`;

async function readTeam(ws) { return (await store.get(teamPath(ws))) || { members: [] }; }
async function writeTeam(ws, team) { await store.put(teamPath(ws), team); }
async function readCard(ws, week, id) { return store.get(cardPath(ws, week, id)); }
async function writeCard(ws, week, id, card) { await store.put(cardPath(ws, week, id), card); }

// ---- staff links: signed, no password, revocable by bumping the version ----
function sign(ws, id, v) { return crypto.createHmac('sha256', linkKey()).update(`${ws}|${id}|${v}`).digest('base64url').slice(0, 32); }
function makeToken(ws, m) { return `${ws}.${m.id}.${m.v}.${sign(ws, m.id, m.v)}`; }
function parseToken(t) {
  const m = /^([a-z0-9-]{1,60})\.([a-f0-9]{12})\.(\d{1,6})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ''));
  if (!m) return null;
  const [, ws, id, v, mac] = m;
  const good = sign(ws, id, Number(v));
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  return { ws, id, v: Number(v) };
}

// ---- weeks (Monday start, plain dates) ----
function isMonday(week) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week || ''))) return false;
  const d = new Date(week + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === week && d.getUTCDay() === 1;
}
function weekDays(week) {
  const out = []; const d = new Date(week + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) { out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10)); }
  return out;
}
function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

// ---- cleaning input ----
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
function cleanMember(b) {
  const name = clip(b.name, 80); if (!name) throw fail(400, 'Add a name.');
  const email = clip(b.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'That email doesn’t look right.');
  const phone = clip(b.phone, 30);
  if (phone && !/^[0-9+().\s-]{7,30}$/.test(phone)) throw fail(400, 'That phone number doesn’t look right.');
  return { name, role: clip(b.role, 60), email, phone };
}
function cleanDays(week, days) {
  const allowed = new Set(weekDays(week)); const out = {};
  if (!days || typeof days !== 'object' || Array.isArray(days)) throw fail(400, 'Add your hours.');
  for (const [date, v] of Object.entries(days)) {
    if (!allowed.has(date)) throw fail(400, 'A day is outside this week.');
    const hours = Number(v && v.hours);
    if (v == null || v.hours === '' || v.hours == null) continue;
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw fail(400, 'Hours must be between 0 and 24.');
    if (Math.round(hours * 4) !== hours * 4) throw fail(400, 'Use quarter hours, like 4.25 or 4.5.');
    if (hours === 0) continue;
    out[date] = { hours, work: clip(v.work, 60) };
  }
  return out;
}
const total = days => Object.values(days || {}).reduce((a, d) => a + d.hours, 0);
function flags(card) {
  const out = [];
  for (const [date, d] of Object.entries(card.days || {})) if (d.hours > 12) out.push(`${d.hours} hours on ${new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`);
  if (total(card.days) > 40) out.push(`${total(card.days)} hours this week`);
  return out;
}

// Spreadsheet for payroll: approved hours only, one row per person per day.
function csv(rows) {
  const esc = v => { const s = String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  return rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

module.exports = { fail, store, readTeam, writeTeam, readCard, writeCard, makeToken, parseToken, isMonday, weekDays, mondayOf, cleanMember, cleanDays, total, flags, csv };
