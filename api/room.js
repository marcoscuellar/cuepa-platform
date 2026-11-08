const workspaceUI = require('../lib/workspace-ui');
// /<ws> — The Room: the home page. Left rail · the day and what needs you · newest unread emails.
// Same sign-in rule as the hub. All data comes live from /api/google, /api/timecards and /api/gmail in the browser
// (assets/room.js). Nothing here is sample data: anything not connected shows as waiting, never as zero.
const { readSession, readSessionChecked, POLICY_VERSION, canSee } = require('./_session');
const WORKSPACES = require('../lib/workspaces');

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function go(res, to) { res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); }

const ROOM_IS_HOME = false;

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const ws = u.searchParams.get('ws') || '';
  // Google Calendar connect returns to /<ws>?google=...; the onboarding card shows the result.
  if (u.searchParams.has('google') && /^[a-z0-9-]{1,60}$/.test(ws)) {
    return go(res, '/' + ws + '/start?google=' + encodeURIComponent(u.searchParams.get('google')));
  }
  if (!/^[a-z0-9-]{1,60}$/.test(ws) || !WORKSPACES[ws]) { res.statusCode = 404; return res.end('Not found'); }
  let s = null; try { s = await readSessionChecked(req); } catch (e) { s = null; }
  if (!canSee(s, ws)) return go(res, '/?next=/' + ws);
  if (s.temp) return go(res, '/?setpw=1&next=/' + ws);
  // For now Today is the home page. The Room comes back once there's more real data to show.
  // Marcos can still preview it at /<ws>?room=1.
  if (!ROOM_IS_HOME && u.searchParams.get('room') !== '1') return go(res, '/' + ws + '/today');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(workspaceUI.policyNotice(page(ws, WORKSPACES[ws].name, s.name || ''), s.policy === false, POLICY_VERSION));
};

function page(ws, wsName, person) {
  const W = esc(ws), N = esc(wsName), P = esc(person);
  const ini = esc(String(person || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?');
  return workspaceUI.apply(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>The Room · ${N} · CUEPA</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/assets/room-concept.css"></head><body data-ws="${W}" data-owner="${P}">
<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <div class="main">
    <header class="topbar">
      <div><h1>${N} Room</h1><p class="sub">Your leadership team's view. CUEPA sits in the middle of all of it.</p></div>
      <div class="topbar-right">
        <div class="room-status wait" id="sync" role="status"><span class="d"></span><span id="syncText">Checking connections…</span></div>
        <div class="whoami"><span class="av" aria-hidden="true">${ini}</span>${P || 'You'} <span class="role">· signed in</span></div>
      </div>
    </header>
    <main id="main" class="content">
      <section class="room-q" aria-labelledby="rq">
        <div class="rq-text"><b class="display" id="rq">Let's make room for you.</b><span id="rqLine">Checking your day…</span></div>
        <button class="rq-cta" id="tell" type="button">Tell CUEPA →</button>
      </section>
      <section class="metrics" id="metrics" aria-label="This week at a glance"></section>
      <div class="board">
        <div>
          <section class="panel" aria-labelledby="inboxH"><div class="panel-head"><h3 id="inboxH">Inbox</h3><a class="see" href="/${W}/inbox">See all →</a></div><div id="inbox"><p class="empty-note">Checking your inbox…</p></div></section>
          <h2 class="section-label gap">Live processes</h2>
          <div class="proc-list" id="procs"></div>
          <h2 class="section-label gap">Recent activity</h2>
          <div class="panel" id="activity"><p class="empty-note">Checking…</p></div>
        </div>
        <div class="rside">
          <section class="panel" aria-labelledby="weekH"><div class="panel-head"><h3 id="weekH">Your week</h3><a class="see" href="/${W}/hub#calendar">Calendar →</a></div><div class="days" id="days" role="group" aria-label="Pick a day"></div><div id="agenda"><p class="empty-note">Checking your calendar…</p></div></section>
          <section class="panel" aria-labelledby="waitH"><div class="panel-head"><h3 id="waitH">Waiting on you</h3><span class="count" id="waitCount" hidden></span></div><div id="approvals"><p class="empty-note">Checking…</p></div></section>
          <section class="panel" aria-labelledby="trustH"><div class="panel-head"><h3 id="trustH">Trust &amp; controls</h3></div><div id="trust"></div><p class="trust-note">Human in the middle. Nothing is sent, posted or approved without you.</p></section>
        </div>
      </div>
    </main>
    <footer class="dash-foot">Protect. Challenge. Verify. You decide.</footer>
  </div>
</div>
<script src="/assets/folder-colors.js"></script>
<script src="/assets/room-concept.js"></script>
</body></html>`, ws, wsName, 'room');
}
module.exports.page = page;
