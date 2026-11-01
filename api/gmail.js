const workspaceUI = require('../lib/workspace-ui');
// /api/gmail — connect Gmail, inbox page, read, send/reply, disconnect.
// Only someone signed in to the workspace can use it (same rule as the hub).
const crypto = require('node:crypto');
const { readSession, canSee } = require('./_session');
const WORKSPACES = require('../lib/workspaces');
const g = require('../lib/gmail');

const FLOW = 'cuepa_gmail_flow';
function flowCookie(v, age = 600) { return `${FLOW}=${v}; Path=/api/gmail; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
function go(res, to) { res.statusCode = 302; res.setHeader('Location', to); res.end(); }
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let t = typeof req.body === 'string' ? req.body : '';
  if (!t) for await (const c of req) { t += c; if (t.length > 60000) throw g.fail(413, 'Request is too large.'); }
  try { return JSON.parse(t || '{}'); } catch { throw g.fail(400, 'Invalid request.'); }
}
function session(req) { try { return readSession(req); } catch (e) { return null; } }
function allowed(s, ws) { return /^[a-z0-9-]{1,60}$/.test(ws) && WORKSPACES[ws] && s && !s.temp && canSee(s, ws); }
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return false;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, 'https://local.invalid');
  const action = url.pathname.endsWith('/callback') ? 'callback' : url.searchParams.get('action');
  const s = session(req);

  try {
    // ---- Google sends the person back here ----
    if (action === 'callback') {
      let flow = null;
      try { flow = g.unseal(readCookie(req, FLOW), 'gmail-flow'); } catch (e) {}
      res.setHeader('Set-Cookie', flowCookie('', 0));
      if (!flow || flow.exp < Date.now()) return go(res, '/');
      const ws = flow.ws;
      const back = (q) => go(res, `/${ws}/${flow.back === 'start' ? 'start' : 'inbox'}?${q}`);
      if (url.searchParams.get('error')) return back('connect=cancelled');
      const st = String(url.searchParams.get('state') || '');
      if (st.length !== flow.state.length || !crypto.timingSafeEqual(Buffer.from(st), Buffer.from(flow.state))) return back('connect=failed');
      if (!allowed(s, ws)) return go(res, `/?next=/${ws}`);
      try {
        const t = await g.exchangeCode(String(url.searchParams.get('code') || ''));
        const p = await g.profile(t.access_token);
        await g.saveConnection(ws, s.email, { refreshToken: t.refresh_token, email: p.emailAddress, connectedAt: new Date().toISOString() });
        return back('connect=ok');
      } catch (e) {
        console.error('gmail callback', e.status || 500, e.message);
        return back('connect=' + (e.status === 400 ? 'scopes' : 'failed'));
      }
    }

    const ws = url.searchParams.get('ws') || '';

    // ---- inbox page ----
    if (action === 'page') {
      if (!/^[a-z0-9-]{1,60}$/.test(ws) || !WORKSPACES[ws]) { res.statusCode = 404; return res.end('Not found'); }
      if (!allowed(s, ws)) return go(res, `/?next=/${ws}`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Frame-Options', 'DENY');
      return res.end(page(ws, WORKSPACES[ws].name));
    }

    if (!allowed(s, ws)) return json(res, 403, { ok: false, error: 'Sign in to use email.' });

    if (action === 'start') {
      const backTo = url.searchParams.get('back') === 'start' ? 'start' : 'inbox';
      // Not set up here (for example a preview build without the Google settings): send people back to a page, never raw JSON.
      try { g.config(); } catch (e) { return go(res, `/${ws}/${backTo}?connect=unavailable`); }
      const state = crypto.randomBytes(24).toString('base64url');
      const back = url.searchParams.get('back') === 'start' ? 'start' : 'inbox'; // where Google sends them afterwards
      res.setHeader('Set-Cookie', flowCookie(g.seal({ state, ws, back, exp: Date.now() + 600000 }, 'gmail-flow')));
      return go(res, g.authUrl(state));
    }
    if (action === 'status') {
      await g.removeLegacyConnection(ws); // retire the old shared connection the first time anyone looks
      const c = await g.readConnection(ws, s.email);
      return json(res, 200, { ok: true, connected: !!c, email: c ? c.email : null });
    }
    if (action === 'list') {
      const token = await g.accessToken(ws, s.email);
      return json(res, 200, { ok: true, messages: await g.listInbox(token, url.searchParams.get('q'), url.searchParams.get('label')) });
    }
    if (action === 'labels') {
      const token = await g.accessToken(ws, s.email);
      return json(res, 200, { ok: true, labels: await g.listLabels(token) });
    }
    if (action === 'read') {
      const token = await g.accessToken(ws, s.email);
      return json(res, 200, { ok: true, message: await g.readMessage(token, url.searchParams.get('id')) });
    }
    if (req.method === 'POST' && ['send', 'disconnect', 'move', 'trash', 'untrash', 'label-create', 'read-state'].includes(action)) {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'Blocked.' });
      if (action === 'disconnect') { await g.removeConnection(ws, s.email); return json(res, 200, { ok: true }); }
      const b = await body(req);
      const token = await g.accessToken(ws, s.email);
      if (action === 'move') { await g.moveMessage(token, b.id, b.label); return json(res, 200, { ok: true }); }
      if (action === 'trash') { await g.trashMessage(token, b.id); return json(res, 200, { ok: true }); }
      if (action === 'untrash') { await g.untrashMessage(token, b.id); return json(res, 200, { ok: true }); }
      if (action === 'label-create') { return json(res, 200, { ok: true, label: await g.createLabel(token, b.name) }); }
      if (action === 'read-state') { await g.modifyMessage(token, b.id, b.unread ? ['UNREAD'] : [], b.unread ? [] : ['UNREAD']); return json(res, 200, { ok: true }); }
      const sent = await g.sendMessage(token, b);
      return json(res, 200, { ok: true, sent });
    }
    return json(res, 404, { ok: false, error: 'Not found.' });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('gmail', action, e.message);
    else if (status === 401 || status === 403) console.warn('gmail access problem', { action, status }); // no tokens or addresses logged
    return json(res, status, { ok: false, error: status >= 500 && !e.status ? 'Something went wrong. Try again.' : e.message });
  }
};

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Inbox page. Look: CUEPA workspace system — white ground, black type, Teal Mark #0F766E as the only colour,
// shadows instead of outlines, one aligned grid. The email (and the person who wrote it) is the hero.
function page(ws, name) {
  const N = esc(name);
  return workspaceUI.apply(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>Inbox · ${N} · CUEPA</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
:root{--ink:#000;--grey:#595959;--fill:#F5F6F6;--teal:#0F766E;--tint:#EDF7F5;--sh:0 1px 2px rgba(0,0,0,.04),0 16px 48px rgba(0,0,0,.08);--sh-sm:0 1px 2px rgba(0,0,0,.08),0 2px 8px rgba(0,0,0,.06)}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:#fff;color:var(--ink);font:15px/1.5 Inter,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
.ib{max-width:1440px;margin:0 auto;padding:32px 40px 48px;display:grid;gap:20px}
/* buttons */
.ib button,.ib-dlg button,.ib-btn{font:600 14.5px/1 Inter,Arial,sans-serif;border:0;border-radius:12px;height:44px;padding:0 18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;white-space:nowrap;transition:background .15s,box-shadow .15s}
.ib-primary{background:var(--teal)!important;color:#fff!important;box-shadow:none}
.ib-primary:hover{background:#0c645d!important}
.ib-quiet{background:#F3F4F3;color:var(--ink);box-shadow:none}
.ib-quiet:hover{background:#E8EAE9}
.ib-text{background:transparent;color:var(--grey);padding:0 10px!important}
.ib-text:hover{background:var(--fill);color:var(--ink)}
.ib-select{font:600 14px Inter,Arial,sans-serif;height:44px;border:0;border-radius:12px;padding:0 34px 0 14px;background:#F3F4F3 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23000' stroke-width='1.6' fill='none'/%3E%3C/svg%3E") no-repeat right 13px center;-webkit-appearance:none;appearance:none;color:var(--ink);box-shadow:none!important;cursor:pointer}
/* toolbar */
.ib-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:24px}
.ib-title{display:flex;align-items:baseline;gap:14px;min-width:0}
.ib-title h1{margin:0;font-size:38px;font-weight:800;letter-spacing:-.035em;line-height:1.05}
.ib-title h1 .dot{color:var(--teal)}
.ib-eyebrow{display:block;font:600 11px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--teal);margin-bottom:8px}
.ib-count{color:var(--grey);font-size:15px;white-space:nowrap}
.ib-search{justify-self:end;display:flex;align-items:center;gap:10px;background:#fff;box-shadow:0 2px 9px rgba(0,0,0,.10);border-radius:12px;padding:0 14px;height:46px;width:min(380px,100%)}
.ib-search svg{width:16px;height:16px;stroke:var(--grey);fill:none;stroke-width:2;flex:none}
.ib-search input{flex:1;min-width:0;height:100%;border:0;background:transparent!important;box-shadow:none!important;font:15px Inter,Arial,sans-serif;color:var(--ink);outline:none;padding:0}
.ib-search kbd{font:500 12px Inter,Arial,sans-serif;color:var(--grey)}
/* folder tabs */
.ib-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-top:-4px;box-shadow:inset 0 -1px 0 #ECECEC}
.ib-tabs button{background:transparent;color:var(--grey);font-weight:500;padding:0 12px;border-radius:8px}
.ib-tabs button:hover{color:var(--ink);background:var(--fill)}
.ib-tabs button[aria-current="true"]{color:var(--ink);font-weight:600;box-shadow:inset 0 -2px 0 var(--teal);border-radius:0;background:transparent}
.ib-tabs .add{margin-left:auto}
/* banner + toast */
.ib-banner{padding:14px 18px;border-radius:14px;font-size:14px;font-weight:500;box-shadow:var(--sh-sm)}
.ib-banner.ok{background:var(--tint);color:#0b4f49;box-shadow:none}
.ib-banner.bad{background:#fff;color:var(--ink)}
.ib-banner a{color:var(--teal);font-weight:600;margin-left:6px}
.ib-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#000;color:#fff;border-radius:14px;padding:10px 10px 10px 18px;display:flex;gap:14px;align-items:center;z-index:90;box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:14px}
.ib-toast button{height:34px!important;background:#fff!important;color:#000!important;padding:0 14px!important}
/* panes */
.ib-panes{display:grid;grid-template-columns:minmax(340px,5fr) minmax(0,7fr);gap:24px;align-items:stretch;height:max(560px,calc(100dvh - 300px))}
.ib-pane{background:#fff;border-radius:20px;box-shadow:var(--sh);overflow:hidden;display:flex;flex-direction:column;min-height:0}
.ib-listhead{display:flex;justify-content:space-between;align-items:center;padding:12px 14px 12px 24px;color:var(--grey);font-size:13px}
.ib-list{overflow:auto;padding:0;flex:1;box-shadow:inset 0 1px 0 #EFEFEF}
.ib-row{display:grid;grid-template-columns:8px 36px minmax(0,1fr);gap:12px;align-items:start;padding:14px 24px 14px 4px;border-radius:0;cursor:pointer;position:relative}
.ib-row+.ib-row::before{content:"";position:absolute;top:0;left:72px;right:24px;height:1px;background:#EFEFEF}
.ib-row:hover{background:var(--fill)}
.ib-row:hover::before,.ib-row:hover+.ib-row::before,.ib-row.on::before,.ib-row.on+.ib-row::before{background:transparent}
.ib-row.on{background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.08),0 18px 48px rgba(0,0,0,.18);border-radius:14px;z-index:1}
.ib-row.on::before,.ib-row.on+.ib-row::before{background:transparent!important}
.ib-dot{width:8px;height:8px;border-radius:50%;margin-top:14px}
.ib-row.unread .ib-dot{background:var(--teal)}
.ib-av{width:36px;height:36px;border-radius:50%;background:#F0F0F0;color:#000;display:grid;place-items:center;font:600 14px Inter,Arial,sans-serif;flex:none}
.ib-r1{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.ib-name{font-weight:500;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ib-row.unread .ib-name{font-weight:700}
.ib-row time{color:var(--grey);font-size:12.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.ib-subj{font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.ib-row.unread .ib-subj{font-weight:600}
.ib-snip{color:var(--grey);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.ib-tag{display:none}
.fc-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;border-radius:8px;padding:3px 9px;white-space:nowrap;line-height:1.3}
.fc-chip i{width:7px;height:7px;border-radius:50%;flex:none}
.ib-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.ib-tabs button i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
.ib-actions .ib-expand{margin-left:auto}
body.focus .ib-panes{grid-template-columns:1fr}
body.focus .ib-panes>.ib-pane:first-child{display:none}
body.focus .ib-read{max-width:900px;margin:0 auto;padding:48px 56px 64px}
body.focus .ib-body{font-size:17px;line-height:1.75}
@media (max-width:900px){.ib-expand{display:none!important}}
.ib-none{color:var(--grey);text-align:center;padding:64px 24px;font-size:14.5px}
.ib-none .ib-btn{margin-top:16px}
/* reader — the hero */
.ib-reader{overflow:auto}
.ib-read{padding:36px 44px 44px;display:grid;gap:24px;max-width:860px}
.ib-back{display:none!important}
.ib-subject{margin:0;font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.2;text-wrap:balance}
.ib-from{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:14px;align-items:center}
.ib-from .ib-av{width:44px;height:44px;background:#000;color:#fff;font-size:16px}
.ib-from b{font-weight:600}
.ib-addr{color:var(--grey);font-size:14px;margin-left:6px;word-break:break-all}
.ib-to{color:var(--grey);font-size:13.5px;margin-top:2px;overflow-wrap:anywhere}
.ib-from time{color:var(--grey);font-size:13.5px;white-space:nowrap;align-self:start;padding-top:2px}
.ib-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.ib-actions .ib-del{margin-left:0}
.ib-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.7;max-width:66ch;padding-top:4px}
.ib-note{margin:0;color:var(--grey);font-size:13px}
.ib-reader .ib-none{display:grid;place-items:center;height:100%;padding:24px}
/* connect */
.ib-connect{max-width:560px;margin:48px auto;background:#fff;border-radius:24px;box-shadow:var(--sh);padding:40px;display:grid;gap:20px}
.ib-connect h1{margin:0;font-size:38px;font-weight:800;letter-spacing:-.035em;line-height:1.15}
.ib-connect ul{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.ib-connect li{display:grid;grid-template-columns:22px 1fr;gap:8px}
.ib-connect li::before{content:"✓";color:var(--teal);font-weight:700}
.ib-connect p{margin:0;color:var(--grey);font-size:13.5px}
.ib-connect .ib-btn{height:50px;font-size:15px}
/* compose */
.ib-dlg{border:0;border-radius:24px;padding:0;width:min(640px,94vw);box-shadow:0 30px 80px rgba(0,0,0,.28)}
.ib-dlg::backdrop{background:rgba(0,0,0,.4)}
.ib-dlg form{display:grid;gap:12px;padding:28px}
.ib-dlg h2{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.03em}
.ib-field{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;background:#fff;box-shadow:0 2px 9px rgba(0,0,0,.10);border-radius:12px;padding:0 14px}
.ib-field label{color:var(--grey);font-size:14px}
.ib-field input{border:0;background:transparent!important;box-shadow:none!important;font:15px Inter,Arial,sans-serif;color:var(--ink);padding:12px 0;outline:none;min-width:0}
.ib-field:focus-within{box-shadow:inset 0 0 0 2px var(--teal)}
.ib-dlg textarea{border:0;background:#fff;box-shadow:0 2px 9px rgba(0,0,0,.10)!important;border-radius:12px;padding:14px;font:16px/1.6 Inter,Arial,sans-serif;color:var(--ink);min-height:240px;resize:vertical;outline:none;width:100%}
.ib-dlg textarea:focus{box-shadow:inset 0 0 0 2px var(--teal)!important}
.ib-dlg textarea:focus-visible,.ib-field input:focus-visible{outline:none!important}
.ib-err{color:var(--ink);font-weight:600;font-size:13.5px;min-height:1.2em;margin:0}
.ib-dacts{display:flex;gap:10px;align-items:center;justify-content:flex-end}
.ib-from-lab{margin-right:auto;color:var(--grey);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* tablet + phone */
@media (max-width:1050px){.ib{padding:24px 24px 40px}}
@media (max-width:900px){
  .ib-top{grid-template-columns:1fr auto}.ib-search{grid-column:1/-1;grid-row:2;justify-self:stretch;width:100%}
  .ib-panes{grid-template-columns:1fr;height:auto}.ib-list{overflow:visible}
  .ib-reader{display:none;position:fixed;inset:0;z-index:80;border-radius:0;box-shadow:none}
  .reading .ib-reader{display:block}.ib-back{display:inline-flex!important}
  .ib-read{padding:16px 20px 120px;gap:20px}.ib-subject{font-size:24px}
}
@media (max-width:640px){
  .ib{padding:20px 16px 40px;gap:16px}.ib-title h1{font-size:26px}.ib-search kbd{display:none}
  .ib-from{grid-template-columns:40px minmax(0,1fr)}.ib-from time{grid-column:2;padding:0}.ib-from .ib-av{width:40px;height:40px}
  .ib-actions{display:grid;grid-template-columns:1fr 1fr}.ib-actions .ib-del{margin-left:0}.ib-actions .ib-select{width:100%}.ib-back{justify-self:start}
  .ib-connect{padding:28px 22px;margin:24px auto}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<main class="ib">
  <div id="banner" class="ib-banner" role="status" hidden></div>

  <section id="connect" class="ib-connect" hidden>
    <span class="ib-eyebrow">Email · about 1 minute</span><h1>Bring your email into CUEPA<span class="dot" style="color:var(--teal)">.</span></h1>
    <ul><li>Read your email right here</li><li>Reply and send from your own address</li><li>Sort into folders and delete, synced with Gmail</li><li>CUEPA never sees your password</li></ul>
    <a class="ib-btn ib-primary" href="/api/gmail?action=start&ws=${encodeURIComponent(ws)}">Connect Gmail →</a>
    <p>Google will ask you to allow reading and sending. If Google shows a warning you aren't sure about, stop and contact CUEPA before continuing. You can disconnect anytime.</p>
  </section>

  <div id="app" hidden style="display:grid;gap:20px">
    <div class="ib-top">
      <div class="ib-title-wrap"><span class="ib-eyebrow">Your email</span><div class="ib-title"><h1><span id="qtitle">Inbox</span><span class="dot">.</span></h1><span class="ib-count" id="count"></span></div></div>
      <form class="ib-search" id="sform" role="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="q" placeholder="Search your email" aria-label="Search your email"><kbd>⌘K</kbd></form>
      <button class="ib-primary" id="new" type="button">New email</button>
    </div>
    <nav class="ib-tabs" id="folders" aria-label="Folders"></nav>
    <div class="ib-panes" id="panes">
      <section class="ib-pane" aria-label="Email list">
        <div class="ib-listhead"><span id="qlab">Newest first</span><button class="ib-text" id="refresh" type="button">Refresh</button></div>
        <div class="ib-list" id="list"><div class="ib-none">Loading your email…</div></div>
      </section>
      <article class="ib-pane ib-reader" id="reader" aria-label="Reading pane"><div id="view" style="height:100%"><div class="ib-none">Select an email to read it.</div></div></article>
    </div>
  </div>
</main>

<dialog class="ib-dlg" id="dlg"><form id="form">
  <h2 id="dlgTitle">New email</h2>
  <div class="ib-field"><label for="to">To</label><input id="to" autocomplete="email" required></div>
  <div class="ib-field"><label for="cc">Cc</label><input id="cc" autocomplete="email" placeholder="Optional"></div>
  <div class="ib-field"><label for="subject">Subject</label><input id="subject"></div>
  <textarea id="msg" placeholder="Write your message" aria-label="Message" required></textarea>
  <p class="ib-err" id="err" role="alert"></p>
  <div class="ib-dacts"><span class="ib-from-lab" id="fromLab"></span><button type="button" class="ib-quiet" id="cancel">Cancel</button><button class="ib-primary" id="sendBtn" title="Send (Ctrl or ⌘ + Enter)">Send</button></div>
</form></dialog>
<script src="/assets/folder-colors.js"></script>
<script>
const WS=${JSON.stringify(ws)};
const $=id=>document.getElementById(id);
const call=(a,opt,q)=>fetch('/api/gmail?action='+a+'&ws='+encodeURIComponent(WS)+(q||''),Object.assign({credentials:'same-origin'},opt||{})).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Something went wrong. Try again.');return j;});
const api=(a,q)=>call(a,null,q);
const post=(a,b)=>call(a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameOf=f=>{const m=String(f).match(/^\\s*"?([^"<]*?)"?\\s*<[^>]+>/);return (m&&m[1].trim())||String(f).replace(/[<>]/g,'').trim();};
const addrOf=f=>{const m=String(f).match(/<([^>]+)>/);return m?m[1]:String(f).trim();};
const initial=f=>{const n=nameOf(f).replace(/^[^A-Za-z0-9À-ÿ]+/,'');return (n[0]||'·').toUpperCase();};
const isToday=d=>{const t=new Date(d);return !isNaN(t)&&t.toDateString()===new Date().toDateString();};
const when=d=>{const t=new Date(d);if(isNaN(t))return '';return isToday(d)?t.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):t.toLocaleDateString([], {month:'short',day:'numeric'});};
const longWhen=d=>{const t=new Date(d);return isNaN(t)?'':t.toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
let msgs=[],query='',me='',labels=[],folder='INBOX',current=-1;
let deepLink=null;
const isMe=a=>me&&String(a||'').toLowerCase().includes(me.toLowerCase());
const labelName=id=>{const l=labels.find(x=>x.id===id);return l?l.name:'';};
const needsReconnect=msg=>/connect your email again|not connected yet/i.test(String(msg||''));
const RECONNECT='/api/gmail?action=start&ws='+encodeURIComponent(WS);
const EMPTY_READER='<div class="ib-none">Select an email to read it.</div>';
function errBox(msg){return '<div class="ib-none">'+esc(msg)+(needsReconnect(msg)?'<div><a class="ib-btn ib-primary" href="'+RECONNECT+'">Reconnect Gmail</a></div>':'')+'</div>';}
function banner(text,ok){const b=$('banner');b.className='ib-banner '+(ok?'ok':'bad');b.textContent=text;if(!ok&&needsReconnect(text)){const a=document.createElement('a');a.href=RECONNECT;a.textContent='Reconnect Gmail';b.appendChild(a);}b.hidden=false;}
function toast(text,undo){const old=document.querySelector('.ib-toast');if(old)old.remove();const t=document.createElement('div');t.className='ib-toast';t.setAttribute('role','status');t.innerHTML='<span>'+esc(text)+'</span>'+(undo?'<button type="button">Undo</button>':'');document.body.appendChild(t);if(undo)t.querySelector('button').onclick=async()=>{t.remove();try{await undo();}catch(e){banner(e.message);}load();};setTimeout(()=>t.remove(),7000);}
const QS=new URLSearchParams(location.search);const OPEN_ID=QS.get('open'),OPEN_REPLY=QS.get('reply')==='1';
const p=QS.get('connect');
if(p==='ok')banner('Email connected. Your inbox is below.',true);
if(p==='cancelled')banner('Connection cancelled. Nothing was changed.');
if(p==='scopes')banner('Please allow both "read and manage" and "send" on the Google screen, then connect again.');
if(p==='failed')banner('Google could not connect. Try again, or contact CUEPA.');
if(p==='unavailable')banner('Email can’t be connected on this version of the hub. Use app.makingcuepa.com, or contact CUEPA.');
if(p||OPEN_ID)history.replaceState(null,'',location.pathname);

async function loadLabels(){try{labels=(await api('labels')).labels;}catch(e){labels=[{id:'INBOX',name:'Inbox'},{id:'SENT',name:'Sent'},{id:'TRASH',name:'Trash'}];}CuepaFolders.assign(labels);renderFolders();}
const isUserFolder=l=>!/^(INBOX|SENT|TRASH|SPAM|STARRED|IMPORTANT|UNREAD|DRAFT)$/.test(l.id);
function renderFolders(){$('folders').innerHTML=labels.map(l=>'<button type="button" data-f="'+esc(l.id)+'"'+(l.id===folder&&!query?' aria-current="true"':'')+'>'+(isUserFolder(l)?'<i style="background:'+CuepaFolders.colorFor(l).dot+'" aria-hidden="true"></i>':'')+esc(l.name)+'</button>').join('')+'<button type="button" class="add" data-add="1">New folder</button>';}
$('folders').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.add){const name=prompt('Name the new folder');if(!name)return;try{const r=await post('label-create',{name});labels.splice(labels.length-1,0,r.label);CuepaFolders.assign(labels);folder=r.label.id;query='';$('q').value='';renderFolders();load();}catch(err){banner(err.message);}return;}
  folder=b.dataset.f;query='';$('q').value='';renderFolders();closeReader();load();});

function renderTop(){
  const unread=msgs.filter(m=>m.unread).length;
  $('qtitle').textContent=query?'Search':(labelName(folder)||'Inbox');
  $('count').textContent=query?(msgs.length+(msgs.length===1?' result':' results')):folder==='INBOX'?(unread?unread+' unread':'All caught up'):(msgs.length+(msgs.length===1?' email':' emails'));
  $('qlab').textContent=query?('Results for “'+query+'”'):folder==='TRASH'?'Deleted emails stay here for 30 days':folder==='SENT'?'What you sent, newest first':'Newest first';
}
function rowWho(m){return folder==='SENT'||(isMe(m.from)&&m.to)?m.to:m.from;}
function renderList(){
  renderTop();
  const fname=labelName(folder)||'Inbox';
  if(!msgs.length){$('list').innerHTML='<div class="ib-none">'+(query?'No emails match that search.':folder==='TRASH'?'Trash is empty.':folder==='SENT'?'Nothing sent yet.':fname==='Inbox'?'Your inbox is empty.':'Nothing in '+esc(fname)+' yet.')+'</div>';return;}
  $('list').innerHTML=msgs.map((m,i)=>{const who=rowWho(m);const fs=CuepaFolders.foldersOf(m,labels,folder);const tags=fs.length?'<div class="ib-chips">'+fs.map(CuepaFolders.chip).join('')+'</div>':'';const avs=CuepaFolders.avatarStyle(fs[0]);
    return '<div class="ib-row'+(m.unread?' unread':'')+(i===current?' on':'')+'" role="button" tabindex="0" data-i="'+i+'"><span class="ib-dot" aria-hidden="true"></span><span class="ib-av" aria-hidden="true"'+avs+'>'+esc(initial(who))+'</span><div style="min-width:0"><div class="ib-r1"><span class="ib-name">'+(who===m.to&&who!==m.from?'To ':'')+esc(nameOf(who))+'</span><time>'+esc(when(m.date))+'</time></div><div class="ib-subj">'+esc(m.subject||'(no subject)')+'</div><div class="ib-snip">'+esc(m.snippet)+'</div>'+tags+'</div></div>';}).join('');
}
async function load(fetchNew=true){
  if(!fetchNew){renderList();return;}
  current=-1;$('list').innerHTML='<div class="ib-none">Loading…</div>';
  try{const r=await api('list',query?'&q='+encodeURIComponent(query):'&label='+encodeURIComponent(folder));msgs=r.messages;renderList();
    if(deepLink){const id=deepLink;deepLink=null;let i=msgs.findIndex(m=>m.id===id);if(i<0){msgs.unshift({id,from:'',subject:'',snippet:'',date:'',unread:false});renderList();i=0;}await open(i);if(OPEN_REPLY&&$('reply'))$('reply').click();}}
  catch(e){$('list').innerHTML=errBox(e.message);}
}
function closeReader(){document.body.classList.remove('reading','focus');current=-1;$('view').innerHTML=EMPTY_READER;document.querySelectorAll('.ib-row.on').forEach(x=>x.classList.remove('on'));}
function moveOptions(){return labels.filter(l=>l.id!==folder&&l.id!=='TRASH'&&l.id!=='SENT').map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>').join('');}
async function doMove(i,label){const m=msgs[i];if(!m||!label)return;const from=folder;try{await post('move',{id:m.id,label});msgs.splice(i,1);closeReader();renderList();toast('Moved to '+labelName(label)+'.',()=>post('move',{id:m.id,label:from}));}catch(e){banner(e.message);}}
async function doTrash(i){const m=msgs[i];if(!m)return;try{await post('trash',{id:m.id});msgs.splice(i,1);closeReader();renderList();toast('Deleted. It stays in Trash for 30 days.',()=>post('untrash',{id:m.id}));}catch(e){banner(e.message);}}
async function doRestore(i){const m=msgs[i];if(!m)return;try{await post('untrash',{id:m.id});msgs.splice(i,1);closeReader();renderList();toast('Restored to your inbox.');}catch(e){banner(e.message);}}

async function open(i){const m0=msgs[i];if(!m0)return;current=i;
  document.querySelectorAll('.ib-row.on').forEach(x=>x.classList.remove('on'));const row=document.querySelector('.ib-row[data-i="'+i+'"]');if(row){row.classList.add('on');row.classList.remove('unread');}
  if(m0.unread){m0.unread=false;renderTop();post('read-state',{id:m0.id,unread:false}).catch(()=>{});}
  document.body.classList.add('reading');$('view').innerHTML='<div class="ib-none">Opening…</div>';
  try{const {message:m}=await api('read','&id='+encodeURIComponent(m0.id));if(current!==i)return;
    const trash=folder==='TRASH';
    $('view').innerHTML='<div class="ib-read">'
      +'<button type="button" class="ib-quiet ib-back" id="mback">Back to '+esc(labelName(folder)||'Inbox')+'</button>'
      +'<div><h2 class="ib-subject">'+esc(m.subject||'(no subject)')+'</h2>'+(()=>{const fs=CuepaFolders.foldersOf(m,labels,'');return fs.length?'<div class="ib-chips" style="margin-top:10px">'+fs.map(CuepaFolders.chip).join('')+'</div>':'';})()+'</div>'
      +'<div class="ib-from"><span class="ib-av" aria-hidden="true"'+CuepaFolders.avatarStyle(CuepaFolders.foldersOf(m,labels,'')[0])+'>'+esc(initial(m.from))+'</span><div style="min-width:0"><b>'+esc(nameOf(m.from))+'</b><span class="ib-addr">'+esc(addrOf(m.from))+'</span><div class="ib-to">To '+esc(m.to)+(m.cc?'<br>Cc '+esc(m.cc):'')+'</div></div><time>'+esc(longWhen(m.date))+'</time></div>'
      +'<div class="ib-actions">'+(trash?'<button type="button" class="ib-primary" id="restore">Restore to inbox</button>':'<button type="button" class="ib-primary" id="reply">Reply</button><button type="button" class="ib-quiet" id="replyAll">Reply all</button>'+(moveOptions()?'<select class="ib-select" id="sideMove" aria-label="Move to folder"><option value="">Move to…</option>'+moveOptions()+'</select>':'')+'<button type="button" class="ib-quiet ib-del" id="sideDel">Delete</button>')+'<button type="button" class="ib-quiet ib-expand" id="expand" aria-pressed="'+document.body.classList.contains('focus')+'">'+(document.body.classList.contains('focus')?'Back to list':'Expand')+'</button>'+'</div>'
      +'<div class="ib-body">'+esc(m.body||m.snippet)+'</div>'
      +(trash?'':'<p class="ib-note">Replies go out from '+esc(me)+'. Nothing sends until you press Send.</p>')
      +'</div>';
    $('reader').scrollTop=0;
    $('mback').onclick=closeReader;
    $('expand').onclick=()=>{const on=document.body.classList.toggle('focus');$('expand').textContent=on?'Back to list':'Expand';$('expand').setAttribute('aria-pressed',on);$('reader').scrollTop=0;};
    if(trash){$('restore').onclick=()=>doRestore(i);return;}
    const list=v=>String(v||'').split(',').map(x=>addrOf(x)).filter(Boolean);
    const primary=isMe(m.from)?list(m.to):list(m.replyTo||m.from);
    const subj=/^re:/i.test(m.subject||'')?m.subject:'Re: '+(m.subject||'');
    const base={subject:subj,threadId:m.threadId,inReplyTo:m.messageId,references:m.references};
    $('reply').onclick=()=>compose({...base,to:primary.join(', ')});
    $('replyAll').onclick=()=>{const seen=new Set(primary.map(a=>a.toLowerCase()));const cc=[...list(m.to),...list(m.cc)].filter(a=>{const k=a.toLowerCase();if(seen.has(k)||isMe(a))return false;seen.add(k);return true;});compose({...base,to:primary.join(', '),cc:cc.join(', ')});};
    const sm=$('sideMove');if(sm)sm.onchange=()=>{if(sm.value)doMove(i,sm.value);};
    $('sideDel').onclick=()=>doTrash(i);
  }catch(err){$('view').innerHTML=errBox(err.message);}
}
$('list').addEventListener('click',e=>{const r=e.target.closest('.ib-row');if(r)open(+r.dataset.i);});
$('list').addEventListener('keydown',e=>{const r=e.target.closest('.ib-row');if(!r)return;
  if(e.key==='Enter'||e.key===' '){e.preventDefault();open(+r.dataset.i);}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=r[e.key==='ArrowDown'?'nextElementSibling':'previousElementSibling'];if(n)n.focus();}});
$('sform').addEventListener('submit',e=>{e.preventDefault();query=$('q').value.trim();renderFolders();closeReader();load();});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('q').focus();}if(e.key==='Escape'&&!$('dlg').open){if(document.body.classList.contains('focus')){document.body.classList.remove('focus');const x=$('expand');if(x){x.textContent='Expand';x.setAttribute('aria-pressed','false');}}else if(document.body.classList.contains('reading'))closeReader();}});
$('refresh').onclick=()=>{closeReader();load();};

let draft={};
function compose(d){draft=d||{};$('dlgTitle').textContent=draft.threadId?(draft.subject||'Reply'):'New email';$('to').value=draft.to||'';$('cc').value=draft.cc||'';$('subject').value=draft.subject||'';$('msg').value='';$('err').textContent='';$('dlg').showModal();(draft.to?$('msg'):$('to')).focus();}
$('new').onclick=()=>compose();
$('cancel').onclick=()=>$('dlg').close();
$('msg').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();$('form').requestSubmit();}});
$('form').addEventListener('submit',async e=>{e.preventDefault();$('sendBtn').disabled=true;$('sendBtn').textContent='Sending…';$('err').textContent='';
  try{await post('send',{to:$('to').value,cc:$('cc').value,subject:$('subject').value,body:$('msg').value,threadId:draft.threadId,inReplyTo:draft.inReplyTo,references:draft.references});
    $('dlg').close();banner('Sent from '+me+'. You can review it in Sent.',true);if(folder==='SENT'||folder==='INBOX')load();
  }catch(err){$('err').textContent=err.message;}finally{$('sendBtn').disabled=false;$('sendBtn').textContent='Send';}
});

async function init(){
  let st;try{st=await api('status');}catch(e){$('app').hidden=false;$('list').innerHTML=errBox(e.message);return;}
  if(!st.connected){$('connect').hidden=false;return;}
  me=st.email||'';$('fromLab').textContent='From '+me;
  $('app').hidden=false;await loadLabels();deepLink=/^[A-Za-z0-9]{6,64}$/.test(OPEN_ID||'')?OPEN_ID:null;load();
}
init();
</script></body></html>`, ws, name, 'inbox');
}
