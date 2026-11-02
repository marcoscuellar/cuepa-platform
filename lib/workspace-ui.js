// Shared navigation and visual system for every authenticated workspace page.
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function header(ws, name, active) {
  const base = '/' + encodeURIComponent(ws);
  const links = [['today','Today',base+'/today'],['inbox','Inbox',base+'/inbox'],['calendar','Calendar',base+'/hub#calendar'],['timecards','Timecards',base+'/hub#timecards']];
  const more = [['vendors','Vendors'],['meetings','Meetings'],['connect','Connections'],['access','Access']];
  return '<header class="cuepa-header"><a class="cuepa-brand" href="'+base+'">CUEPA<span aria-hidden="true"></span><small>'+escape(name)+'</small></a><nav class="cuepa-nav" aria-label="Workspace">'+links.map(([id,label,url])=>'<a data-cuepa-view="'+id+'" href="'+url+'"'+(active===id?' aria-current="page"':'')+'>'+label+'</a>').join('')+'<details class="cuepa-more"><summary>More</summary><div>'+more.map(([id,label])=>'<a data-cuepa-view="'+id+'" href="'+(id==='connect'?base+'/start':base+'/hub#'+id)+'">'+label+'</a>').join('')+'<a href="'+base+'/start?tour=1">Take the tour</a><a href="/?setpw=1&next='+base+'">Change password</a><a href="/api/auth?action=logout">Sign out</a></div></details></nav></header>';
}
function apply(html, ws, name, active) {
  return html.replace('</head>', '<link rel="stylesheet" href="/assets/workspace.css"></head>')
    .replace(/<body([^>]*)>/, '<body$1 data-workspace-page="'+active+'">'+header(ws,name,active))
    .replace('</body>', '<div id="cuepa-ai" data-ws="'+escape(ws)+'"><section id="cuepa-ai-panel" aria-label="CUEPA assistant" hidden><header><div class="ai-title"><span class="ai-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M19.5 3.5v4.5H15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg></span><div><b>Ask CUEPA</b><span class="ai-sub">Think out loud. Bounce an idea.</span></div></div><button data-clear type="button">New chat</button><button data-close type="button">Minimize</button></header><small>AI can use this conversation. Email, calendar, and timecards are not shared automatically.</small><div role="log" aria-live="polite"></div><div class="ai-starts" data-starts><button type="button">Pressure-test an idea</button><button type="button">Plan my week</button><button type="button">Help me reply to someone</button></div><p role="status">Checking AI connection…</p><form><label for="cuepa-ai-input">Your message</label><textarea id="cuepa-ai-input" maxlength="6000" rows="3" required></textarea><button type="submit" disabled>Send</button></form></section><button data-toggle aria-expanded="false" aria-controls="cuepa-ai-panel" aria-label="Ask CUEPA"><span class="ai-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M19.5 3.5v4.5H15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg></span><span class="ai-txt">Ask CUEPA</span></button></div><script src="/assets/workspace-nav.js"></script><script src="/assets/assistant.js"></script></body>');
}
// One-time (and again after any policy change) notice. Sits over the page until the person agrees; nothing behind it can be clicked.
function policyNotice(html, pending, version) {
  if (!pending) return html;
  const v = escape(version);
  const css = '#cuepa-policy{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(10,18,20,.62);backdrop-filter:blur(6px);font:15px/1.5 Inter,"Helvetica Neue",Arial,sans-serif;color:#101516}'
    + '#cuepa-policy .pn{width:min(520px,100%);max-height:calc(100vh - 40px);overflow:auto;background:#fff;border-radius:24px;padding:clamp(24px,4vw,36px);box-shadow:0 1px 2px rgba(0,0,0,.04),0 24px 60px rgba(0,0,0,.25);display:grid;gap:16px}'
    + '#cuepa-policy .ey{font:600 11px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#0F766E;margin:0}'
    + '#cuepa-policy h2{margin:0;font-weight:800;letter-spacing:-.03em;font-size:26px;line-height:1.15}#cuepa-policy h2 i{color:#0F766E;font-style:normal}'
    + '#cuepa-policy p{margin:0;color:#3d4648}#cuepa-policy ul{margin:0;padding-left:20px;color:#3d4648;display:grid;gap:6px}'
    + '#cuepa-policy a{color:#0F766E;font-weight:600}#cuepa-policy label{display:flex;gap:10px;align-items:flex-start;font-weight:500;cursor:pointer}'
    + '#cuepa-policy input{width:20px;height:20px;margin-top:2px;accent-color:#0F766E;flex:none}'
    + '#cuepa-policy button{font:600 15px/1 Inter,Arial,sans-serif;border:0;border-radius:12px;height:48px;background:#0F766E;color:#fff;cursor:pointer}'
    + '#cuepa-policy button:disabled{opacity:.4;cursor:not-allowed}#cuepa-policy .er{color:#b42318;min-height:1em;font-size:14px}#cuepa-policy .so{text-align:center;font-size:13px}';
  const body = '<div id="cuepa-policy" role="dialog" aria-modal="true" aria-labelledby="cp-t"><div class="pn">'
    + '<p class="ey">Before you continue</p><h2 id="cp-t">We updated our Privacy Policy<i>.</i></h2>'
    + '<p>Please take a moment to read what changed, then confirm to keep using CUEPA.</p>'
    + '<ul><li>If you connect Gmail, CUEPA can read and organise your mail, and send only what you write and press Send on.</li>'
    + '<li>If you use the assistant, what you type into it is sent to Anthropic to get a reply.</li>'
    + '<li>We never sell your information or use it to train AI models.</li></ul>'
    + '<p><a href="/privacy" target="_blank" rel="noopener">Read the Privacy Policy</a> &nbsp;·&nbsp; <a href="/terms" target="_blank" rel="noopener">Read the Terms of Use</a></p>'
    + '<label><input type="checkbox" id="cp-ck"><span>I have read and agree to the Privacy Policy and Terms of Use.</span></label>'
    + '<button type="button" id="cp-go" disabled>Agree and continue</button><div class="er" id="cp-er" role="alert"></div>'
    + '<p class="so"><a href="/api/auth?action=logout">Sign out instead</a></p></div></div>'
    + '<script>(function(){var d=document,ck=d.getElementById("cp-ck"),go=d.getElementById("cp-go"),er=d.getElementById("cp-er"),box=d.getElementById("cuepa-policy");'
    + 'd.documentElement.style.overflow="hidden";ck.addEventListener("change",function(){go.disabled=!ck.checked});'
    + 'go.addEventListener("click",function(){go.disabled=true;er.textContent="";fetch("/api/auth?action=policy",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:"' + v + '"})})'
    + '.then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok||!j.ok)throw new Error(j.error||"Could not save. Try again.");box.remove();d.documentElement.style.overflow=""})})'
    + '.catch(function(e){er.textContent=e.message;go.disabled=false})});go.focus&&ck.focus();})();</script>';
  return html.replace('</body>', '<style>' + css + '</style>' + body + '</body>');
}
module.exports = {header,apply,policyNotice};
