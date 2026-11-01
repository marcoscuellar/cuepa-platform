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
    return json(res, status, { ok: false, error: status >= 500 && !e.status ? 'Something went wrong. Try again.' : e.message });
  }
};

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function page(ws, name) {
  const W = esc(ws), N = esc(name);
  return workspaceUI.apply(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>Inbox · ${N} · CUEPA</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
/* CUEPA hub look: white canvas, black type, turquoise accent, mono labels. Three panels: pulse / queue / reading. */
:root{--bg:#f6f7f7;--card:#fff;--ink:#0a0a0a;--dim:#4b5555;--mute:#7b8686;--line:#e5e9e9;--soft:#f1f4f4;--turq:#2dd4bf;--teal:#0b756a;--tbg:#e3f8f5;--amber:#a86a00;--abg:#fdf1dc;--red:#b42318;--rbg:#fdecea}
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{margin:0;background:var(--bg);color:var(--ink)}
body{font:14.5px/1.5 Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.lab{font:600 10.5px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--mute)}
button,.btn{font:600 13.5px Inter,'Helvetica Neue',Arial,sans-serif;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;padding:8px 13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
button:hover,.btn:hover{background:var(--soft)}
.go{background:var(--turq);border-color:var(--turq);color:#04201d}.go:hover{background:#5ee3d6}
.dark{background:var(--ink);border-color:var(--ink);color:#fff}.dark:hover{background:#222}
:focus-visible{outline:2px solid var(--turq);outline-offset:2px}
/* top bar like the hub */
.bar{position:sticky;top:0;z-index:4;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.bar-in{display:flex;align-items:center;gap:18px;padding:10px max(20px,env(safe-area-inset-left));max-width:1440px;margin:auto}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink)}
.mark{display:inline-flex;gap:3px}.mark i{width:7px;height:17px;border-radius:2px;background:var(--ink);display:block}.mark i+i{background:var(--turq)}
.brand b{font-weight:700;letter-spacing:.14em;font-size:13px}
.brand .lab{margin-left:4px}
nav{display:flex;gap:2px;margin-left:12px}
nav a{font:600 11px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);text-decoration:none;padding:7px 11px;border-radius:8px;display:inline-flex;align-items:center;gap:6px}
nav a:hover{background:var(--soft);color:var(--ink)}
nav a.on{background:var(--soft);color:var(--ink)}
nav a.on::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--turq)}
.nb{font:600 10px 'JetBrains Mono',monospace;background:var(--ink);color:#fff;border-radius:5px;padding:0 5px}
.search{margin-left:auto;display:flex;align-items:center;gap:8px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:0 10px;width:min(300px,30vw)}
.search svg{width:14px;height:14px;stroke:var(--mute);fill:none;stroke-width:2;flex:none}
.search input{flex:1;background:none;border:0;font:inherit;font-size:13.5px;padding:8px 0;outline:none;min-width:0;color:var(--ink)}
.search kbd{font:500 10.5px 'JetBrains Mono',monospace;color:var(--mute)}
.av{width:32px;height:32px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font:700 11px Inter,sans-serif;flex:none}
/* page */
.page{max-width:1440px;margin:auto;padding:30px max(20px,env(safe-area-inset-left)) 60px;display:grid;gap:24px}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap}
.hero h1{margin:6px 0 6px;font-size:clamp(32px,4.4vw,46px);font-weight:800;letter-spacing:-.035em;line-height:1}
.hero p{margin:0;color:var(--dim);font-size:16px;max-width:52ch}
.stats{display:flex;gap:10px;flex-wrap:wrap}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 18px;min-width:118px;box-shadow:0 1px 2px rgba(10,10,10,.04)}
.stat b{display:block;font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.stat span{color:var(--mute);font-size:12.5px}
.stat.t b{color:var(--teal)}
.banner{margin:0;padding:11px 16px;border-radius:12px;font-size:14px;border:1px solid}
.banner.ok{background:var(--tbg);border-color:#bdeee6;color:#064e45}.banner.bad{background:var(--rbg);border-color:#f6c9c3;color:var(--red)}
/* panels */
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,480px);gap:18px;align-items:start}
.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px rgba(10,10,10,.04),0 10px 30px rgba(10,10,10,.04)}
.ph{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding:18px 20px 12px}
.ph h2{margin:4px 0 0;font-size:20px;font-weight:700;letter-spacing:-.02em}
.queue{display:grid;padding:0 10px 10px}
.row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:14px;align-items:center;padding:13px 12px;border-radius:12px;cursor:pointer;border:1px solid transparent}
.row+.row{border-top-color:var(--line);border-radius:0}
.row:hover{background:var(--soft);border-radius:12px}
.row.on{background:var(--tbg);border-color:#bdeee6;border-radius:12px}
.dot{width:8px;height:8px;border-radius:50%}
.row.unread .dot{background:var(--turq)}
.row .t{min-width:0}
.row .f{font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .s{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
.row.unread .s{font-weight:700}
.row .m{color:var(--mute);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .acts{display:flex;gap:10px;align-items:center}
.row .acts button{padding:6px 11px;font-size:12.5px;opacity:0;transition:opacity .15s}
.row:hover .acts button,.row.on .acts button,.row:focus-within .acts button{opacity:1}
.when{font:500 11.5px 'JetBrains Mono',monospace;color:var(--mute);min-width:58px;text-align:right}
.empty{color:var(--mute);padding:40px 16px;text-align:center}
.folders{display:flex;gap:6px;flex-wrap:wrap;padding:0 20px 12px}
.folders button{padding:6px 12px;border-radius:999px;font-size:13px}
.folders button.on{background:var(--ink);border-color:var(--ink);color:#fff}
.folders button.add{border-style:dashed;color:var(--mute)}
.row .acts select{font:600 12.5px Inter,sans-serif;border:1px solid var(--line);border-radius:9px;padding:6px 8px;background:var(--card);color:var(--ink);opacity:0;transition:opacity .15s}
.row:hover .acts select,.row.on .acts select,.row:focus-within .acts select{opacity:1}
.row .acts .del{color:var(--red)}
.tag{font:600 10px 'JetBrains Mono',monospace;letter-spacing:.06em;background:var(--soft);border-radius:5px;padding:1px 6px;color:var(--dim);margin-left:6px}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:#fff;border-radius:12px;padding:12px 16px;display:flex;gap:14px;align-items:center;z-index:9;box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:14px}
.toast button{background:var(--turq);border-color:var(--turq);color:#04201d;padding:6px 12px}
.side .fx{display:flex;gap:8px;flex-wrap:wrap}.side .fx select{font:600 13px Inter,sans-serif;border-radius:9px;padding:8px 10px;background:#1d2323;color:#fff;border:1px solid #2a3232}.side .fx .del{background:#1d2323;border-color:#2a3232;color:#ff9a85}
/* reading panel: black card like "Prepared for you" */
.side{position:sticky;top:76px;background:var(--ink);color:#fff;border-radius:18px;padding:22px;display:grid;gap:16px;max-height:calc(100vh - 96px);overflow:auto}
.side .lab{color:#8fa09d}
.side h3{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em;line-height:1.2;text-wrap:balance}
.meta{display:grid;grid-template-columns:44px 1fr;gap:4px 10px;font-size:12.5px;border-top:1px solid #262c2c;border-bottom:1px solid #262c2c;padding:12px 0}
.meta span{color:#8fa09d}.meta div{color:#d6dddc;word-break:break-word}
.body{white-space:pre-wrap;word-break:break-word;line-height:1.65;color:#eef2f2;font-size:14.5px}
.side .note{font-size:12.5px;color:#8fa09d}
.side .empty{color:#8fa09d}
.mback{display:none!important;background:#1d2323;border-color:#2a3232;color:#fff}
/* connect */
.cc{max-width:460px;margin:40px auto;background:var(--ink);color:#fff;border-radius:18px;padding:30px;display:grid;gap:16px;box-shadow:0 28px 60px rgba(0,0,0,.18)}
.cc .lab{color:var(--turq)}
.cc h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.cc ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;color:#d6dddc}
.cc li::before{content:"✓  ";color:var(--turq)}
.cc .go{justify-content:center;padding:13px;font-size:15px}
.cc p{margin:0;color:#8fa09d;font-size:13px}
/* compose */
dialog{border:0;border-radius:18px;padding:0;width:min(580px,94vw);box-shadow:0 30px 80px rgba(0,0,0,.25)}
dialog::backdrop{background:rgba(10,10,10,.45)}
dialog form{display:grid;gap:10px;padding:24px}
dialog h3{margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.02em}
dialog input,dialog textarea{font:inherit;border:1px solid var(--line);border-radius:10px;padding:11px;width:100%;color:var(--ink)}
dialog textarea{min-height:220px;resize:vertical}
.err{color:var(--red);font-size:13px;min-height:1.2em;margin:0}
.dacts{display:flex;gap:8px;justify-content:flex-end;align-items:center}
.dacts .lab{margin-right:auto}
@media (max-width:1000px){nav a:not(.on){display:none}.grid{grid-template-columns:1fr}.side{display:none;position:fixed;inset:0;z-index:6;border-radius:0;max-height:none}.shell-reading .side{display:grid}.mback{display:inline-flex!important}}
@media (max-width:640px){.search{display:none}.brand .lab{display:none}.row .acts button{display:none}.stats{width:100%}.stat{flex:1;min-width:0}}
</style></head><body>
<header class="bar"><div class="bar-in">
  <a class="brand" href="/${W}"><span class="mark" aria-hidden="true"><i></i><i></i></span><b>CUEPA</b><span class="lab">${N}</span></a>
  <nav aria-label="Hub">
    <a href="/${W}">Today</a><a href="/${W}">Calendar</a><a href="/${W}">Timecards</a><a href="/${W}">Vendors</a>
    <a href="/${W}/inbox" class="on" aria-current="page">Inbox<span class="nb" id="navBadge" hidden></span></a>
  </nav>
  <form class="search" id="sform" role="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="q" placeholder="Search your email" aria-label="Search your email"><kbd>⌘K</kbd></form>
  <div class="av" id="av" aria-hidden="true">·</div>
</div></header>

<div class="page">
  <div id="banner" hidden></div>

  <section id="connect" hidden><div class="cc">
    <div class="lab">Email · about 1 minute</div>
    <h1>Bring your inbox into your hub.</h1>
    <ul><li>Read your email right here</li><li>Reply and send from your own address</li><li>Sort into folders and delete, synced with Gmail</li><li>CUEPA never sees your password</li></ul>
    <a class="btn go" href="/api/gmail?action=start&ws=${encodeURIComponent(ws)}">Connect Gmail →</a>
    <p>Google will ask you to allow reading and sending. If it says the app isn't verified yet, tap <b>Advanced</b>, then <b>Go to CUEPA</b>. You can disconnect anytime.</p>
  </div></section>

  <div id="app" hidden>
    <div class="hero">
      <div><div class="lab" id="today"></div><h1 id="title">Your inbox.</h1><p id="subtitle">Loading your email…</p></div>
      <div class="stats">
        <div class="stat t"><b class="mono" id="kUnread">–</b><span>unread</span></div>
        <div class="stat"><b class="mono" id="kToday">–</b><span>new today</span></div>
        <div class="stat"><button class="go" id="new">＋ New email</button></div>
      </div>
    </div>
    <div class="grid" style="margin-top:22px">
      <section class="panel">
        <div class="ph"><div><div class="lab" id="qlab">Latest first</div><h2 id="qtitle">Inbox</h2></div><button id="refresh" title="Refresh">↻ Refresh</button></div>
        <div class="folders" id="folders" aria-label="Folders"></div>
        <div class="queue" id="list"><div class="empty">Loading…</div></div>
      </section>
      <aside class="side" id="side">
        <div style="display:flex;justify-content:space-between;align-items:center"><div class="lab">Reading</div><button class="mback" id="mback">Close</button></div>
        <div id="view" style="display:grid;gap:16px"><div class="empty">Pick an email to read it here.</div></div>
      </aside>
    </div>
  </div>
</div>

<dialog id="dlg"><form id="form">
<div class="lab" id="dlgLab">New email</div><h3 id="dlgTitle">Write an email</h3>
<input id="to" autocomplete="email" placeholder="To" aria-label="To" required>
<input id="subject" placeholder="Subject" aria-label="Subject">
<textarea id="msg" placeholder="Write your message" aria-label="Message" required></textarea>
<p class="err" id="err"></p>
<div class="dacts"><span class="lab" id="fromLab"></span><button type="button" id="cancel">Cancel</button><button class="dark" id="sendBtn">Send</button></div>
</form></dialog>
<script>
const WS=${JSON.stringify(ws)};
const $=id=>document.getElementById(id);
const api=(a,q='')=>fetch('/api/gmail?action='+a+'&ws='+encodeURIComponent(WS)+q,{credentials:'same-origin'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Something went wrong.');return j;});
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameOf=f=>{const m=String(f).match(/^\\s*"?([^"<]*?)"?\\s*<[^>]+>/);return (m&&m[1].trim())||String(f).replace(/[<>]/g,'');};
const addrOf=f=>{const m=String(f).match(/<([^>]+)>/);return m?m[1]:String(f).trim();};
const isToday=d=>{const t=new Date(d);return !isNaN(t)&&t.toDateString()===new Date().toDateString();};
const when=d=>{const t=new Date(d);if(isNaN(t))return '';return isToday(d)?t.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):t.toLocaleDateString([], {month:'short',day:'numeric'});};
let msgs=[],query='',me='',labels=[],folder='INBOX';
const post=(a,b)=>fetch('/api/gmail?action='+a+'&ws='+encodeURIComponent(WS),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Something went wrong.');return j;});
const labelName=id=>{const l=labels.find(x=>x.id===id);return l?l.name:'';};
function toast(text,undo){const old=document.querySelector('.toast');if(old)old.remove();const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.innerHTML='<span>'+esc(text)+'</span>'+(undo?'<button type="button">Undo</button>':'');document.body.appendChild(t);if(undo)t.querySelector('button').onclick=async()=>{t.remove();try{await undo();}catch(e){banner(e.message);}load();};setTimeout(()=>t.remove(),7000);}
async function loadLabels(){try{labels=(await api('labels')).labels;}catch(e){labels=[{id:'INBOX',name:'Inbox'},{id:'TRASH',name:'Trash'}];}renderFolders();}
function renderFolders(){$('folders').innerHTML=labels.map(l=>'<button type="button" data-f="'+esc(l.id)+'"'+(l.id===folder?' class="on" aria-current="true"':'')+'>'+esc(l.name)+'</button>').join('')+'<button type="button" class="add" data-add="1">＋ New folder</button>';}
$('folders').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.add){const name=prompt('Name the new folder');if(!name)return;try{const r=await post('label-create',{name});labels.splice(labels.length-1,0,r.label);folder=r.label.id;renderFolders();load();}catch(err){banner(err.message);}return;}folder=b.dataset.f;query='';$('q').value='';renderFolders();load();});
function moveSelect(i){return '<select aria-label="Move to folder" data-move="'+i+'"><option value="">Move to…</option>'+labels.filter(l=>l.id!==folder&&l.id!=='TRASH').map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>').join('')+'</select>';}
async function doMove(i,label){const m=msgs[i];if(!m||!label)return;const from=folder;try{await post('move',{id:m.id,label});msgs.splice(i,1);load(false);toast('Moved to '+labelName(label)+'.',()=>post('move',{id:m.id,label:from==='INBOX'?'INBOX':from}));}catch(e){banner(e.message);}}
async function doTrash(i){const m=msgs[i];if(!m)return;try{await post('trash',{id:m.id});msgs.splice(i,1);load(false);if(document.querySelector('.row.on')===null){$('view').innerHTML='<div class="empty">Pick an email to read it here.</div>';}toast('Deleted. It sits in Gmail’s Trash for 30 days.',()=>post('untrash',{id:m.id}));}catch(e){banner(e.message);}}
$('today').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
function banner(text,ok){const b=$('banner');b.className='banner '+(ok?'ok':'bad');b.textContent=text;b.hidden=false;}
const p=new URLSearchParams(location.search).get('connect');
if(p==='ok')banner('Email connected. Your inbox is below.',true);
if(p==='cancelled')banner('Connection cancelled. Nothing was changed.');
if(p==='scopes')banner('Please allow both "read and manage" and "send" on the Google screen, then connect again.');
if(p==='failed')banner('Google could not connect. Try again, or contact CUEPA.');
if(p==='unavailable')banner('Email can’t be connected on this version of the hub. Use app.makingcuepa.com, or contact CUEPA.');
if(p)history.replaceState(null,'',location.pathname);
async function init(){
  let st;try{st=await api('status');}catch(e){$('app').hidden=false;$('list').innerHTML='<div class="empty">'+esc(e.message)+'</div>';return;}
  if(!st.connected){$('connect').hidden=false;return;}
  me=st.email||'';$('av').textContent=(me[0]||'·').toUpperCase();$('fromLab').textContent='From '+me;
  $('app').hidden=false;await loadLabels();load();
}
function renderTop(){
  const unread=msgs.filter(m=>m.unread).length, today=msgs.filter(m=>isToday(m.date)).length;
  if(!query){$('kUnread').textContent=unread;$('kToday').textContent=today;const nb=$('navBadge');nb.textContent=unread;nb.hidden=!unread;
    if(folder==='INBOX')$('subtitle').textContent=unread?(unread+(unread===1?' email needs':' emails need')+' a look. Reply right here, from '+me+'.'):'You are all caught up. Reply or write from '+me+'.';}
}
function renderList(){
  const fname=labelName(folder)||'Inbox';
  $('qtitle').textContent=query?'Results':fname;$('qlab').textContent=query?('Search · '+query):(folder==='TRASH'?'Deleted · kept 30 days':'Latest first');
  renderTop();
  $('list').innerHTML=msgs.length?msgs.map((m,i)=>'<div class="row'+(m.unread?' unread':'')+'" role="button" tabindex="0" data-i="'+i+'"><span class="dot" aria-hidden="true"></span><div class="t"><div class="f">'+esc(nameOf(m.from))+(query&&m.labels&&m.labels.length?m.labels.filter(l=>l!==folder).map(l=>labelName(l)?'<span class="tag">'+esc(labelName(l))+'</span>':'').join(''):'')+'</div><div class="s">'+esc(m.subject||'(no subject)')+'</div><div class="m">'+esc(m.snippet)+'</div></div><div class="acts">'+(folder==='TRASH'?'<button data-act="restore" data-i="'+i+'">Restore</button>':moveSelect(i)+'<button data-act="reply" data-i="'+i+'">Reply</button><button class="del" data-act="trash" data-i="'+i+'" aria-label="Delete">Delete</button>')+'<span class="when">'+esc(when(m.date))+'</span></div></div>').join(''):'<div class="empty">'+(query?'Nothing found.':folder==='TRASH'?'Trash is empty.':fname==='Inbox'?'Your inbox is empty.':'Nothing in '+esc(fname)+' yet.')+'</div>';
}
async function load(fetchNew=true){
  if(!fetchNew){renderList();return;}
  $('list').innerHTML='<div class="empty">Loading…</div>';
  try{const r=await api('list',(query?'&q='+encodeURIComponent(query):'')+(query?'':'&label='+encodeURIComponent(folder)));msgs=r.messages;renderList();
  }catch(e){$('list').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}
async function open(i,thenReply){const m0=msgs[i];if(!m0)return;
  document.querySelectorAll('.row.on').forEach(x=>x.classList.remove('on'));const row=document.querySelector('.row[data-i="'+i+'"]');if(row){row.classList.add('on');row.classList.remove('unread');}
  if(m0.unread){m0.unread=false;renderTop();}
  document.body.classList.add('shell-reading');$('view').innerHTML='<div class="empty">Opening…</div>';
  try{const {message:m}=await api('read','&id='+encodeURIComponent(m0.id));
    $('view').innerHTML='<h3>'+esc(m.subject||'(no subject)')+'</h3><div class="meta"><span>From</span><div>'+esc(m.from)+'</div><span>To</span><div>'+esc(m.to)+'</div><span>Date</span><div class="mono">'+esc(new Date(m.date).toLocaleString())+'</div></div><div class="fx"><button class="go" id="reply">Reply</button>'+(folder==='TRASH'?'':'<select id="sideMove" aria-label="Move to folder"><option value="">Move to…</option>'+labels.filter(l=>l.id!==folder&&l.id!=='TRASH').map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>').join('')+'</select><button class="del" id="sideDel">Delete</button>')+'</div><div class="body">'+esc(m.body||m.snippet)+'</div><div class="note">Replies go out from '+esc(me)+'. Nothing sends until you press Send.</div>';
    const rep=()=>compose({to:addrOf(m.from),subject:/^re:/i.test(m.subject)?m.subject:'Re: '+m.subject,threadId:m.threadId,inReplyTo:m.messageId,references:m.references});
    $('reply').onclick=rep;if(thenReply)rep();
    const sm=$('sideMove');if(sm)sm.onchange=()=>{if(sm.value){doMove(i,sm.value);document.body.classList.remove('shell-reading');$('view').innerHTML='<div class="empty">Pick an email to read it here.</div>';}};
    const sd=$('sideDel');if(sd)sd.onclick=()=>{doTrash(i);document.body.classList.remove('shell-reading');$('view').innerHTML='<div class="empty">Pick an email to read it here.</div>';};
  }catch(err){$('view').innerHTML='<div class="empty">'+esc(err.message)+'</div>';}
}
$('list').addEventListener('click',e=>{if(e.target.closest('select'))return;const a=e.target.closest('[data-act]');if(a){e.stopPropagation();const i=+a.dataset.i;if(a.dataset.act==='trash')return doTrash(i);if(a.dataset.act==='restore'){const m=msgs[i];return post('untrash',{id:m.id}).then(()=>{msgs.splice(i,1);load(false);toast('Back in your inbox.');}).catch(err=>banner(err.message));}return open(i,true);}const r=e.target.closest('.row');if(r)open(+r.dataset.i);});
$('list').addEventListener('change',e=>{const s=e.target.closest('select[data-move]');if(s&&s.value)doMove(+s.dataset.move,s.value);});
$('list').addEventListener('keydown',e=>{const r=e.target.closest('.row');if(r&&(e.key==='Enter'||e.key===' ')){e.preventDefault();open(+r.dataset.i);}});
$('mback').onclick=()=>document.body.classList.remove('shell-reading');
$('sform').addEventListener('submit',e=>{e.preventDefault();query=$('q').value.trim();load();});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('q').focus();}});
$('refresh').onclick=()=>load();
let draft={};
function compose(d){draft=d||{};$('dlgLab').textContent=d&&d.threadId?'Reply':'New email';$('dlgTitle').textContent=d&&d.threadId?(d.subject||'Reply'):'Write an email';$('to').value=draft.to||'';$('subject').value=draft.subject||'';$('msg').value='';$('err').textContent='';$('dlg').showModal();(draft.to?$('msg'):$('to')).focus();}
$('new').onclick=()=>compose();
$('cancel').onclick=()=>$('dlg').close();
$('form').addEventListener('submit',async e=>{e.preventDefault();$('sendBtn').disabled=true;$('err').textContent='';
  try{const r=await fetch('/api/gmail?action=send&ws='+encodeURIComponent(WS),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:$('to').value,subject:$('subject').value,body:$('msg').value,threadId:draft.threadId,inReplyTo:draft.inReplyTo,references:draft.references})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Could not send.');
    $('dlg').close();banner('Sent from '+me+'.',true);
  }catch(err){$('err').textContent=err.message;}finally{$('sendBtn').disabled=false;}
});
init();
</script></body></html>`, ws, name, 'inbox');
}

