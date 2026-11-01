// Shared navigation and visual system for every authenticated workspace page.
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function header(ws, name, active) {
  const base = '/' + encodeURIComponent(ws);
  const links = [['today','Today',base+'/today'],['inbox','Inbox',base+'/inbox'],['calendar','Calendar',base+'/hub#calendar'],['timecards','Timecards',base+'/hub#timecards']];
  const more = [['vendors','Vendors'],['meetings','Meetings'],['connect','Connections'],['access','Access']];
  return '<header class="cuepa-header"><a class="cuepa-brand" href="'+base+'">CUEPA<span aria-hidden="true"></span><small>'+escape(name)+'</small></a><nav class="cuepa-nav" aria-label="Workspace">'+links.map(([id,label,url])=>'<a data-cuepa-view="'+id+'" href="'+url+'"'+(active===id?' aria-current="page"':'')+'>'+label+'</a>').join('')+'<details class="cuepa-more"><summary>More</summary><div>'+more.map(([id,label])=>'<a data-cuepa-view="'+id+'" href="'+base+'/hub#'+id+'">'+label+'</a>').join('')+'<a href="'+base+'/start">Getting started</a><a href="/?setpw=1&next='+base+'">Change password</a><a href="/api/auth?action=logout">Sign out</a></div></details></nav></header>';
}
function apply(html, ws, name, active) {
  return html.replace('</head>', '<link rel="stylesheet" href="/assets/workspace.css"></head>')
    .replace(/<body([^>]*)>/, '<body$1 data-workspace-page="'+active+'">'+header(ws,name,active))
    .replace('</body>', '<div id="cuepa-ai" data-ws="'+escape(ws)+'"><section id="cuepa-ai-panel" aria-label="CUEPA assistant" hidden><header><b>Ask CUEPA</b><button data-clear type="button">New chat</button><button data-close type="button">Minimize</button></header><small>AI can use this conversation. Email, calendar, and timecards are not shared automatically.</small><div role="log" aria-live="polite"></div><p role="status">Checking AI connection…</p><form><label for="cuepa-ai-input">Your message</label><textarea id="cuepa-ai-input" maxlength="6000" rows="3" required></textarea><button type="submit" disabled>Send</button></form></section><button data-toggle aria-expanded="false" aria-controls="cuepa-ai-panel">Ask CUEPA</button></div><script src="/assets/workspace-nav.js"></script><script src="/assets/assistant.js"></script></body>');
}
module.exports = {header,apply};
