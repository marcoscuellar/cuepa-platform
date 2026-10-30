// Gmail for the hub: connect (Google OAuth), read inbox, send/reply as the owner.
// The Google refresh token is encrypted (AES-256-GCM, key derived from AUTH_SECRET)
// and kept in the private Blob store at gmail/<workspace>/<sha256(login email)>.json, one per PERSON per workspace
// (never shared across logins). Never sent to the browser.
const crypto = require('node:crypto');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function fail(status, message) { return Object.assign(new Error(message), { status }); }

function config() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: base, AUTH_SECRET: secret } = process.env;
  if (!clientId || !clientSecret || !base || !secret || secret.length < 32) throw fail(503, 'Email connection is not configured. Contact CUEPA.');
  const origin = new URL(base).origin;
  return { clientId, clientSecret, secret, origin, redirectUri: origin + '/api/gmail/callback' };
}

function key() { return crypto.hkdfSync('sha256', config().secret, 'cuepa-gmail-v1', 'encrypted-connections', 32); }
function seal(value, context) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(key()), iv);
  c.setAAD(Buffer.from(context));
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(x => x.toString('base64url')).join('.');
}
function unseal(value, context) {
  const [iv, tag, data] = String(value || '').split('.').map(x => Buffer.from(x || '', 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key()), iv);
  d.setAAD(Buffer.from(context)); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

// ---- storage (swappable in tests) ----
const store = {
  async get(path) {
    const { get } = await import('@vercel/blob');
    const r = await get(path, { access: 'private', useCache: false });
    if (!r) return null;
    if (r.statusCode !== 200 || !r.stream) throw fail(503, 'Email storage is unavailable. Try again.');
    return JSON.parse(await new Response(r.stream).text());
  },
  async put(path, value) {
    const { put } = await import('@vercel/blob');
    await put(path, JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  },
  async del(path) {
    const { del } = await import('@vercel/blob');
    try { await del(path); } catch (e) { /* already gone */ }
  }
};
const who = email => crypto.createHash('sha256').update(String(email || '').toLowerCase()).digest('hex');
const connPath = (ws, email) => `gmail/${ws}/${who(email)}.json`;
const ctx = (ws, email) => 'gmail:' + ws + ':' + who(email);
const legacyPath = ws => `gmail/${ws}.json`; // pre-Oct 30: one connection per workspace (wrong: it showed one person's inbox to everyone)

async function readConnection(ws, email) {
  const row = await store.get(connPath(ws, email));
  if (!row || !row.sealed) return null;
  try { return unseal(row.sealed, ctx(ws, email)); } catch (e) { return null; }
}
async function saveConnection(ws, email, conn) { await store.put(connPath(ws, email), { sealed: seal(conn, ctx(ws, email)), email: conn.email, connectedAt: conn.connectedAt }); }
async function revoke(refreshToken) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(refreshToken), { method: 'POST' }); } catch (e) {} }
async function removeConnection(ws, email) {
  const conn = await readConnection(ws, email);
  if (conn && conn.refreshToken) await revoke(conn.refreshToken);
  await store.del(connPath(ws, email));
}

// ---- OAuth ----
function authUrl(state, loginHint) {
  const c = config();
  const p = new URLSearchParams({
    client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state
  });
  if (loginHint) p.set('login_hint', loginHint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}
async function tokenRequest(params) {
  const c = config();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw fail(401, 'Google access expired. Connect your email again.');
    throw fail(502, 'Google did not accept the request. Try again.');
  }
  return j;
}
async function exchangeCode(code) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: config().redirectUri });
  const granted = String(t.scope || '').split(' ');
  const missing = SCOPES.filter(s => !granted.includes(s));
  if (missing.length) throw fail(400, 'Please allow both "read" and "send" on the Google screen, then try again.');
  if (!t.refresh_token) throw fail(400, 'Google did not give long-term access. Try connecting again.');
  return t;
}
// One-time cleanup of the old shared-per-workspace connection: revoke it at Google and delete it.
async function removeLegacyConnection(ws) {
  const row = await store.get(legacyPath(ws));
  if (!row) return false;
  if (row.sealed) { try { const c = unseal(row.sealed, 'gmail:' + ws); if (c && c.refreshToken) await revoke(c.refreshToken); } catch (e) {} }
  await store.del(legacyPath(ws));
  return true;
}
async function accessToken(ws, email) {
  const conn = await readConnection(ws, email);
  if (!conn) throw fail(409, 'Email is not connected yet.');
  const t = await tokenRequest({ refresh_token: conn.refreshToken, grant_type: 'refresh_token' });
  return t.access_token;
}

// ---- Gmail API ----
async function gapi(token, path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw fail(401, 'Google access expired. Connect your email again.');
  if (r.status === 403) throw fail(403, 'Google blocked this request. Your Google admin may need to trust CUEPA.');
  if (!r.ok) throw fail(502, 'Gmail did not respond. Try again.');
  return j;
}
async function profile(token) { return gapi(token, '/profile'); }

function header(headers, name) {
  const h = (headers || []).find(x => String(x.name).toLowerCase() === name.toLowerCase());
  return h ? String(h.value) : '';
}
function summarize(m) {
  const h = (m.payload && m.payload.headers) || [];
  return {
    id: m.id, threadId: m.threadId, snippet: decodeEntities(m.snippet || ''),
    from: header(h, 'From'), to: header(h, 'To'), subject: header(h, 'Subject'), date: header(h, 'Date'),
    unread: (m.labelIds || []).includes('UNREAD')
  };
}
async function listInbox(token, q) {
  const params = new URLSearchParams({ maxResults: '25', q: q ? String(q).slice(0, 200) : 'in:inbox' });
  const list = await gapi(token, '/messages?' + params);
  const ids = (list.messages || []).map(m => m.id);
  const meta = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date';
  const msgs = await Promise.all(ids.map(id => gapi(token, `/messages/${encodeURIComponent(id)}?${meta}`)));
  return msgs.map(summarize);
}

function b64urlDecode(s) { return Buffer.from(String(s || ''), 'base64url').toString('utf8'); }
function findPart(p, type) {
  if (!p) return null;
  if (p.mimeType === type && p.body && p.body.data) return p;
  for (const c of p.parts || []) { const f = findPart(c, type); if (f) return f; }
  return null;
}
function decodeEntities(s) {
  return String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();
}
function bodyText(payload) {
  const plain = findPart(payload, 'text/plain');
  if (plain) return b64urlDecode(plain.body.data).trim();
  const html = findPart(payload, 'text/html');
  if (html) return htmlToText(b64urlDecode(html.body.data));
  return '';
}
async function readMessage(token, id) {
  if (!/^[A-Za-z0-9]{6,64}$/.test(String(id))) throw fail(400, 'Unknown message.');
  const m = await gapi(token, `/messages/${id}?format=full`);
  const h = (m.payload && m.payload.headers) || [];
  return { ...summarize(m), messageId: header(h, 'Message-ID') || header(h, 'Message-Id'), references: header(h, 'References'), body: bodyText(m.payload).slice(0, 100000) };
}

// ---- sending ----
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
function cleanHeader(v, max = 998) { return String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max); }
function encodeWord(s) { return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?='; }
function parseRecipients(to) {
  const list = String(to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
    .map(s => { const m = s.match(/<([^>]+)>/); return (m ? m[1] : s).trim(); });
  if (!list.length) throw fail(400, 'Add who the email goes to.');
  if (list.length > 20) throw fail(400, 'Send to 20 people or fewer.');
  for (const a of list) if (!EMAIL.test(a)) throw fail(400, `"${a}" doesn't look like an email address.`);
  return list;
}
function buildRaw({ to, subject, body, inReplyTo, references }) {
  const rcpt = parseRecipients(to);
  const text = String(body || '');
  if (!text.trim()) throw fail(400, 'Write a message first.');
  if (text.length > 20000) throw fail(400, 'That message is too long.');
  const lines = [
    'To: ' + rcpt.join(', '),
    'Subject: ' + encodeWord(cleanHeader(subject, 300)),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64'
  ];
  if (inReplyTo) lines.push('In-Reply-To: ' + cleanHeader(inReplyTo));
  if (references || inReplyTo) lines.push('References: ' + cleanHeader([references, inReplyTo].filter(Boolean).join(' ')));
  const b64 = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(lines.join('\r\n') + '\r\n\r\n' + b64, 'utf8').toString('base64url');
}
async function sendMessage(token, msg) {
  const raw = buildRaw(msg);
  const payload = { raw };
  if (msg.threadId && /^[A-Za-z0-9]{6,64}$/.test(String(msg.threadId))) payload.threadId = msg.threadId;
  const r = await gapi(token, '/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { id: r.id, threadId: r.threadId };
}

module.exports = {
  SCOPES, fail, config, seal, unseal, store, authUrl, exchangeCode, accessToken, profile,
  readConnection, saveConnection, removeConnection, listInbox, readMessage, sendMessage,
  buildRaw, bodyText, htmlToText, parseRecipients, summarize, removeLegacyConnection };
