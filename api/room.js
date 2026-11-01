const workspaceUI = require('../lib/workspace-ui');
// /<ws> — The Room: the home page. Left rail · the day and what needs you · newest unread emails.
// Same sign-in rule as the hub. All data comes live from /api/google, /api/timecards and /api/gmail in the browser
// (assets/room.js). Nothing here is sample data: anything not connected shows as waiting, never as zero.
const { readSession, canSee } = require('./_session');
const WORKSPACES = require('../lib/workspaces');

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function go(res, to) { res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); }

module.exports = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const ws = u.searchParams.get('ws') || '';
  // Google Calendar connect returns to /<ws>?google=...; the onboarding card shows the result.
  if (u.searchParams.has('google') && /^[a-z0-9-]{1,60}$/.test(ws)) {
    return go(res, '/' + ws + '/start?google=' + encodeURIComponent(u.searchParams.get('google')));
  }
  if (!/^[a-z0-9-]{1,60}$/.test(ws) || !WORKSPACES[ws]) { res.statusCode = 404; return res.end('Not found'); }
  let s = null; try { s = readSession(req); } catch (e) { s = null; }
  if (!canSee(s, ws)) return go(res, '/?next=/' + ws);
  if (s.temp) return go(res, '/?setpw=1&next=/' + ws);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(page(ws, WORKSPACES[ws].name, s.name || ''));
};

function page(ws, wsName, person) {
  const W = esc(ws), N = esc(wsName), P = esc(person);
  const ini = esc(String(person || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?');
  const nav = [['The Room', '/' + W, true], ['Today', '/' + W + '/today'], ['Inbox', '/' + W + '/inbox'], ['Calendar', '/' + W + '/hub#calendar'], ['Timecards', '/' + W + '/hub#timecards'], ['More', '/' + W + '/hub#connect']]
    .map(([l, h, on]) => '<a href="' + h + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + (on ? '<i aria-hidden="true"></i>' : '') + l + '</a>').join('');
  return workspaceUI.apply(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>The Room · ${N} · CUEPA</title>
<script>try{if(localStorage.getItem("cuepa_look")==="dark")document.documentElement.dataset.look="dark"}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/room.css">
</head><body data-ws="${W}" data-owner="${P}">
<a class="skip" href="#main">Skip to content</a>
<header class="global-header">
  <a class="brand" href="/${W}" aria-label="CUEPA home"><b>CUEPA</b><span class="brand-dot" aria-hidden="true"></span><span class="ws">${N}</span></a>
  <nav aria-label="Hub">${nav}</nav>
  <div class="profile"><span class="av" aria-hidden="true">${ini}</span><span>${P}</span><button class="look" id="look" aria-label="Switch light or dark look">◐</button></div>
</header>
<main id="main" class="workspace">
  <div class="page-heading"><div><p class="eyebrow">WORK, IN VIEW</p><h1 class="hello" id="hi">Hello.</h1><p class="quiet">Your priorities, conversations, and day. Together.</p></div><div class="page-meta"><div class="roomdate" id="date"></div><section class="ticker" aria-label="What’s connected"><div class="tickmove" id="ticker">Checking connections…</div></section></div></div>
    <section class="card brief" aria-labelledby="update">
      <h1 id="update">Checking your day…</h1>
      <div class="boxes" id="boxes"></div>
    </section>

  <div class="shell">
    <aside class="priorities-column" aria-label="Priorities and business overview">
    <section class="needsec" aria-labelledby="needsH">
      <h2 id="needsH" class="h2 teal">Needs you <span class="soft">Only what’s off track</span></h2>
      <div id="needs" class="needs"></div>
      <div class="ontrack" id="health" role="status">Checking connected sources…</div>
    </section>


    </aside>
    <section class="panel card" aria-label="Inbox, details, and assistant">
      <div class="switch" role="group" aria-label="Workspace panel">
        <button id="tabInbox" aria-pressed="true">Inbox</button><button id="tabDetails" aria-pressed="false">Details</button>
      </div>
    <div id="panel" tabindex="-1"></div>


    </section>
    <aside class="schedule-column" aria-label="Your calendar">
    <section class="card agenda cal" aria-labelledby="agendaH">
      <div class="weekhead"><h2 id="agendaH" class="h2">Your day</h2><span class="soft" id="calWhen"></span></div>
      <div class="days" id="days" role="group" aria-label="Pick a day this week"></div>
      <div id="agenda"><p class="quiet">Checking your calendar…</p></div>
      <div id="dayOpen" hidden></div>
    </section>

    </aside>
  </div>
  <footer class="workspace-footer">Protect. Challenge. Verify. You decide.</footer>
</main>
<div class="toast" id="toast" role="status" hidden></div>
<script src="/assets/room-model.js"></script>
<script src="/assets/room.js"></script>
</body></html>`, ws, wsName, 'room');
}

