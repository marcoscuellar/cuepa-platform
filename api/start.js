const workspaceUI = require('../lib/workspace-ui');
// /<ws>/start — onboarding, one card at a time. Each card does the real thing (connects Gmail, connects
// Calendar, adds the team) and the home page stays clean. Same sign-in rule as the hub. No sample data.
const { readSession, canSee } = require('./_session');
const WORKSPACES = require('../lib/workspaces');

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function go(res, to) { res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); }

module.exports = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const ws = u.searchParams.get('ws') || '';
  if (!/^[a-z0-9-]{1,60}$/.test(ws) || !WORKSPACES[ws]) { res.statusCode = 404; return res.end('Not found'); }
  let s = null; try { s = readSession(req); } catch (e) { s = null; }
  if (!canSee(s, ws)) return go(res, '/?next=/' + ws + '/start');
  if (s.temp) return go(res, '/?setpw=1&next=/' + ws + '/start');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(page(ws, WORKSPACES[ws].name, s.name || ''));
};

function page(ws, wsName, person) {
  const W = esc(ws), N = esc(wsName);
  return workspaceUI.apply(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>Let’s set up your hub · ${N} · CUEPA</title>
<script>try{if(localStorage.getItem("cuepa_look")==="dark")document.documentElement.dataset.look="dark"}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap">
<style>
:root{--bg:#f4f5f4;--card:#ffffff;--soft:#f3f4f3;--ink:#0a0a0a;--ink2:#3c4547;--mute:#6b7575;--line:#e4e7e6;--turq:#2dd4bf;--teal:#0b756a;--tbg:#e3f6f2;--amber:#9a5b00;--abg:#fdf1dc;--shadow:0 1px 2px rgba(10,10,10,.04),0 24px 60px rgba(10,10,10,.10);color-scheme:light}
:root[data-look="dark"]{--bg:#000000;--card:#121212;--soft:#1a1a1a;--ink:#ffffff;--ink2:#d6d6d6;--mute:#9a9a9a;--line:#242424;--turq:#2dd4bf;--teal:#5eead4;--tbg:rgba(45,212,191,.12);--amber:#e8a43c;--abg:rgba(232,164,60,.12);--shadow:0 1px 0 rgba(255,255,255,.04) inset,0 24px 60px rgba(0,0,0,.7);color-scheme:dark}
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{margin:0;background:var(--bg);color:var(--ink);min-height:100%}
body{font:15px/1.5 Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}button{font:inherit;cursor:pointer;color:inherit}
:focus-visible{outline:2px solid var(--turq);outline-offset:2px}
.lab{font:600 11px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.lab.t{color:var(--teal)}
.wrap{min-height:100vh;display:grid;grid-template-rows:auto 1fr auto}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px clamp(16px,4vw,40px)}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none}
.mark{display:inline-flex;gap:3px}.mark i{width:7px;height:18px;border-radius:2px;background:var(--ink);display:block}.mark i+i{background:var(--turq)}
.brand b{font-weight:700;letter-spacing:.12em;font-size:15px}
.brand span{color:var(--mute);font-size:14px;padding-left:12px;border-left:1px solid var(--line);margin-left:2px}
.look{background:var(--card);border:0;border-radius:999px;width:36px;height:36px;display:grid;place-items:center;box-shadow:0 1px 2px rgba(10,10,10,.06)}
.stage{display:grid;place-items:center;padding:12px clamp(16px,4vw,40px) 40px}
.card{width:min(560px,100%);background:var(--card);border-radius:24px;padding:clamp(24px,4vw,40px);box-shadow:var(--shadow);display:grid;gap:18px;animation:in .45s cubic-bezier(.2,.7,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.dots{display:flex;gap:6px}.dots i{width:8px;height:8px;border-radius:50%;background:var(--line);display:block}.dots i.on{background:var(--turq)}.dots i.done{background:var(--ink)}
h1{margin:0;font-size:clamp(28px,4vw,38px);font-weight:800;letter-spacing:-.035em;line-height:1.05}
h1 .dot{color:var(--turq)}
.lede{margin:0;color:var(--ink2);font-size:16.5px;line-height:1.55}
.state{display:flex;align-items:center;gap:10px;border-radius:14px;padding:14px 16px;background:var(--soft);font-size:14.5px}
.state i{width:9px;height:9px;border-radius:50%;background:var(--mute);display:block;flex:none}
.state.ok{background:var(--tbg);color:var(--teal)}.state.ok i{background:var(--turq)}
.state.warn{background:var(--abg);color:var(--amber)}.state.warn i{background:var(--amber)}
.state b{font-weight:600}
.fine{margin:0;color:var(--mute);font-size:13.5px;line-height:1.5}
.fine b{color:var(--ink2);font-weight:600}
.acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;background:var(--soft);border-radius:12px;padding:13px 18px;font-weight:600;font-size:15px;text-decoration:none;color:var(--ink)}
.btn:hover{background:var(--line)}
.btn.go{background:var(--turq);color:#04201d}.btn.go:hover{background:#5ee3d6}
.btn.dark{background:var(--ink);color:var(--bg)}.btn.dark:hover{background:var(--turq);color:#04201d}
.btn:disabled{opacity:.5;cursor:default}
.skip{margin-left:auto;background:none;border:0;color:var(--mute);font-size:14px;padding:8px 4px;text-decoration:underline;text-underline-offset:3px}
.skip:hover{color:var(--ink)}
.people{display:grid;gap:8px}
.person{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--soft);border-radius:12px;padding:10px 14px;font-size:14.5px}
.person small{color:var(--mute)}
.form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.form label{display:grid;gap:6px;font-size:12.5px;font-weight:600;color:var(--mute)}
.form input{font:inherit;font-size:15px;color:var(--ink);background:var(--soft);border:0;border-radius:12px;min-height:46px;padding:0 14px;width:100%}
.form input:focus{outline:2px solid var(--turq)}
.form .full{grid-column:1/-1}
.err{color:#b42318;font-size:14px;margin:0}
:root[data-look="dark"] .err{color:#ff9a85}
.foot{text-align:center;color:var(--mute);font-size:13px;padding:0 16px 28px}
.foot a{color:var(--mute)}
@media (max-width:520px){.form{grid-template-columns:1fr}.acts .btn{flex:1;justify-content:center}.skip{margin-left:0;width:100%;text-align:center}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<div class="wrap">
  <div class="top">
    <a class="brand" href="/${W}"><span class="mark" aria-hidden="true"><i></i><i></i></span><b>CUEPA</b><span>${N}</span></a>
    <button class="look" id="look" title="Switch light / dark" aria-label="Switch light or dark look">◐</button>
  </div>
  <div class="stage"><div class="card" id="card" role="region" aria-live="polite"><p class="lede">One moment…</p></div></div>
  <p class="foot">You always sign in on Google’s own page. CUEPA never sees your passwords. <a href="/privacy">Privacy</a></p>
</div>
<script>
const WS=${JSON.stringify(ws)}, OWNER=${JSON.stringify(String(person || ''))};
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const first=n=>String(n||'').split(' ')[0];
async function get(url){const r=await fetch(url,{credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||'Unavailable');e.status=r.status;throw e;}return j;}
async function post(url,body){const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Unavailable');return j;}
$('look').onclick=()=>{const dark=document.documentElement.dataset.look!=='dark';if(dark)document.documentElement.dataset.look='dark';else delete document.documentElement.dataset.look;try{localStorage.setItem('cuepa_look',dark?'dark':'light')}catch(e){}};

// Mark onboarding as in progress so Google's calendar callback comes back here (api/today.js checks this cookie).
function onboarding(on){document.cookie='cuepa_start='+(on?'1':'')+'; Path=/; Max-Age='+(on?1800:0)+'; SameSite=Lax; Secure';}
function finish(){try{localStorage.setItem('cuepa_start_'+WS,'done')}catch(e){}onboarding(false);location.replace('/'+WS);}

const q=new URLSearchParams(location.search);
const S={step:0,mail:null,cal:null,team:[],msg:null};
const STEPS=['Email','Calendar','Team','Done'];
// Which card to open: Google sends us back with ?connect= (Gmail) or ?google= (Calendar).
if(q.has('connect'))S.step=0; else if(q.has('google'))S.step=1;
if(q.get('connect')==='ok')S.msg=['ok','Gmail connected.'];
else if(q.get('connect')==='cancelled')S.msg=['warn','No problem, nothing was connected. You can try again or skip for now.'];
else if(q.get('connect')==='scopes')S.msg=['warn','Google needs both boxes checked (read and send). Try again and tick both.'];
else if(q.get('connect')==='failed')S.msg=['warn','Google didn’t finish the connection. Try again in a moment.'];
else if(q.get('connect')==='unavailable')S.msg=['warn','Email can’t be connected on this version of the hub. Use app.makingcuepa.com, or skip for now.'];
if(q.get('google')==='cancelled')S.msg=['warn','No problem, nothing was connected. You can try again or skip for now.'];
else if(q.get('google')==='failed')S.msg=['warn','Google didn’t finish the connection. Try again in a moment.'];
if(q.has('connect')||q.has('google'))history.replaceState(null,'',location.pathname);

async function load(){
  const [m,c,t]=await Promise.allSettled([get('/api/gmail?action=status&ws='+WS),get('/api/google?action=status&ws='+WS),get('/api/timecards?action=week&ws='+WS+'&week='+monday())]);
  S.mail=m.status==='fulfilled'?m.value:{connected:false};
  S.cal=c.status==='fulfilled'?c.value:{connected:false};
  S.team=t.status==='fulfilled'?(t.value.team||[]):[];
  // Just came back from Google Calendar: pick their main calendar so Today fills in right away.
  if(q.get('google')==='connected'&&S.cal.connected&&!(S.cal.selected||[]).length){
    try{const list=await get('/api/google?action=calendars&ws='+WS);const main=(list.calendars||[]).find(x=>x.primary)||(list.calendars||[])[0];
      if(main){await post('/api/google?action=select&ws='+WS,{ids:[main.id]});S.cal.selected=[main];}
      S.msg=['ok','Calendar connected. Your main calendar is on.'];
    }catch(e){S.msg=['ok','Calendar connected. Choose which calendars to show from Setup anytime.'];}
  }
  // First open with nothing to do on this card? Move ahead to the first unfinished one.
  if(!q.has('connect')&&!q.has('google')){if(S.mail.connected)S.step=1;if(S.mail.connected&&S.cal.connected)S.step=2;}
  render();
}
function monday(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
function dots(){return '<div class="dots" aria-hidden="true">'+STEPS.slice(0,3).map((_,k)=>'<i class="'+(k<S.step?'done':k===S.step?'on':'')+'"></i>').join('')+'</div>';}
function head(lab){return '<div class="head"><span class="lab t">'+esc(lab)+'</span>'+dots()+'</div>';}
function msg(){if(!S.msg)return '';const m=S.msg;S.msg=null;return '<div class="state '+m[0]+'"><i></i><span>'+esc(m[1])+'</span></div>';}

function render(){
  const c=$('card');const hi=first(OWNER)||'there';
  if(S.step===0){
    const ok=S.mail&&S.mail.connected;
    c.innerHTML=head('Step 1 of 3 · Email')+'<h1>Connect your Gmail<span class="dot">.</span></h1>'
      +'<p class="lede">So your inbox lives inside the hub and reminders go out from your own address. You read, you reply, you press send. Nothing is sent without you.</p>'
      +msg()
      +(ok?'<div class="state ok"><i></i><span>Connected as <b>'+esc(S.mail.email||'your Gmail')+'</b></span></div>':'')
      +'<p class="fine"><b>Heads up:</b> Google may say it hasn’t verified CUEPA yet while we finish their review. Click <b>Advanced</b>, then <b>Go to CUEPA</b>. Tick both boxes (read and send).</p>'
      +'<div class="acts">'+(ok?'<button class="btn go" data-a="next">Next: Calendar →</button><a class="btn" href="/api/gmail?action=start&ws='+WS+'&back=start">Use a different account</a>'
        :'<a class="btn go" href="/api/gmail?action=start&ws='+WS+'&back=start">Connect Gmail</a><button class="skip" data-a="next">Skip for now</button>')+'</div>';
  }else if(S.step===1){
    const ok=S.cal&&S.cal.connected;
    c.innerHTML=head('Step 2 of 3 · Calendar')+'<h1>Connect your calendar<span class="dot">.</span></h1>'
      +'<p class="lede">Your Today page builds itself from your calendar: classes, meetings, deadlines, all in one view. Read-only. The hub can’t add, change or delete anything.</p>'
      +msg()
      +(ok?'<div class="state ok"><i></i><span>Google Calendar connected'+((S.cal.selected||[]).length?' · '+(S.cal.selected||[]).length+' calendar'+((S.cal.selected||[]).length===1?'':'s')+' showing':'')+'</span></div>':'')
      +'<p class="fine"><b>Same heads up:</b> if Google says CUEPA isn’t verified yet, click <b>Advanced</b>, then <b>Go to CUEPA</b>.</p>'
      +'<div class="acts">'+(ok?'<button class="btn go" data-a="next">Next: Your team →</button><a class="btn" href="/'+WS+'/hub#connect">Choose calendars (classic hub)</a>'
        :'<a class="btn go" id="calGo" href="/api/google?action=start&ws='+WS+'">Connect Google Calendar</a><button class="skip" data-a="next">Skip for now</button>')
      +'</div>';
    const g=$('calGo');if(g)g.onclick=()=>onboarding(true);
  }else if(S.step===2){
    c.innerHTML=head('Step 3 of 3 · Your team')+'<h1>Who sends you hours<span class="dot">?</span></h1>'
      +'<p class="lede">Add the people who fill out timecards. Each one gets a private link to send their hours from their phone. No app, no password.</p>'
      +msg()
      +(S.team.length?'<div class="people">'+S.team.map(m=>'<div class="person"><span>'+esc(m.name)+'<small> · '+esc(m.role||'Team member')+'</small></span><small>Link ready</small></div>').join('')+'</div>':'')
      +'<form class="form" id="f"><label>Name<input name="name" placeholder="Sam Rivera" autocomplete="off" required></label><label>Role<input name="role" placeholder="Coach"></label>'
      +'<label>Email<input name="email" type="email" placeholder="sam@email.com"></label><label>Mobile<input name="phone" type="tel" placeholder="(555) 555-0123"></label>'
      +'<div class="full acts" style="margin:0"><button class="btn dark" type="submit">Add person</button></div></form><p class="err" id="err" hidden></p>'
      +'<p class="fine">Email or mobile is only used for timecard reminders you approve. You can add or change people anytime in Timecards.</p>'
      +'<div class="acts"><button class="btn go" data-a="next">'+(S.team.length?'Next →':'I’ll add people later →')+'</button></div>';
    $('f').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const b=Object.fromEntries(f.entries());const btn=e.target.querySelector('button');btn.disabled=true;$('err').hidden=true;
      try{const r=await post('/api/timecards?action=team-add',{ws:WS,...b});S.team.push(r.member);S.msg=['ok',r.member.name+' added. Their private link is ready in Timecards.'];render();}
      catch(x){$('err').textContent=x.message;$('err').hidden=false;btn.disabled=false;}};
  }else{
    const n=[S.mail&&S.mail.connected?'Gmail':null,S.cal&&S.cal.connected?'Calendar':null,S.team.length?S.team.length+' team member'+(S.team.length===1?'':'s'):null].filter(Boolean);
    c.innerHTML='<div class="head"><span class="lab t">All set</span></div><h1>You’re in, '+esc(hi)+'<span class="dot">.</span></h1>'
      +'<p class="lede">'+(n.length?'Connected: '+esc(n.join(', '))+'. ':'')+'Your Today page shows what needs you, your day in one view, and why each thing is there. Anything you skipped is waiting in Setup.</p>'
      +'<div class="acts"><button class="btn go" data-a="finish">Open my hub →</button>'+(n.length<3?'<button class="btn" data-a="later">Finish setup later</button>':'')+'</div>';
  }
  c.onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;if(b.dataset.a==='next'){S.step++;render();window.scrollTo({top:0,behavior:'smooth'});}else if(b.dataset.a==='finish')finish();else if(b.dataset.a==='later'){try{localStorage.setItem('cuepa_start_'+WS,'done')}catch(e){}onboarding(false);location.href='/'+WS;}};
}
load().catch(()=>render());
</script></body></html>`, ws, wsName, 'start');
}

