/* The Room for Cirques Experience — the layout Christian approved, filled from the platform's live sources:
   /api/gmail (parent & instructor email), /api/google (calendar), /api/timecards (instructor hours).
   Rule: no made-up numbers. Not connected = says so and shows "—", never zero.
   Enrollment and scholarships come with the new website, so they say "Next up" until then. */
(function () {
  'use strict';
  var WS = document.body.dataset.ws;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var clock = function (d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase(); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  var fromName = function (f) { return String(f || '').replace(/<.*>/, '').replace(/"/g, '').trim() || String(f || ''); };
  function mondayOf(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function get(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Unavailable'); e.status = r.status; throw e; } return j; });
    });
  }
  var NOW = new Date(), WEEK0 = mondayOf(NOW);
  var S = { mail: null, inbox: [], labels: [], cal: null, events: [], tc: null, log: [], day: (NOW.getDay() + 6) % 7, open: null };
  function did(at, area, text) { S.log.push({ at: at, area: area, text: text }); }

  /* ---- data ---- */
  function loadMail() {
    return get('/api/gmail?action=status&ws=' + WS).then(function (st) {
      S.mail = { connected: !!st.connected };
      if (!st.connected) return;
      var labels = get('/api/gmail?action=labels&ws=' + WS).then(function (r) { S.labels = r.labels || []; if (window.CuepaFolders) window.CuepaFolders.assign(S.labels); }).catch(function () { S.labels = []; });
      return Promise.all([labels, get('/api/gmail?action=list&ws=' + WS)]).then(function (all) { var r = all[1];
        S.inbox = r.messages || []; S.mail.at = new Date();
        did(S.mail.at, 'Comms', 'inbox checked, ' + plural(S.inbox.filter(function (m) { return m.unread; }).length, 'unread email'));
      });
    }).catch(function (e) { S.mail = { connected: false, error: e.status === 503 ? 'unavailable' : 'problem' }; });
  }
  function startOf(e) { return e.start && e.start.dateTime ? new Date(e.start.dateTime) : (e.start && e.start.date ? new Date(e.start.date + 'T00:00') : null); }
  function loadCal() {
    return get('/api/google?action=status&ws=' + WS).then(function (st) {
      S.cal = { connected: !!st.connected, selected: (st.selected || []).length };
      if (!st.connected || !S.cal.selected) return;
      var end = new Date(WEEK0); end.setDate(end.getDate() + 7);
      return get('/api/google?' + new URLSearchParams({ action: 'events', ws: WS, start: WEEK0.toISOString(), end: end.toISOString() })).then(function (r) {
        S.events = (r.events || []).filter(startOf).sort(function (a, b) { return startOf(a) - startOf(b); }); S.cal.at = new Date();
        did(S.cal.at, 'Events', 'calendar synced, ' + plural(S.events.length, 'event') + ' this week');
      });
    }).catch(function (e) { S.cal = { connected: false, error: e.status === 503 ? 'unavailable' : 'problem' }; });
  }
  function loadTc() {
    return get('/api/timecards?' + new URLSearchParams({ action: 'week', ws: WS, week: ymd(WEEK0) })).then(function (r) {
      var cards = r.cards || {};
      var card = function (m) { return cards[m.id] || { status: 'notin' }; };
      var team = r.team || [];
      S.tc = { at: new Date(), team: team, card: card,
        sent: team.filter(function (m) { return card(m).status === 'sent'; }),
        approved: team.filter(function (m) { return card(m).status === 'approved'; }),
        late: team.filter(function (m) { return ['notin', 'fix'].indexOf(card(m).status) >= 0; }) };
      team.forEach(function (m) { var c = card(m); if (c.submittedAt && new Date(c.submittedAt) >= WEEK0) did(new Date(c.submittedAt), 'Payroll', esc(m.name) + ' sent ' + (c.hours || 0) + ' hours'); });
      did(S.tc.at, 'Payroll', 'timecards checked for this week');
    }).catch(function () { S.tc = { error: true, team: [], sent: [], approved: [], late: [] }; });
  }

  /* ---- render ---- */
  var ago = function (d) { if (!d) return ''; var m = Math.round((Date.now() - d) / 60000); return m < 1 ? 'Updated just now' : 'Updated ' + m + 'm ago'; };
  var mailOn = function () { return S.mail && S.mail.connected; };
  var calOn = function () { return S.cal && S.cal.connected && S.cal.selected > 0; };
  var tcOn = function () { return S.tc && !S.tc.error; };
  function needs() {
    var n = [];
    if (tcOn()) S.tc.sent.forEach(function (m) { n.push({ kind: 'Timecard', text: esc(m.name) + ' sent ' + (S.tc.card(m).hours || 0) + ' hours for this week. Ready for your review.', go: ['Review & approve', '/' + WS + '/hub#timecards'], alt: ['Open timecards', '/' + WS + '/hub#timecards'] }); });
    if (!mailOn()) n.push({ kind: 'Connection', text: S.mail && S.mail.error ? 'Gmail needs a quick reconnect before your emails can show here.' : 'Connect Gmail so parent and instructor emails show up in your Room.', go: ['Connect Gmail', '/' + WS + '/start'] });
    if (!calOn()) n.push({ kind: 'Connection', text: S.cal && S.cal.connected ? 'Pick which calendars belong in your Room.' : 'Connect Google Calendar so classes, events and meetings show here.', go: [S.cal && S.cal.connected ? 'Pick calendars' : 'Connect Calendar', '/' + WS + '/start'] });
    return n;
  }
  function metric(v, label, trend, on, warn) {
    return '<div class="metric"><div class="mv' + (on ? '' : ' off') + '">' + v + '</div><div class="ml">' + label + '</div>' + (trend ? '<div class="mtrend' + (warn ? ' wait' : '') + '">' + trend + '</div>' : '') + '</div>';
  }
  function proc(sw, name, badge, badgeKind, desc, pct, footL, footR) {
    return '<article class="proc"><div class="proc-top"><div class="proc-name"><span class="swatch ' + sw + '"></span>' + name + '</div><div class="proc-badge ' + (badgeKind || '') + '">' + badge + '</div></div>'
      + '<p class="proc-desc">' + desc + '</p><div class="proc-bar-wrap"><div class="proc-bar" style="width:' + Math.max(0, Math.min(100, pct || 0)) + '%"></div></div>'
      + '<div class="proc-foot"><span>' + footL + '</span><span>' + footR + '</span></div></article>';
  }
  var connect = function (what) { return '<a href="/' + WS + '/start">Connect ' + what + ' →</a>'; };

  /* inbox list: newest emails, folder colors, click opens it in Inbox */
  var whenOf = function (d) { var t = new Date(d); if (isNaN(t)) return ''; return t.toDateString() === NOW.toDateString() ? clock(t) : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  function renderInbox() {
    if (!mailOn()) { $('inbox').innerHTML = '<p class="empty-note">' + (S.mail && S.mail.error ? 'Gmail needs a quick reconnect.' : 'Gmail isn’t connected yet.') + ' <a class="see" href="/' + WS + '/start">Connect Gmail →</a></p>'; return; }
    if (!S.inbox.length) { $('inbox').innerHTML = '<p class="empty-note">Your inbox is clear.</p>'; return; }
    var F = window.CuepaFolders;
    $('inbox').innerHTML = S.inbox.slice(0, 7).map(function (m) {
      var folders = F ? F.foldersOf(m, S.labels) : [];
      var name = fromName(m.from);
      return '<a class="mail' + (m.unread ? ' unread' : '') + '" href="/' + WS + '/inbox?open=' + encodeURIComponent(m.id || '') + '">'
        + '<span class="av"' + (F && folders[0] ? F.avatarStyle(folders[0]) : '') + ' aria-hidden="true">' + esc((name.replace(/^[^A-Za-z0-9]+/, '')[0] || '·').toUpperCase()) + '</span>'
        + '<div><div class="who">' + esc(name) + '</div><div class="subj">' + esc(m.subject || '(no subject)') + '</div>' + (m.snippet ? '<div class="snip">' + esc(m.snippet) + '</div>' : '')
        + (folders.length && F ? '<div class="chips">' + folders.map(F.chip).join('') + '</div>' : '') + '</div>'
        + '<span class="when">' + esc(whenOf(m.date)) + '</span></a>';
    }).join('');
  }
  /* week: pick a day, open any event for details */
  function dayIdx(e) { var s = startOf(e); return Math.floor((new Date(ymd(s) + 'T12:00') - WEEK0) / 864e5); }
  function renderWeek() {
    if (!calOn()) { $('days').innerHTML = ''; $('agenda').innerHTML = '<p class="empty-note">' + (S.cal && S.cal.connected ? 'Pick which calendars to show.' : 'Google Calendar isn’t connected yet.') + ' <a class="see" href="/' + WS + '/start">' + (S.cal && S.cal.connected ? 'Pick calendars' : 'Connect Calendar') + ' →</a></p>'; return; }
    var today = (NOW.getDay() + 6) % 7, html = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(WEEK0); d.setDate(d.getDate() + i);
      var n = S.events.filter(function (e) { return dayIdx(e) === i; }).length;
      html += '<button type="button" data-day="' + i + '" aria-pressed="' + (i === S.day) + '" class="' + (i === today ? 'today' : '') + '" aria-label="' + esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + ', ' + plural(n, 'item') + '">' + esc(d.toLocaleDateString(undefined, { weekday: 'short' })) + '<b>' + d.getDate() + '</b><span class="n">' + new Array(Math.min(n, 3) + 1).join('<i></i>') + '</span></button>';
    }
    $('days').innerHTML = html;
    var list = S.events.filter(function (e) { return dayIdx(e) === S.day; });
    $('agenda').innerHTML = list.length ? list.map(function (e, k) {
      var s = startOf(e), allDay = !(e.start && e.start.dateTime), id = S.day + ':' + k, open = S.open === id;
      var more = [];
      if (e.location) more.push('📍 ' + esc(e.location));
      if (e.who && e.who.length) more.push('👥 ' + esc(e.who.join(', ')));
      if (e.notes) more.push(esc(e.notes));
      if (e.link) more.push('<a href="' + esc(e.link) + '" target="_blank" rel="noopener">Open in Google Calendar →</a>');
      return '<div class="ev"><button type="button" data-ev="' + id + '" aria-expanded="' + open + '"><span class="t">' + (allDay ? 'All day' : esc(clock(s))) + '</span><span class="ti"><i' + (e.color ? ' style="background:' + esc(e.color) + '"' : '') + '></i><span>' + esc(e.title || 'Untitled') + '</span></span><span class="chev" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></button>'
        + (open ? '<div class="more">' + (more.length ? more.join('<br>') : 'No other details.') + '</div>' : '') + '</div>';
    }).join('') : '<p class="empty-note">Nothing on the calendar this day.</p>';
  }
  $('days').addEventListener('click', function (ev) { var b = ev.target.closest('[data-day]'); if (!b) return; S.day = +b.dataset.day; S.open = null; renderWeek(); });
  $('agenda').addEventListener('click', function (ev) { if (ev.target.closest('a')) return; var b = ev.target.closest('[data-ev]'); if (!b) return; S.open = S.open === b.dataset.ev ? null : b.dataset.ev; renderWeek(); var nb = document.querySelector('[data-ev="' + b.dataset.ev + '"]'); if (nb) nb.focus(); });

  function render() {
    var unread = S.inbox.filter(function (m) { return m.unread; });
    var upcoming = S.events.filter(function (e) { return startOf(e) >= NOW; });
    var past = S.events.length - upcoming.length;
    var todays = S.events.filter(function (e) { return startOf(e).toDateString() === NOW.toDateString(); });
    var N = needs();

    /* status pill */
    var on = [mailOn(), calOn(), tcOn()].filter(Boolean).length;
    $('sync').className = 'room-status' + (on === 3 ? '' : ' wait');
    $('syncText').textContent = on === 3 ? 'All systems synced · ' + clock(new Date()) : on + ' of 3 connected';

    /* room question */
    var bits = [];
    if (calOn()) bits.push(plural(todays.length, 'thing') + ' on the calendar today');
    if (mailOn()) bits.push(plural(unread.length, 'unread email'));
    bits.push(N.length ? plural(N.length, 'item') + ' waiting on you' : 'nothing waiting on you');
    $('rqLine').textContent = 'Right now: ' + bits.join(', ') + '. Where should your time go next?';

    /* metrics */
    $('metrics').innerHTML =
      metric(mailOn() ? unread.length : '—', 'Unread emails in your inbox', mailOn() ? (S.inbox.length - unread.length) + ' of ' + S.inbox.length + ' recent emails read' : 'Waiting for Gmail', mailOn(), !mailOn())
      + metric(calOn() ? S.events.length : '—', 'Classes, events and meetings this week', calOn() ? (upcoming.length ? upcoming.length + ' still ahead' : 'All done for the week') : 'Waiting for Calendar', calOn(), !calOn())
      + metric(tcOn() && S.tc.team.length ? (S.tc.team.length - S.tc.late.length) + ' <span class="arrow">/</span> ' + S.tc.team.length : '—', 'Instructor timecards in this week', tcOn() ? (S.tc.team.length ? S.tc.approved.length + ' approved' : 'Add your team in Timecards') : 'Timecards unavailable', tcOn() && S.tc.team.length, !(tcOn() && S.tc.team.length))
      + metric(N.length, 'Items waiting on you', N.length ? 'Listed under Waiting on you' : 'You’re all caught up', true, N.length > 0);

    /* processes */
    var newest = S.inbox[0];
    var html = '';
    html += proc('sw-1', 'Enrollment &amp; wait-lists', 'Next up', 'next', 'Comes with your new website: class sign-up, wait-lists and paperwork in one place. Open spots and new families will show here.', 0, 'Planned with the website build', '');
    html += proc('sw-2', 'Scholarships &amp; CPS partnerships', 'Next up', 'next', 'Renewals and partner paperwork will be prepared here for your review. Nothing goes out without your sign-off.', 0, 'Planned with the website build', '');
    html += mailOn()
      ? proc('sw-3', 'Parent &amp; instructor comms', 'Running', '', S.inbox.length ? plural(unread.length, 'unread email') + ' in your inbox.' + (newest ? ' Newest from ' + esc(fromName(newest.from)) + (newest.subject ? ': “' + esc(newest.subject) + '”' : '') + '.' : '') : 'Your inbox is clear.', S.inbox.length ? (S.inbox.length - unread.length) / S.inbox.length * 100 : 100, (S.inbox.length - unread.length) + ' of ' + S.inbox.length + ' recent emails read', ago(S.mail.at))
      : proc('sw-3', 'Parent &amp; instructor comms', S.mail && S.mail.error ? 'Needs a look' : 'Not connected', 'wait', 'Connect Gmail and your parent and instructor emails show up here, sorted by your folders.', 0, connect('Gmail'), '');
    if (tcOn()) {
      var t = S.tc, inCount = t.team.length - t.late.length;
      html += proc('sw-4', 'Instructor scheduling &amp; payroll', t.team.length ? 'Running' : 'Set up', t.team.length ? '' : 'wait', t.team.length ? inCount + ' of ' + plural(t.team.length, 'timecard') + ' in for this week. ' + (t.sent.length ? (t.sent.length === 1 ? '1 is' : t.sent.length + ' are') + ' waiting for your approval.' : 'Nothing waiting for approval.') + (t.late.length ? ' Not in yet: ' + t.late.map(function (m) { return esc(m.name); }).join(', ') + '.' : '') : 'Add your instructors in Timecards. They send hours from their phone, you approve, payroll gets the export.', t.team.length ? inCount / t.team.length * 100 : 0, plural(t.team.length, 'instructor') + ' tracked', ago(t.at));
    } else html += proc('sw-4', 'Instructor scheduling &amp; payroll', 'Needs a look', 'wait', 'Timecards couldn’t be checked just now. Try again in a minute.', 0, '', '');
    var next = upcoming[0];
    html += calOn()
      ? proc('sw-5', 'Events, vendors, venues &amp; social', 'Running', '', S.events.length ? plural(S.events.length, 'item') + ' on the calendar this week.' + (next ? ' Next: ' + esc(next.title || 'Untitled') + ', ' + esc(startOf(next).toLocaleDateString(undefined, { weekday: 'short' })) + ' ' + esc(clock(startOf(next))) + '.' : ' Nothing left this week.') : 'Nothing on the calendar this week.', S.events.length ? past / S.events.length * 100 : 0, past + ' of ' + S.events.length + ' done this week', ago(S.cal.at))
      : proc('sw-5', 'Events, vendors, venues &amp; social', S.cal && S.cal.error ? 'Needs a look' : 'Not connected', 'wait', 'Connect Google Calendar and your classes, events, parties and vendor meetings show up here.', 0, connect('Calendar'), '');
    $('procs').innerHTML = html;

    /* approvals */
    $('waitCount').hidden = !N.length; $('waitCount').textContent = N.length;
    $('approvals').innerHTML = N.length ? N.map(function (x) {
      return '<div class="approval"><div class="a-kind">' + x.kind + '</div><div class="a-text">' + x.text + '</div><div class="a-actions"><a class="btn-approve" href="' + x.go[1] + '">' + x.go[0] + '</a>' + (x.alt ? '<a class="btn-decline" href="' + x.alt[1] + '">' + x.alt[0] + '</a>' : '') + '</div></div>';
    }).join('') : '<p class="empty-note">Nothing is waiting on you right now.</p>';

    renderInbox(); renderWeek();

    /* activity */
    var log = S.log.slice().sort(function (a, b) { return b.at - a.at; }).slice(0, 6);
    $('activity').innerHTML = log.length ? log.map(function (l) { return '<div class="log-item"><span class="lt">' + esc(clock(l.at)) + '</span><span class="lc"><b>' + l.area + '</b> — ' + l.text + '</span></div>'; }).join('') : '<p class="empty-note">Activity shows here once your tools are connected.</p>';
  }

  /* trust & controls: shown so the team can see what runs on its own. Today nothing does. */
  $('trust').innerHTML = [
    ['Auto-fill wait-lists', 'Off. Comes with the new website, and only if you turn it on'],
    ['Auto-answer parent emails', 'Off. Every reply waits for you'],
    ['Auto-send scholarship packets', 'Off. Always held for leadership review'],
    ['Auto-post to social', 'Off. Every post waits for approval']
  ].map(function (r) { return '<div class="toggle-row"><div><div class="tt">' + r[0] + '</div><div class="td">' + r[1] + '</div></div><button class="rswitch" type="button" role="switch" aria-checked="false" aria-label="' + r[0] + '" disabled></button></div>'; }).join('');

  $('tell').onclick = function () { var b = document.querySelector('#cuepa-ai [data-toggle]'); if (b) { if (b.getAttribute('aria-expanded') !== 'true') b.click(); var t = document.getElementById('cuepa-ai-input'); if (t) t.focus(); } };

  function refresh() { S.log = []; return Promise.all([loadMail(), loadCal(), loadTc()]).then(render); }
  refresh(); setInterval(refresh, 15 * 60 * 1000);
})();
