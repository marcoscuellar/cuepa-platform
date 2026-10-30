// Serves a client's hub only to someone signed in to that workspace.
const fs = require("fs");
const path = require("path");
const { readSession, canSee } = require("./_session");

// Each workspace: display name + which hub template it uses.
// "new-client" is a client-free workspace that starts empty, exactly like a brand-new client's.
const WORKSPACES = require('../lib/workspaces');

function esc(s) { return String(s || "").replace(/[&<>"'`$\\{}]/g, ""); }
function initials(name) { return esc(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?"; }
function go(res, to) { res.statusCode = 302; res.setHeader("Location", to); res.setHeader("Cache-Control", "no-store"); res.end(); }
function all(s, a, b) { return s.split(a).join(b); }
// Exact-text patch. If the template changes and the text is gone, the hub still loads unpatched.
function patch(s, a, b) { return s.includes(a) ? s.replace(a, () => b) : s; }

// Email setup: Gmail now connects for real on /<ws>/inbox instead of emailing CUEPA a request.
const GMAIL = '(c.id==="email"&&provider==="Google")';
const NOTE_OLD = '<div class="hub-warnnote">Your live hub is still being set up, so this won\'t sign you in yet. Save your choice and we\'ll connect ${tool} with you.</div>';
const NOTE_NEW = '${' + GMAIL + '?html`<div class="hub-warnnote" style=${{background:"var(--h-teal-soft)",borderColor:"var(--h-teal-line)",color:"var(--h-teal)"}}>Gmail is ready. The next page opens Google so you can connect your inbox.</div>`:html`' + NOTE_OLD + '`}';
const BTN_OLD = 'onClick=${()=>c.id==="calendar"?setStep("cals"):finishSelf()}>${c.id==="calendar"?"Next: choose calendars":"Save my choice"}</button>';
const BTN_NEW = 'onClick=${()=>c.id==="calendar"?setStep("cals"):' + GMAIL + '?location.assign("/"+(window.CUEPA_CONTEXT?.ws||"")+"/inbox"):finishSelf()}>${c.id==="calendar"?"Next: choose calendars":' + GMAIL + '?"Connect Gmail →":"Save my choice"}</button>';

module.exports = (req, res) => {
  const ws = new URL(req.url, "http://x").searchParams.get("ws") || "";
  const conf = WORKSPACES[ws];
  if (!/^[a-z0-9-]{1,60}$/.test(ws) || !conf) { res.statusCode = 404; return res.end("Not found"); }
  const file = path.join(process.cwd(), "_app", conf.file + ".html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }

  let session = null;
  try { session = readSession(req); } catch (e) { session = null; }
  if (!canSee(session, ws)) return go(res, "/?next=/" + ws);
  if (session.temp) return go(res, "/?setpw=1&next=/" + ws); // first visit: make your own password

  const contact = esc(process.env.CUEPA_CONTACT || "marcos@ollinos.com");
  const name = esc(session.name);
  let html = fs.readFileSync(file, "utf8")
    .replace('const CUEPA_EMAIL="marcos@ollinos.com";', `const CUEPA_EMAIL="${contact}";`)
    .replace('<button class="hub-link" onClick=${()=>up(n=>{n.signedIn=false})}>Sign out</button>',
             `<a class="hub-link" href="/?setpw=1&next=/${ws}">Change password</a><a class="hub-link" href="/api/auth?action=logout">Sign out</a>`)
    .replace("if(!s.signedIn) return", "if(false) return")
    .replace('<b style=${{color:"#101516"}}>Christian Ochsner</b>', `<b style=\${{color:"#101516"}}>${name}</b>`)
    .replace('aria-hidden="true">CO</span>', `aria-hidden="true">${initials(session.name)}</span>`);
  html = patch(html, NOTE_OLD, NOTE_NEW);
  html = patch(html, BTN_OLD, BTN_NEW);

  if (conf.blank) {
    const first = name.split(" ")[0] || "You";
    html = all(html, "Cirques Experience", conf.name);
    html = all(html, "Cirques hub", conf.name + " hub");
    html = all(html, "Preview with sample data.", "");
    html = all(html, 'const KEY="cirques-hub-v4"', 'const KEY="' + ws + '-hub-v1"');
    html = all(html, "Christian Ochsner", name);
    html = all(html, 'owner="Christian"', 'owner="' + first + '"');
    html = all(html, "cirquesexperience.org", "yourbusiness.com");
    html = html.replace("<script>\nconst {useState", `<script>window.CUEPA_BLANK=true;window.CUEPA_OWNER="${name}";</script>\n<script>\nconst {useState`);
  }

  const context = JSON.stringify({ws, userKey: require('crypto').createHash('sha256').update(session.email.toLowerCase()).digest('hex')}).replace(/</g, '\\u003c');
  html = html.replace('<script>\nconst {useState', `<script>window.CUEPA_CONTEXT=${context};window.CUEPA_OWNER_NAME=${JSON.stringify(session.name||'').replace(/</g,'\\u003c')};</script>\n<script>\nconst {useState`);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end(html);
};
