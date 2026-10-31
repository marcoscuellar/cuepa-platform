// /<ws>/today — the new Today page (White Today layout, light + dark).
// Same sign-in rule as the hub. All data comes live from /api/google, /api/timecards and /api/gmail in the browser.
const { readSession, canSee } = require('./_session');
const WORKSPACES = require('../lib/workspaces');

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function go(res, to) { res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); }

module.exports = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const ws = u.searchParams.get('ws') || '';
  // Google Calendar connect returns to /<ws>?google=...#connect; that flow lives in the classic hub.
  // Always land back on the onboarding card (new look): it shows the result, turns on the main calendar,
  // and offers "Choose calendars" for anyone who wants more. Never drop people into the classic hub.
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>Today · ${N} · CUEPA</title>
<script>try{if(localStorage.getItem("cuepa_look")==="dark")document.documentElement.dataset.look="dark"}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap">
<style>
/* White Today: sidebar · decisions + day · why. Dark = C Dark values. */
:root{--bg:#f4f5f4;--side:#ffffff;--card:#ffffff;--soft:#f3f4f3;--ink:#0a0a0a;--ink2:#3c4547;--mute:#6b7575;--line:#e4e7e6;--turq:#2dd4bf;--teal:#0b756a;--tbg:#e3f6f2;--tline:#9fd9cf;--amber:#9a5b00;--abg:#fdf1dc;--aline:#ecc98a;--meet:#eef0ef;--evt:#dcf7ef;--evtline:#5fcfb7;--why:#e6f6f0;--shadow:0 1px 2px rgba(10,10,10,.04),0 12px 32px rgba(10,10,10,.06);color-scheme:light}
:root[data-look="dark"]{--bg:#000000;--side:#0a0a0a;--card:#121212;--soft:#1a1a1a;--ink:#ffffff;--ink2:#d6d6d6;--mute:#9a9a9a;--line:#242424;--turq:#2dd4bf;--teal:#5eead4;--tbg:rgba(45,212,191,.10);--tline:rgba(45,212,191,.4);--amber:#e8a43c;--abg:rgba(232,164,60,.12);--aline:rgba(232,164,60,.45);--meet:#1c1c1c;--evt:rgba(45,212,191,.12);--evtline:rgba(45,212,191,.5);--why:rgba(45,212,191,.10);--shadow:0 1px 0 rgba(255,255,255,.04) inset,0 14px 36px rgba(0,0,0,.6);color-scheme:dark}
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{margin:0;background:var(--bg);color:var(--ink)}
body{font:15px/1.5 Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
.mono,.lab{font-family:'JetBrains Mono',ui-monospace,monospace}
.lab{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.lab.t{color:var(--teal)}
button{font:inherit;cursor:pointer;color:inherit}
:focus-visible{outline:2px solid var(--turq);outline-offset:2px}
.btn{display:inline-flex;align-items:center;gap:6px;border:0;background:var(--soft);border-radius:10px;padding:9px 14px;font-weight:600;font-size:14px;text-decoration:none;color:var(--ink)}
.btn:hover{background:var(--line)}
.btn.dark{background:var(--ink);color:var(--bg)}
.btn.dark:hover{background:var(--turq);color:#04201d}
.btn.go{background:var(--turq);color:#04201d}
.btn:disabled{opacity:.5;cursor:default}
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
/* sidebar */
.side{background:var(--side);border-right:1px solid var(--line);padding:22px 16px;display:flex;flex-direction:column;gap:18px;position:sticky;top:0;height:100vh;overflow:auto}
.brand{display:flex;align-items:center;gap:10px;padding:0 6px;text-decoration:none}
.mark{display:inline-flex;gap:3px}.mark i{width:7px;height:18px;border-radius:2px;background:var(--ink);display:block}.mark i+i{background:var(--turq)}
.brand b{font-weight:700;letter-spacing:.12em;font-size:15px}
.wsbox{background:var(--soft);border-radius:12px;padding:10px 12px}
.wsbox b{display:block;font-weight:600;margin-top:2px}
nav{display:grid;gap:2px}
nav a{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:500;color:var(--ink)}
nav a:hover{background:var(--soft)}
nav a.on{background:var(--ink);color:var(--bg)}
.ct{font:600 11px 'JetBrains Mono',monospace;background:var(--tbg);color:var(--teal);border-radius:7px;padding:1px 8px}
nav a.on .ct{background:var(--turq);color:#04201d}
.tiles{display:grid;gap:8px}
.tile{background:var(--card);border-radius:12px;padding:11px 14px}
.tile span{color:var(--mute);font-size:13px}
.tile div{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.tile b{font-size:22px;font-weight:700;letter-spacing:-.02em}
.tile small{font-size:12px;font-weight:600;color:var(--mute)}
.tile small.w{color:var(--amber)}
.me{margin-top:auto;display:flex;align-items:center;gap:10px;border-top:1px solid var(--line);padding:14px 6px 0}
.av{width:36px;height:36px;border-radius:50%;background:var(--ink);color:var(--bg);display:grid;place-items:center;font:700 12px 'JetBrains Mono',monospace;flex:none}
.me b{display:block;font-size:14px}.me small{color:var(--mute);font-size:12.5px}
.look{margin-left:auto;background:var(--card);border-radius:999px;width:36px;height:36px;display:grid;place-items:center}
/* main */
.main{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-width:0}
.topbar{grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:14px 28px;border-bottom:1px solid var(--line);background:var(--side);position:sticky;top:0;z-index:5}
.search{flex:1;max-width:640px;display:flex;align-items:center;gap:10px;background:var(--soft);border-radius:12px;padding:0 14px}
.search svg{width:16px;height:16px;stroke:var(--mute);fill:none;stroke-width:2;flex:none}
.search input{flex:1;border:0;background:none;font:inherit;padding:11px 0;outline:none;color:var(--ink);min-width:0}
.search kbd{font:600 11px 'JetBrains Mono',monospace;color:var(--mute);border-radius:6px;padding:1px 6px;background:var(--card)}
.conn{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);white-space:nowrap}
.conn i{width:8px;height:8px;border-radius:50%;background:var(--turq);display:block}
.conn i.off{background:var(--amber)}
.center{padding:28px 28px 60px;min-width:0;display:grid;gap:22px;align-content:start}
.hello h1{margin:6px 0 6px;font-size:clamp(30px,3.4vw,40px);font-weight:800;letter-spacing:-.035em;line-height:1.05}
.hello p{margin:0;color:var(--ink2);font-size:17px;max-width:62ch}
.stats{display:flex;gap:12px;flex-wrap:wrap}
.stat{background:var(--card);border-radius:14px;padding:12px 16px;min-width:140px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:26px;font-weight:800;letter-spacing:-.03em}
.stat span{color:var(--mute);font-size:13px}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:18px;align-items:start}
.cols.line{grid-template-columns:minmax(0,1fr)}.cols.line .day{order:-1}
.colhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
.colhead h2{margin:0;font-size:19px;font-weight:700;letter-spacing:-.02em}
.needs{display:grid;gap:12px}
.need{background:var(--card);border:0;border-radius:16px;padding:16px 18px;box-shadow:var(--shadow);display:grid;gap:8px;cursor:pointer}
.need.on{box-shadow:0 0 0 2px var(--turq),var(--shadow)}
.need .row1{display:flex;gap:10px;align-items:center}
.need .n{font:600 12px 'JetBrains Mono',monospace;color:var(--mute)}
.chip{display:inline-flex;align-items:center;gap:6px;font:600 10.5px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;border-radius:6px;padding:3px 8px;background:var(--soft);color:var(--ink2)}
.chip.w{background:var(--abg);color:var(--amber)}.chip.t{background:var(--tbg);color:var(--teal)}
.need h3{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em}
.need p{margin:0;color:var(--ink2);font-size:14.5px}
.need .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.empty{color:var(--mute);background:var(--soft);border-radius:16px;padding:22px;text-align:center}
.day{background:var(--card);border-radius:16px;box-shadow:var(--shadow);padding:16px 18px}
.dayhead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.dayhead h2{margin:0;font-size:19px;font-weight:700;letter-spacing:-.02em}
.seg{display:inline-flex;border-radius:9px;overflow:hidden}
.seg button{border:0;background:none;padding:5px 10px;font-size:12.5px;font-weight:600;color:var(--mute)}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--mute);margin:8px 0 6px}
.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:10px;height:10px;border-radius:3px;display:block}
.slots{display:grid}
.slot{display:grid;grid-template-columns:70px 1fr;gap:10px;border-top:1px solid var(--line);min-height:44px;padding:6px 0}
.slot time{font:500 12px 'JetBrains Mono',monospace;color:var(--mute);padding-top:3px}
.slot .evs{display:grid;gap:6px}
.nowline{display:flex;align-items:center;gap:8px;font:700 11px 'JetBrains Mono',monospace;color:var(--teal);letter-spacing:.1em}
.nowline::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--turq)}
.nowline::after{content:"";flex:1;height:1px;background:var(--turq);opacity:.5}
.ev{border-radius:10px;padding:9px 12px;background:var(--meet);display:flex;justify-content:space-between;gap:8px}
.ev b{display:block;font-size:14px;font-weight:600}.ev small{color:var(--mute);font-size:12.5px}
.ev .k{font:700 10px 'JetBrains Mono',monospace;letter-spacing:.1em;color:var(--mute);white-space:nowrap}
.ev.dl{background:var(--abg)}.ev.dl .k{color:var(--amber)}
.ev.pe{background:var(--evt)}.ev.pe .k{color:var(--teal)}
.strip{position:relative;margin-top:8px}
.ticks{display:grid;grid-template-columns:repeat(10,1fr);font:500 11.5px 'JetBrains Mono',monospace;color:var(--mute)}
.ticks span{border-left:1px solid var(--line);padding:0 0 6px 6px}
.lane{position:relative;height:96px;margin-top:4px}
.blk{position:absolute;top:0;bottom:0;border-radius:10px;padding:8px 10px;min-width:0;background:var(--meet);overflow:hidden;font-size:12.5px}
.blk b{display:block;font-size:13px;line-height:1.25}.blk small{color:var(--mute)}
.blk.dl{background:var(--abg)}.blk.pe{background:var(--evt)}
.blk,.ev{cursor:pointer;border:0;text-align:left;font:inherit;color:inherit;width:100%}.blk:hover,.ev:hover{box-shadow:0 0 0 2px var(--turq)}
.evd{position:fixed;inset:0;z-index:30;background:rgba(10,10,10,.35);display:flex;align-items:center;justify-content:center;padding:16px}
.evc{background:var(--card);color:var(--ink);border-radius:16px;box-shadow:var(--shadow);width:min(460px,100%);padding:22px;display:grid;gap:12px}
.evc h3{margin:0;font-size:20px;font-weight:700;letter-spacing:-.02em}.evc .r{display:grid;grid-template-columns:70px 1fr;gap:8px;font-size:14.5px}.evc .r span{color:var(--mute)}.evc .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.nowbar{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--turq);border-radius:2px}
.nowtxt{margin-top:10px;font-size:13px;color:var(--ink2)}.nowtxt b{color:var(--teal)}
.dayacts{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
/* right panel */
.why{border-left:1px solid var(--line);background:var(--side);padding:24px 22px 60px;display:grid;gap:18px;align-content:start;min-width:0}
.why h2{margin:4px 0 0;font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.2}
.why p{margin:0;color:var(--ink2);font-size:15px}
.why h4{margin:0 0 8px;font-size:14px;font-weight:600;color:var(--ink2)}
.checked{display:flex;gap:8px;flex-wrap:wrap}
.checked span{border-radius:8px;padding:5px 10px;font-size:13px;background:var(--card)}
.ifyou{border-radius:12px;background:var(--card);overflow:hidden}
.ifyou .h{padding:10px 14px;font-weight:600;font-size:14px;border-bottom:1px solid var(--line)}
.ifyou .r{display:grid;grid-template-columns:72px 1fr;gap:10px;padding:10px 14px;border-top:1px solid var(--line);font-size:14px}
.ifyou .r:first-of-type{border-top:0}
.ifyou .r .lab{padding-top:3px}
.draft{border-radius:12px;padding:14px;background:var(--soft);display:grid;gap:10px}
.draft .top{display:flex;justify-content:space-between}
.draft textarea{width:100%;min-height:150px;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;font-size:14px;background:var(--card);color:var(--ink);resize:vertical}
.draft small{color:var(--mute);font-size:12.5px}
.safe{background:var(--why);border-radius:12px;padding:12px 14px;font-size:13.5px;color:var(--teal);display:flex;gap:10px}
.safe i{width:7px;height:16px;border-left:3px solid var(--teal);border-right:3px solid var(--turq);flex:none;margin-top:2px}
.act{display:grid}
.act .r{display:grid;grid-template-columns:62px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:14px}
.act .r:first-child{border-top:0}
.act time{font:500 12px 'JetBrains Mono',monospace;color:var(--mute);padding-top:2px}
.act .s{display:block;font:700 10px 'JetBrains Mono',monospace;letter-spacing:.1em;color:var(--teal);margin-top:2px}
.toast{position:fixed;right:20px;bottom:20px;background:var(--ink);color:var(--bg);padding:12px 16px;border-radius:12px;font-size:14px;z-index:20;max-width:360px}
@media (max-width:1250px){.main{grid-template-columns:minmax(0,1fr)}.why{border-left:0;border-top:1px solid var(--line)}}
@media (max-width:980px){.cols{grid-template-columns:minmax(0,1fr)}}
@media (max-width:820px){.shell{grid-template-columns:minmax(0,1fr)}.side{position:static;height:auto}.side .tiles,.side .me{display:none}nav{grid-auto-flow:column;overflow-x:auto}.topbar{position:static;padding:12px 16px}.center{padding:20px 16px 40px}.why{padding:20px 16px 40px}.conn{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<div class="shell">
  <aside class="side">
    <a class="brand" href="/${W}"><span class="mark" aria-hidden="true"><i></i><i></i></span><b>CUEPA</b></a>
    <div class="wsbox"><div class="lab">Workspace</div><b>${N}</b></div>
    <nav aria-label="Hub">
      <a class="on" href="/${W}" aria-current="page">Today<span class="ct" id="nNeeds" hidden></span></a>
      <a href="/${W}/inbox">Inbox<span class="ct" id="nUnread" hidden></span></a>
      <a href="/${W}/hub#calendar">Calendar</a>
      <a href="/${W}/hub#timecards">Timecards<span class="ct" id="nTc" hidden></span></a>
      <a href="/${W}/hub#vendors">Vendors</a>
      <a href="/${W}/hub#meetings">Meetings</a>
      <a href="/${W}/hub#connect">Setup</a>
      <a href="/${W}/hub#access">Access</a>
    </nav>
    <div class="tiles">
      <div class="lab t" style="padding:4px 4px 0">This period</div>
      <div class="tile"><span>Timecards in</span><div><b id="tTc">–</b><small id="tTcS"></small></div></div>
      <div class="tile"><span>Unread email</span><div><b id="tMail">–</b><small id="tMailS"></small></div></div>
      <div class="tile"><span>On today's calendar</span><div><b id="tCal">–</b><small id="tCalS"></small></div></div>
      <div class="tile"><span>Drafts waiting</span><div><b id="tDr">–</b><small>Not sent</small></div></div>
    </div>
    <div class="me"><span class="av" aria-hidden="true">${ini}</span><div><b>${P}</b><small>Workspace owner</small></div>
      <button class="look" id="look" title="Switch light / dark" aria-label="Switch light or dark look">◐</button></div>
  </aside>

  <div class="main">
    <div class="topbar">
      <form class="search" id="sform" role="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="q" placeholder="Search your email, like “invoice” or a name" aria-label="Search your email"><kbd>⌘K</kbd></form>
      <div class="conn" id="conn"><i id="connDot"></i><span id="connTxt">Checking connections…</span></div>
    </div>

    <main class="center">
      <div class="hello">
        <div class="lab t" id="date"></div>
        <h1 id="hi">Good morning.</h1>
        <p id="sub">Checking your calendar, timecards and email…</p>
      </div>
      <div class="stats">
        <div class="stat"><b id="sNeeds">–</b><span>need you</span></div>
        <div class="stat"><b id="sDrafts">–</b><span>drafts, not sent</span></div>
        <div class="stat"><b id="sMail">–</b><span>unread emails</span></div>
      </div>
      <div class="cols" id="cols">
        <section>
          <div class="colhead"><h2>What needs you</h2><span class="lab">Your decision</span></div>
          <div class="needs" id="needs"><div class="empty">Loading…</div></div>
        </section>
        <section class="day">
          <div class="dayhead"><h2>Today, in one view</h2>
            <div class="seg" role="group" aria-label="Calendar view"><button id="vList" aria-pressed="true">List</button><button id="vLine" aria-pressed="false">One line</button></div></div>
          <div class="legend"><span><i style="background:var(--meet)"></i>Meetings</span><span><i style="background:var(--abg)"></i>Deadlines</span><span><i style="background:var(--evt)"></i>Program events</span></div>
          <div id="dayBody"><div class="empty">Loading your calendar…</div></div>
          <div class="dayacts"><a class="btn" href="/${W}/hub#calendar">Open the full calendar</a><button class="btn" id="resync">↻ Resync</button></div>
        </section>
      </div>
    </main>

    <aside class="why" id="why"><div class="empty">Pick something on the left to see why it's here.</div></aside>
  </div>
</div>
<div class="toast" id="toast" hidden></div>
<script>
const WS=${JSON.stringify(ws)}, OWNER=${JSON.stringify(String(person || ''))};
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const first=n=>String(n||'').split(' ')[0];
const pad=n=>String(n).padStart(2,'0');
const localDate=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
function monday(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return localDate(d);}
const clock=d=>d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
async function get(url){const r=await fetch(url,{credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||'Unavailable');e.status=r.status;throw e;}return j;}
function toast(t){const el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,4200);}
const log=[];function did(text,state){log.unshift({at:new Date(),text,state});}

/* look */
$('look').onclick=()=>{const dark=document.documentElement.dataset.look!=='dark';if(dark)document.documentElement.dataset.look='dark';else delete document.documentElement.dataset.look;try{localStorage.setItem('cuepa_look',dark?'dark':'light')}catch(e){}};
/* header */
const now=new Date();const h=now.getHours();
$('date').textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
$('hi').textContent=(h<12?'Good morning':h<17?'Good afternoon':'Good evening')+', '+(first(OWNER)||'there')+'.';
$('sform').addEventListener('submit',e=>{e.preventDefault();const q=$('q').value.trim();location.href='/'+WS+'/inbox'+(q?'?q='+encodeURIComponent(q):'');});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('q').focus();}});

const S={cal:null,events:[],tc:null,mail:null,inbox:[],needs:[],sel:0,view:'list',drafts:{}};
try{if(localStorage.getItem('cuepa_dayview')==='line')S.view='line'}catch(e){}

async function loadCal(){
  try{const st=await get('/api/google?action=status&ws='+WS);S.cal={connected:st.connected,selected:(st.selected||[]).length};
    if(!st.connected||!S.cal.selected){S.events=[];return;}
    const a=new Date();a.setHours(0,0,0,0);const b=new Date(a);b.setDate(b.getDate()+1);
    const r=await get('/api/google?'+new URLSearchParams({action:'events',ws:WS,start:a.toISOString(),end:b.toISOString()}));
    S.events=r.events||[];did('Calendar synced, '+S.events.length+' event'+(S.events.length===1?'':'s')+' today','synced');
  }catch(e){S.cal={connected:S.cal?S.cal.connected:false,error:e.status===401||e.status===400||e.status===409?'expired':'down',msg:e.message};S.events=[];}
}
async function loadTc(){
  try{const r=await get('/api/timecards?'+new URLSearchParams({action:'week',ws:WS,week:monday()}));
    const card=id=>r.cards[id]||{status:'notin'};
    S.tc={team:r.team,days:r.days,sent:r.team.filter(m=>card(m.id).status==='sent'),late:r.team.filter(m=>['notin','fix'].includes(card(m.id).status)),approved:r.team.filter(m=>card(m.id).status==='approved')};
    did('Timecards checked for this week','checked');
  }catch(e){S.tc={error:e.message,team:[],sent:[],late:[],approved:[]};}
}
async function loadMail(){
  try{const st=await get('/api/gmail?action=status&ws='+WS);S.mail={connected:st.connected,email:st.email};
    if(st.connected){const r=await get('/api/gmail?action=list&ws='+WS);S.inbox=r.messages||[];did('Inbox checked, '+S.inbox.filter(m=>m.unread).length+' unread','checked');}
  }catch(e){S.mail={connected:S.mail?S.mail.connected:false,error:e.message};S.inbox=[];}
}
function kind(e){const t=(e.title+' '+e.calendar).toLowerCase();if(/deadline|due|closes|payroll|submit/.test(t))return 'dl';if(/program|class|event|show|session|rehears/.test(t))return 'pe';return 'mt';}
const KLAB={dl:'Deadline',pe:'Event',mt:'Meeting'};
const tOf=x=>x&&x.dateTime?new Date(x.dateTime):null;

function buildNeeds(){
  const n=[];const tc=S.tc||{sent:[],late:[]};const weekTxt=(tc.days&&tc.days.length)?new Date(tc.days[0]+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})+' – '+new Date(tc.days[6]+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'this week';
  if(S.cal&&(!S.cal.connected||S.cal.error)) n.push({id:'cal',chip:['w','Calendar'],title:S.cal.error==='expired'?'Reconnect your calendar':'Connect your calendar',text:S.cal.error==='expired'?'Google stopped sharing your calendar, so today\\'s view is empty. Reconnecting takes about a minute.':'Your day view is empty until a calendar is connected.',
    why:'The hub reads your calendar to build today\\'s view and to flag deadlines. '+(S.cal.error==='expired'?'The last connection expired, which is why nothing shows today.':'No calendar is connected yet.'),checked:['Calendar connection'],ifyou:[['Opens','Google sign-in, read-only'],['Changes','Nothing on your calendar']],btn:['Reconnect','/'+WS+'/hub#connect']});
  if(tc.sent.length) n.push({id:'approve',chip:['t','Timecards'],title:'Approve '+tc.sent.length+' timecard'+(tc.sent.length>1?'s':'')+' for this week',text:tc.sent.map(m=>first(m.name)).join(', ')+' sent hours for '+weekTxt+'. Approved hours go into the payroll spreadsheet.',
    why:'These hours were sent from staff timecard links and are waiting on you. Nothing reaches payroll until you approve.',checked:['Timecards, this week','Staff timecard links'],ifyou:[['Approves',tc.sent.map(m=>m.name).join(', ')],['Then','Hours are ready for the payroll download']],btn:['Review & approve','/'+WS+'/hub#timecards']});
  const withEmail=tc.late.filter(m=>m.email);
  if(tc.late.length){const msg='Hi {first name}, a quick reminder to add your hours for '+weekTxt+'. It takes about a minute: {link}\\n\\nThank you!\\n'+(first(OWNER)||'');
    S.drafts.remind=S.drafts.remind||msg;
    n.push({id:'remind',chip:['w','Due this week'],title:'Remind '+tc.late.length+' '+(tc.late.length>1?'people':'person')+' about hours',text:tc.late.map(m=>first(m.name)).join(', ')+(tc.late.length>1?' haven\\'t':' hasn\\'t')+' sent hours for '+weekTxt+' yet. The hub drafted a reminder for them only.',
      why:'Payroll can\\'t go out until everyone\\'s hours are in. The hub drafted one short reminder, personalized with each person\\'s own timecard link.',checked:['Timecards, this week','Team list'],
      ifyou:[['Send to',withEmail.length?withEmail.map(m=>m.name).join(', '):'Nobody has an email on file yet'],['From',S.mail&&S.mail.connected?S.mail.email:'Your email, once Gmail is connected'],['When','Right after you press Send']],draft:'remind',to:withEmail,btn:['Review the draft',null]});}
  const unread=S.inbox.filter(m=>m.unread);
  if(S.mail&&!S.mail.connected) n.push({id:'gmail',chip:['','Email'],title:'Connect your email',text:'Bring your inbox into the hub so you can read and reply from your own address.',why:'With email connected, reminders go out from your own address, and replies land where you already work.',checked:['Email connection'],ifyou:[['Opens','Google sign-in'],['Allows','Read and send. Nothing sends without you.']],btn:['Connect Gmail','/'+WS+'/inbox']});
  else if(unread.length) n.push({id:'mail',chip:['','Email'],title:unread.length+' unread email'+(unread.length>1?'s':''),text:unread.slice(0,3).map(m=>String(m.from).replace(/<.*>/,'').replace(/"/g,'').trim()).join(', ')+(unread.length>3?' and more':'')+'.',
    why:'These came in to '+(S.mail.email||'your inbox')+' and haven\\'t been opened yet.',checked:['Inbox, latest 25'],ifyou:[['Opens','Your inbox in the hub'],['Replies','Go out from your address']],btn:['Open inbox','/'+WS+'/inbox']});
  S.needs=n;if(S.sel>=n.length)S.sel=0;
}

function render(){
  buildNeeds();const tc=S.tc||{team:[],sent:[],late:[],approved:[]};const unread=S.inbox.filter(m=>m.unread).length;
  const drafts=S.needs.some(x=>x.draft)?1:0;
  $('sNeeds').textContent=S.needs.length;$('sDrafts').textContent=drafts;$('sMail').textContent=S.mail&&S.mail.connected?unread:'–';
  const setCt=(id,v)=>{$(id).textContent=v;$(id).hidden=!v;};setCt('nNeeds',S.needs.length);setCt('nUnread',unread);setCt('nTc',tc.sent.length+tc.late.length);
  $('tTc').textContent=tc.team.length?(tc.team.length-tc.late.length)+' of '+tc.team.length:'–';$('tTcS').textContent=tc.late.length?tc.late.length+' missing':'';$('tTcS').className=tc.late.length?'w':'';
  $('tMail').textContent=S.mail&&S.mail.connected?unread:'–';$('tMailS').textContent=S.mail&&S.mail.connected?'':'Not connected';
  $('tCal').textContent=S.cal&&S.cal.connected&&!S.cal.error?S.events.length:'–';$('tCalS').textContent=S.cal&&S.cal.error?'Needs reconnect':'';$('tCalS').className=S.cal&&S.cal.error?'w':'';
  $('tDr').textContent=drafts;
  const calOk=S.cal&&S.cal.connected&&!S.cal.error, mailOk=S.mail&&S.mail.connected;
  $('connDot').className=calOk&&mailOk?'':'off';$('connTxt').textContent=(calOk?'Calendar connected':'Calendar needs attention')+' · '+(mailOk?'Gmail connected':'Gmail not connected');
  $('sub').textContent=S.needs.length?(S.needs.length===1?'One thing needs you today.':['','','Two','Three','Four','Five'][S.needs.length]+' things need you today.')+' Everything else is tracked or already prepared, and nothing is sent without you.':'Nothing needs you right now. The hub keeps watching and nothing is sent without you.';
  $('needs').innerHTML=S.needs.length?S.needs.map((x,i)=>'<article class="need'+(i===S.sel?' on':'')+'" data-i="'+i+'" tabindex="0"><div class="row1"><span class="n">'+pad(i+1)+'</span><span class="chip '+x.chip[0]+'">'+esc(x.chip[1])+'</span></div><h3>'+esc(x.title)+'</h3><p>'+esc(x.text)+'</p><div class="acts">'+(x.btn[1]?'<a class="btn dark" href="'+esc(x.btn[1])+'">'+esc(x.btn[0])+'</a>':'<button class="btn dark" data-sel="'+i+'">'+esc(x.btn[0])+'</button>')+'<button class="btn" data-sel="'+i+'">See why →</button></div></article>').join(''):'<div class="empty">You\\'re all set. Nothing needs a decision right now.</div>';
  renderDay();renderWhy();
}
function renderDay(){
  $('cols').classList.toggle('line',S.view==='line');$('vList').setAttribute('aria-pressed',S.view==='list');$('vLine').setAttribute('aria-pressed',S.view==='line');
  const body=$('dayBody');
  if(!S.cal){body.innerHTML='<div class="empty">Loading your calendar…</div>';return;}
  if(!S.cal.connected||S.cal.error){body.innerHTML='<div class="empty">'+(S.cal.error==='expired'?'Your calendar connection expired. ':'No calendar connected yet. ')+'<a href="/'+WS+'#connect">Reconnect it</a> and today fills in here.</div>';return;}
  const timed=S.events.map(e=>({...e,s:tOf(e.start),e2:tOf(e.end),k:kind(e)})).filter(e=>e.s).sort((a,b)=>a.s-b.s);
  const allDay=S.events.filter(e=>!tOf(e.start));
  const cur=new Date();const nowH=cur.getHours()+cur.getMinutes()/60;
  const next=timed.find(e=>e.s>cur);
  const nowTxt='<div class="nowtxt"><b>Now '+clock(cur)+'</b> · '+(next?'Next: '+esc(next.title)+' at '+clock(next.s)+'.':'Nothing else on the calendar today.')+'</div>';
  const ad=allDay.length?'<div class="evs" style="margin:6px 0">'+allDay.map(e=>'<button type="button" class="ev '+kind(e)+'" data-ev="'+esc(e.id)+'"><div><b>'+esc(e.title)+'</b><small>All day · '+esc(e.calendar)+'</small></div><span class="k">'+KLAB[kind(e)].toUpperCase()+'</span></button>').join('')+'</div>':'';
  if(S.view==='line'){
    const start=8,end=18,span=end-start;
    const blocks=timed.filter(e=>e.s.getHours()<end&&(e.e2||e.s).getHours()>=start).map(e=>{const a=Math.max(start,e.s.getHours()+e.s.getMinutes()/60),b=Math.min(end,e.e2?e.e2.getHours()+e.e2.getMinutes()/60:a+.5);const l=(a-start)/span*100,w=Math.max((b-a)/span*100,9);
      return '<button type="button" class="blk '+(e.k==='mt'?'':e.k)+'" data-ev="'+esc(e.id)+'" style="left:'+l+'%;width:calc('+w+'% - 4px)" title="'+esc(e.title)+'"><span class="lab" style="font-size:9.5px">'+KLAB[e.k]+'</span><b>'+esc(e.title)+'</b><small>'+clock(e.s)+'</small></button>';}).join('');
    const nowL=nowH>=start&&nowH<=end?'<div class="nowbar" style="left:'+((nowH-start)/span*100)+'%"></div>':'';
    body.innerHTML=ad+'<div class="strip"><div class="ticks">'+Array.from({length:10},(_,i)=>{const hh=start+i;return '<span>'+(hh%12||12)+(hh<12?' AM':' PM')+'</span>'}).join('')+'</div><div class="lane">'+blocks+nowL+'</div></div>'+nowTxt;return;
  }
  let rows='';const hours=[];for(let hh=8;hh<=18;hh++)hours.push(hh);
  timed.forEach(e=>{const hh=e.s.getHours();if(hh<8&&!hours.includes(hh))hours.unshift(hh);if(hh>18&&!hours.includes(hh))hours.push(hh);});
  hours.sort((a,b)=>a-b).forEach(hh=>{
    const evs=timed.filter(e=>e.s.getHours()===hh);
    const isNow=cur.getHours()===hh;
    rows+='<div class="slot"><time>'+(hh%12||12)+':00 '+(hh<12?'AM':'PM')+'</time><div class="evs">'+(isNow?'<div class="nowline">NOW · '+clock(cur)+'</div>':'')+evs.map(e=>'<button type="button" class="ev '+(e.k==='mt'?'':e.k)+'" data-ev="'+esc(e.id)+'"><div><b>'+esc(e.title)+'</b><small>'+clock(e.s)+(e.e2?' – '+clock(e.e2):'')+' · '+esc(e.calendar)+'</small></div><span class="k">'+KLAB[e.k].toUpperCase()+'</span></button>').join('')+'</div></div>';
  });
  body.innerHTML=ad+'<div class="slots">'+rows+'</div>'+(timed.length||allDay.length?'':'<div class="empty" style="margin-top:8px">Nothing on your calendar today.</div>');
}
function renderWhy(){
  const x=S.needs[S.sel];const el=$('why');
  const act='<section><div class="colhead"><h2 style="font-size:17px">What the hub did today</h2><span class="lab">Activity</span></div><div class="act">'+(log.length?log.map(a=>'<div class="r"><time>'+clock(a.at)+'</time><div>'+esc(a.text)+'<span class="s">'+esc(a.state)+'</span></div></div>').join(''):'<div class="r"><time>–</time><div>Nothing yet.</div></div>')+'</div></section>';
  if(!x){el.innerHTML='<div class="safe"><i></i>Preparing and flagging happen automatically. Sending and approving stay with a person.</div>'+act;return;}
  let draft='';
  if(x.draft){const ready=S.mail&&S.mail.connected&&x.to.length;
    draft='<div class="draft"><div class="top"><span class="lab">Draft</span><span class="lab">✎ Not sent</span></div><label class="lab" for="draftTxt" style="text-transform:none;letter-spacing:0;font-family:Inter,sans-serif;font-size:13px">Each person gets their own name and timecard link.</label><textarea id="draftTxt">'+esc(S.drafts[x.draft])+'</textarea>'+
      (ready?'<button class="btn go" id="sendDraft">Send '+x.to.length+' reminder'+(x.to.length>1?'s':'')+' from my email</button>':'<small>'+(S.mail&&S.mail.connected?'Add an email for each person on the Timecards page to send from here.':'Sends from your own email once Gmail is connected.')+'</small>')+'</div>';}
  el.innerHTML='<div><div class="lab t">Why this is here · '+pad(S.sel+1)+'</div><h2>'+esc(x.title)+'</h2></div><p>'+esc(x.why)+'</p>'+
    '<div><h4>What the hub checked</h4><div class="checked">'+x.checked.map(c=>'<span>▢ '+esc(c)+'</span>').join('')+'</div></div>'+
    '<div class="ifyou"><div class="h">If you approve</div>'+x.ifyou.map(r=>'<div class="r"><span class="lab">'+esc(r[0])+'</span><div>'+esc(r[1])+'</div></div>').join('')+'</div>'+draft+
    '<div class="safe"><i></i>Preparing and flagging happen automatically. Sending and approving stay with a person.</div>'+act;
  const ta=$('draftTxt');if(ta)ta.oninput=()=>{S.drafts[x.draft]=ta.value;};
  const sb=$('sendDraft');if(sb)sb.onclick=()=>sendReminders(x,sb);
}
async function sendReminders(x,btn){
  if(btn.dataset.sure!=='1'){btn.dataset.sure='1';btn.textContent='Press again to send '+x.to.length+' email'+(x.to.length>1?'s':'');return;}
  btn.disabled=true;let ok=0,fail=0;
  for(const m of x.to){const text=S.drafts[x.draft].split('{first name}').join(first(m.name)).split('{link}').join(m.link||'').split('{owner}').join(first(OWNER));
    try{const r=await fetch('/api/gmail?action=send&ws='+encodeURIComponent(WS),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:m.email,subject:'Quick reminder: your hours for this week',body:text})});if(!r.ok)throw 0;ok++;}catch(e){fail++;}}
  did('Sent '+ok+' timecard reminder'+(ok===1?'':'s')+(fail?', '+fail+' failed':''),'sent by you');
  toast(ok?'Sent '+ok+' reminder'+(ok>1?'s':'')+' from '+S.mail.email+'.':'Nothing was sent. Try again.');render();
}
$('needs').addEventListener('click',e=>{const b=e.target.closest('[data-sel]');const card=e.target.closest('.need');if(e.target.closest('a'))return;const i=b?+b.dataset.sel:card?+card.dataset.i:null;if(i==null)return;S.sel=i;render();if(innerWidth<1250)$('why').scrollIntoView({behavior:'smooth'});});
$('needs').addEventListener('keydown',e=>{const c=e.target.closest('.need');if(c&&(e.key==='Enter'||e.key===' ')&&e.target===c){e.preventDefault();S.sel=+c.dataset.i;render();}});
function showEvent(id){const e=S.events.find(x=>x.id===id);if(!e)return;const s=tOf(e.start),e2=tOf(e.end);
  const whenTxt=s?(s.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})+' · '+clock(s)+(e2?' – '+clock(e2):'')):'All day';
  const d=document.createElement('div');d.className='evd';d.innerHTML='<div class="evc" role="dialog" aria-modal="true" aria-labelledby="evt"><div class="lab">'+KLAB[kind(e)]+' · '+esc(e.calendar)+'</div><h3 id="evt">'+esc(e.title)+'</h3><div class="r"><span>When</span><div>'+esc(whenTxt)+'</div></div>'+(e.location?'<div class="r"><span>Where</span><div>'+esc(e.location)+'</div></div>':'')+(e.who&&e.who.length?'<div class="r"><span>Who</span><div>'+esc(e.who.join(', '))+'</div></div>':'')+(e.notes?'<div class="r"><span>Notes</span><div style="white-space:pre-wrap">'+esc(e.notes)+'</div></div>':'')+'<div class="acts">'+(e.link?'<a class="btn dark" href="'+esc(e.link)+'" target="_blank" rel="noopener">Open in Google Calendar ↗</a>':'')+'<button class="btn" id="evClose">Close</button></div><div style="font-size:12.5px;color:var(--mute)">Reading only. The hub never changes your calendar.</div></div>';
  document.body.appendChild(d);const close=()=>d.remove();d.addEventListener('click',ev=>{if(ev.target===d)close();});d.querySelector('#evClose').onclick=close;d.querySelector('#evClose').focus();
  const key=ev=>{if(ev.key==='Escape'){close();document.removeEventListener('keydown',key);}};document.addEventListener('keydown',key);}
$('dayBody').addEventListener('click',e=>{const b=e.target.closest('[data-ev]');if(b)showEvent(b.dataset.ev);});
$('vList').onclick=()=>{S.view='list';try{localStorage.setItem('cuepa_dayview','list')}catch(e){}renderDay();};
$('vLine').onclick=()=>{S.view='line';try{localStorage.setItem('cuepa_dayview','line')}catch(e){}renderDay();};
$('resync').onclick=async()=>{await loadCal();render();toast('Calendar resynced.');};
Promise.all([loadCal(),loadTc(),loadMail()]).then(()=>{
  // Brand-new person: nothing connected and they haven't skipped onboarding → one card at a time at /<ws>/start.
  let skipped=false;try{skipped=localStorage.getItem('cuepa_start_'+WS)==='done'}catch(e){skipped=true}
  const calOk=S.cal&&S.cal.connected&&!S.cal.error, mailOk=S.mail&&S.mail.connected;
  if(!skipped&&!calOk&&!mailOk){location.replace('/'+WS+'/start');return;}
  render();
});
setInterval(()=>{if(!document.hidden)renderDay();},60000);
</script></body></html>`;
}
