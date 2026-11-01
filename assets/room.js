/* The Room — live data from /api/google, /api/timecards and /api/gmail.
   Rule: no made-up numbers. If something isn't connected, it says so; it never shows zero for unknown. */
(function () {
  'use strict';
  var model = window.CuepaRoomModel;
  var WS = document.body.dataset.ws, OWNER = document.body.dataset.owner || '';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var first = function (n) { return String(n || '').trim().split(/\s+/)[0]; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var clock = function (d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  var fromName = function (f) { return String(f || '').replace(/<.*>/, '').replace(/"/g, '').trim() || String(f || ''); };
  function mondayOf(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function get(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Unavailable'); e.status = r.status; throw e; } return j; });
    });
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  var initialOf = function (f) { var n = fromName(f).replace(/^[^A-Za-z0-9\u00C0-\u00FF]+/, ''); return (n[0] || '·').toUpperCase(); };
  var whenOf = function (d) { var t = new Date(d); if (isNaN(t)) return ''; return t.toDateString() === new Date().toDateString() ? clock(t) : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  var addrOf = function (f) { var m = String(f || '').match(/<([^>]+)>/); return m ? m[1] : String(f || '').trim(); };
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 4200); }
  var log = []; function did(text) { log.unshift({ at: new Date(), text: text }); }

  var S = { cal: null, events: [], tc: null, mail: null, inbox: [], needs: [], pick: null, panel: 'inbox', mailOpen: -1, bodies: {}, full: {}, day: null, drafts: {}, updated: null, meeting: null, notes: {}, followups: [], assistantMode: 'day' };
  var NOW = new Date(), WEEK0 = mondayOf(NOW), TODAY_I = (NOW.getDay() + 6) % 7;

  /* look + greeting */
  $('look').onclick = function () {
    var dark = document.documentElement.dataset.look !== 'dark';
    if (dark) document.documentElement.dataset.look = 'dark'; else delete document.documentElement.dataset.look;
    try { localStorage.setItem('cuepa_look', dark ? 'dark' : 'light'); } catch (e) {}
  };
  var h = NOW.getHours();
  function tickClock() { var d = new Date(); $('date').innerHTML = esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) + '<span class="roomtime"> · ' + esc(clock(d)) + '</span>'; }
  tickClock(); setInterval(tickClock, 20000);
  $('hi').innerHTML = esc(h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,') + '<b>' + esc((first(OWNER) || 'there') + '.') + '</b>';

  /* data */
  function loadCal() {
    return get('/api/google?action=status&ws=' + WS).then(function (st) {
      S.cal = { connected: st.connected, selected: (st.selected || []).length };
      if (!st.connected || !S.cal.selected) { S.events = []; return; }
      var end = new Date(WEEK0); end.setDate(end.getDate() + 7);
      return get('/api/google?' + new URLSearchParams({ action: 'events', ws: WS, start: WEEK0.toISOString(), end: end.toISOString() })).then(function (r) {
        S.events = r.events || []; did('Calendar synced, ' + plural(S.events.length, 'event') + ' this week');
      });
    }).catch(function (e) { S.cal = { connected: S.cal ? S.cal.connected : false, error: e.status === 503 ? 'unavailable' : (e.status === 401 || e.status === 400 || e.status === 409) ? 'expired' : 'down' }; S.events = []; });
  }
  function loadTc() {
    return get('/api/timecards?' + new URLSearchParams({ action: 'week', ws: WS, week: ymd(WEEK0) })).then(function (r) {
      var card = function (id) { return r.cards[id] || { status: 'notin' }; };
      S.tc = { team: r.team, days: r.days,
        sent: r.team.filter(function (m) { return card(m.id).status === 'sent'; }),
        late: r.team.filter(function (m) { return ['notin', 'fix'].indexOf(card(m.id).status) >= 0; }) };
      did('Timecards checked for this week');
    }).catch(function (e) { S.tc = { error: e.message, team: [], sent: [], late: [] }; });
  }
  function loadMail() {
    return get('/api/gmail?action=status&ws=' + WS).then(function (st) {
      S.mail = { connected: st.connected, email: st.email };
      if (!st.connected) { S.inbox = []; return; }
      return get('/api/gmail?action=list&ws=' + WS).then(function (r) { S.inbox = r.messages || []; did('Inbox checked, ' + S.inbox.filter(function (m) { return m.unread; }).length + ' unread'); });
    }).catch(function (e) { S.mail = { connected: S.mail ? S.mail.connected : false, error: e.status === 503 ? 'unavailable' : e.message }; S.inbox = []; });
  }

  /* calendar helpers */
  function kind(e) { var t = (e.title + ' ' + e.calendar).toLowerCase(); if (/deadline|due|closes|payroll|submit/.test(t)) return 'dl'; if (/program|class|event|show|session|rehears/.test(t)) return 'pe'; return 'mt'; }
  var KLAB = { dl: '! Deadline', pe: '✦ Event', mt: '▪ Meeting' };
  function startOf(e) { return e.start && e.start.dateTime ? new Date(e.start.dateTime) : (e.start && e.start.date ? new Date(e.start.date + 'T00:00') : null); }
  function isAllDay(e) { return !(e.start && e.start.dateTime); }
  function dayIndex(e) { var s = startOf(e); if (!s) return -1; return Math.floor((new Date(ymd(s) + 'T12:00') - WEEK0) / 864e5); }
  function eventsOn(i) { return S.events.filter(function (e) { return dayIndex(e) === i; }).sort(function (a, b) { return startOf(a) - startOf(b); }); }

  /* what needs you */
  function weekTxt() {
    var tc = S.tc || {}; if (!tc.days || !tc.days.length) return 'this week';
    var f = function (d) { return new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
    return f(tc.days[0]) + ' – ' + f(tc.days[6]);
  }
  function buildNeeds() {
    var n = [], tc = S.tc || { sent: [], late: [] };
    if (tc.error) n.push({ id: 'timecards-unavailable', t: 'Timecards unavailable', d: 'The last check failed · status unknown', pill: '! Check', cta: 'Open Timecards', href: '/' + WS + '/hub#timecards', why: 'We could not check timecards. Missing and submitted counts are unknown until the source loads.', rows: [['Source', 'Timecards'], ['Status', 'Could not load']] });
    if (tc.late.length) {
      var withEmail = tc.late.filter(function (m) { return m.email; });
      S.drafts.remind = S.drafts.remind || ('Hi {first name}, a quick reminder to add your hours for ' + weekTxt() + '. It takes about a minute: {link}\n\nThank you!\n' + (first(OWNER) || ''));
      n.push({ id: 'remind', t: 'Timecards still missing', d: tc.late.map(function (m) { return first(m.name); }).join(', ') + ' · Owner: you', pill: '! ' + plural(tc.late.length, 'missing', 'missing'),
        cta: 'Send the timecard reminder', why: 'Payroll can’t go out until everyone’s hours are in. The hub drafted one short reminder, just for the people still missing.',
        rows: [['Goes to', withEmail.length ? withEmail.map(function (m) { return m.name; }).join(', ') : 'Nobody has an email on file yet'], ['From', S.mail && S.mail.connected ? S.mail.email : 'Your email, once Gmail is connected'], ['Checked', 'Timecards, this week · team list']],
        draft: 'remind', to: withEmail });
    }
    if (tc.sent.length) n.push({ id: 'approve', t: 'Approve ' + plural(tc.sent.length, 'timecard'), d: tc.sent.map(function (m) { return first(m.name); }).join(', ') + ' sent hours · Owner: you', pill: '→ Ready',
      cta: 'Review and approve', href: '/' + WS + '/hub#timecards', why: 'These hours are waiting on you. Nothing reaches payroll until you approve.', rows: [['Approves', tc.sent.map(function (m) { return m.name; }).join(', ')], ['Then', 'Hours are ready for the payroll download']] });
    if (S.cal && S.cal.error !== 'unavailable' && (!S.cal.connected || S.cal.error)) n.push({ id: 'cal', t: S.cal.error === 'expired' ? 'Reconnect your calendar' : 'Connect your calendar', d: 'Your week stays empty until it’s connected', pill: '! Setup',
      cta: 'Reconnect', href: '/' + WS + '/hub#connect', why: 'The hub reads your calendar to show your week and flag deadlines. It never changes your calendar.', rows: [['Opens', 'Google sign-in, read-only']] });
    if (S.mail && S.mail.error !== 'unavailable' && (!S.mail.connected || S.mail.error)) n.push({ id: 'gmail', t: 'Connect your email', d: 'So your newest unread emails show here', pill: '→ Setup',
      cta: 'Connect Gmail', href: '/' + WS + '/inbox', why: 'With email connected, replies and reminders go out from your own address. Nothing sends without you.', rows: [['Opens', 'Google sign-in'], ['Allows', 'Read and send, only when you press Send']] });
    S.needs = n;
  }

  /* render */
  function render() {
    buildNeeds();
    var tc = S.tc || { team: [], sent: [], late: [] }, unread = S.inbox.filter(function (m) { return m.unread; });
    var calOk = model.calendarReady(S), mailOk = model.mailReady(S);
    var todays = calOk ? eventsOn(TODAY_I) : [];
    var meetings = todays.filter(function (e) { return kind(e) === 'mt'; });

    renderTicker(tc, unread, calOk, mailOk);

    /* update line: only what's known, zero parts drop out */
    var parts = [];
    if (mailOk && unread.length) parts.push('<em>' + plural(unread.length, 'unread email') + '</em>');
    if (calOk && meetings.length) parts.push('<em>' + plural(meetings.length, 'meeting') + '</em>');
    if (S.needs.length) parts.push('<em>' + plural(S.needs.length, 'thing') + '</em> that need' + (S.needs.length === 1 ? 's' : '') + ' you');
    $('update').innerHTML = parts.length ? 'Today you have ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) + '.' : (model.sourcesReady(S) ? 'No known decisions from your connected sources.' : 'Some sources are unavailable. Your day is not fully checked.');

    /* three boxes */
    var mailNA = S.mail && S.mail.error;
    var b1 = mailNA ? '<div class="box"><small>Unread email</small><b>Unavailable</b><span>Unread count unknown</span></div>' : mailOk ? '<button class="box lift" id="bMail"><small>Unread email</small><b>' + (unread.length ? plural(unread.length, 'unread email') : 'No unread messages loaded') + '</b><span>' + (unread[0] ? 'Newest: ' + esc(fromName(unread[0].from)) : 'Nothing waiting') + '</span></button>'
      : '<a class="box lift" href="/' + WS + '/inbox"><small>Unread email</small><b>Connect Gmail</b><span>Then your emails show here</span></a>';
    var top = S.needs[0];
    var b2 = '<button class="box lift" id="bCrit"><small class="teal">Needs your attention</small><b>' + esc(top ? top.t : 'No known decisions') + '</b><span>' + esc(top ? plural(S.needs.length, 'item') + ' to review' : model.sourcesReady(S) ? 'Connected sources checked' : 'Some sources unavailable') + '</span></button>';
    var rec = S.needs.filter(function (x) { return x.draft; })[0] || top;
    var b3 = '<button class="box rec lift" id="bRec"><small>→ Recommended</small><b>' + esc(rec ? rec.cta : model.sourcesReady(S) ? 'Review your day' : 'Check your connections') + '</b><span>' + esc(rec ? 'Nothing happens until you approve' : 'Based on available sources') + '</span></button>';
    $('boxes').innerHTML = b1 + b2 + b3;
    if ($('bMail')) $('bMail').onclick = function () { S.panel = 'inbox'; S.mailOpen = 0; renderPanel(); openMail(0); };
    $('bCrit').onclick = function () { if (top) pick(top.id); };
    $('bRec').onclick = function () { if (rec) pick(rec.id); else location.href = '/' + WS + (model.sourcesReady(S) ? '/today' : '/hub#connect'); };

    $('needs').innerHTML = S.needs.length ? S.needs.map(function (x) {
      return '<button class="need lift' + (S.pick === x.id ? ' on' : '') + '" data-need="' + x.id + '"><span><b>' + esc(x.t) + '</b><span class="sub">' + esc(x.d) + '</span></span><span class="pill">' + esc(x.pill) + '</span></button>';
    }).join('') : '<div class="empty">No known decisions from the sources available.</div>';

    $('health').textContent = model.healthText(S);
    renderAgenda(calOk, todays);
    renderTrack(tc, unread, calOk, mailOk, todays);
    renderWeek(calOk);
    var editing = $('panel').contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName);
    if (!editing) renderPanel();
  }

  /* the ticker: green = pulled within the last 20 minutes, red = needs a look */
  var EVERY = 15 * 60 * 1000;
  function renderTicker(tc, unread, calOk, mailOk) {
    var at = S.updated || new Date(), fresh = (new Date() - at) < 20 * 60 * 1000, when = 'pulled ' + clock(at);
    var calWhy = S.cal && S.cal.error === 'unavailable' ? 'not set up here' : S.cal && S.cal.error === 'expired' ? 'connection expired, reconnect' : S.cal && S.cal.error ? 'couldn’t reach Google' : 'not connected';
    var mailWhy = S.mail && S.mail.error === 'unavailable' ? 'not set up here' : S.mail && S.mail.error ? 'couldn’t reach Gmail' : 'waiting on sign-in';
    var items = [
      calOk && fresh ? [1, 'Calendar', when, plural(S.events.length, 'event') + ' this week'] : [0, 'Calendar', calOk ? 'last ' + when : 'needs a look', calOk ? 'older than 15 minutes' : calWhy],
      !tc.error && fresh ? [1, 'Timecards', when, tc.team.length ? (tc.team.length - tc.late.length) + ' of ' + tc.team.length + ' in' : 'no team added yet'] : [0, 'Timecards', 'needs a look', tc.error ? 'couldn’t load' : 'older than 15 minutes'],
      mailOk && fresh ? [1, 'Gmail', when, plural(unread.length, 'unread email')] : [0, 'Gmail', mailOk ? 'last ' + when : 'needs a look', mailOk ? 'older than 15 minutes' : mailWhy],
      [1, 'Next check', clock(new Date(at.getTime() + EVERY)), 'every 15 minutes']
    ];
    var one = items.slice(0, 3).map(function (x) {
      return '<span class="tk" title="' + esc(x[2] + ' · ' + x[3]) + '"><span class="dot ' + (x[0] ? 'ok' : 'bad') + '" aria-hidden="true"></span><b>' + esc(x[1]) + '</b> ' + (x[0] ? 'Synced' : 'Needs a look') + '</span>';
    }).join('');
    $('ticker').innerHTML = one;
  }

  function renderTrack(tc, unread, calOk, mailOk, todays) {
    var html = '';
    if (tc.team.length) {
      var inN = tc.team.length - tc.late.length, pct = Math.round(inN / tc.team.length * 100), ok = !tc.late.length;
      html += '<div class="metric"><div class="top"><b>Timecards in</b><span class="' + (ok ? 'teal' : '') + '">' + (ok ? '✓ On track' : '! Behind') + '</span></div>' +
        '<div class="bullet" role="img" aria-label="' + inN + ' of ' + tc.team.length + ' timecards in, goal all in"><span></span><span></span><span></span><i class="act" style="width:' + pct + '%"></i><i class="goal" style="left:calc(100% - 3px)"></i></div>' +
        '<div class="val">' + inN + ' of ' + tc.team.length + '</div></div>';
    } else html += '<div class="metric"><div class="top"><b>Timecards in</b><span>◌</span></div><div class="val">' + (tc.error ? 'Unavailable — could not load' : 'No team added yet') + '</div></div>';
    html += '<div class="metric"><div class="top"><b>Unread email</b><span>' + (mailOk ? '' : '◌') + '</span></div><div class="val">' + (mailOk ? unread.length + ' loaded' : S.mail && S.mail.error ? 'Gmail unavailable' : 'Gmail not connected') + '</div></div>';
    html += '<div class="metric"><div class="top"><b>On today’s calendar</b><span>' + (calOk ? '' : '◌') + '</span></div><div class="val">' + (calOk ? todays.length : 'Calendar unavailable or not selected') + '</div></div>';
    $('track').innerHTML = html;
  }

  function renderWeek(calOk) {
    var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], html = '';
    for (var i = 0; i < 7; i++) {
      var evs = calOk ? eventsOn(i) : [], cls = 'day' + (i < TODAY_I ? ' past' : '') + (i === TODAY_I ? ' today' : '') + (S.day === i ? ' sel' : '');
      html += '<div class="' + cls + '"><button class="dh" data-day="' + i + '" aria-label="Open ' + names[i] + '" aria-expanded="' + (S.day === i) + '"><span>' + names[i] + '</span><span>' + (i === TODAY_I ? 'Today' : i < TODAY_I ? '✓' : '') + '</span></button>' +
        evs.slice(0, 3).map(function (e) { var k = kind(e); return '<button class="ev ' + k + '" data-day="' + i + '"><small>' + KLAB[k] + '</small>' + esc(e.title) + '</button>'; }).join('') +
        (evs.length > 3 ? '<span class="more">+' + (evs.length - 3) + ' more</span>' : '') + '</div>';
    }
    $('days').innerHTML = html;
    if (!calOk) { $('dayOpen').innerHTML = '<div class="empty" style="margin-top:12px">' + (S.cal && S.cal.error === 'unavailable' ? 'The calendar isn’t set up on this version of the hub. On app.makingcuepa.com your week fills in here.' : (S.cal && S.cal.error === 'expired' ? 'Your calendar connection expired. ' : 'No calendar connected yet. ') + '<a href="/' + WS + '/hub#connect">Connect it</a> and your week fills in here.') + '</div>'; return; }
    if (S.day == null) { $('dayOpen').innerHTML = ''; return; }
    var d = new Date(WEEK0); d.setDate(d.getDate() + S.day);
    var list = eventsOn(S.day);
    $('dayOpen').innerHTML = '<div class="dayopen"><div class="top"><div><h3>' + esc(d.toLocaleDateString(undefined, { weekday: 'long' })) + '</h3><span class="meta">' + esc(d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })) + ' · ' + (list.length ? plural(list.length, 'item') : 'nothing scheduled') + '</span></div>' +
      '<div style="display:flex;align-items:center"><a class="btn link" href="/' + WS + '/hub#calendar">Open in Calendar</a><button class="x" id="dayClose" aria-label="Close day">✕</button></div></div>' +
      (list.length ? '<div class="dayitems">' + list.map(function (e) {
        var s = startOf(e), k = kind(e), rows = [];
        if (e.location) rows.push(['Where', e.location]); if (e.who && e.who.length) rows.push(['With', e.who.join(', ')]); if (e.calendar) rows.push(['Calendar', e.calendar]);
        return '<div class="item"><div class="t"><span>' + (isAllDay(e) ? 'All day' : clock(s)) + '</span><b class="' + (k === 'pe' ? 'teal' : '') + '">' + KLAB[k] + '</b></div><h4>' + esc(e.title) + '</h4>' +
          rows.map(function (r) { return '<div class="r"><span>' + esc(r[0]) + '</span><span style="color:var(--ink)">' + esc(r[1]) + '</span></div>'; }).join('') +
          (e.link ? '<div class="r"><span></span><a href="' + esc(e.link) + '" target="_blank" rel="noopener">Open in Google Calendar ↗</a></div>' : '') + '</div>';
      }).join('') + '</div>' : '<div class="empty" style="margin-top:10px">Nothing on the calendar. A clear day.</div>') + '</div>';
    $('dayClose').onclick = function () { S.day = null; renderWeek(true); };
  }

  function renderPanel() {
    $('tabInbox').setAttribute('aria-pressed', S.panel === 'inbox');
    $('tabDetails').setAttribute('aria-pressed', S.panel === 'details');
    var el = $('panel');
    if (S.panel === 'details' && S.meeting) { renderMeeting(); return; }
    if (S.panel === 'inbox') {
      var mailOk = model.mailReady(S);
      if (!mailOk && S.mail && S.mail.error === 'unavailable') { el.innerHTML = '<h2>Your inbox</h2><div class="empty">Email isn’t available right now. Open your inbox to check the connection.</div>'; return; }
      if (S.mail && S.mail.error && S.mail.error !== 'unavailable') { var expired = /connect your email again|not connected/i.test(S.mail.error); el.innerHTML = '<div class="rm-head"><h2>Email</h2></div><div class="empty">' + (expired ? 'Google signed CUEPA out of your Gmail. Reconnect to see your email here again. It takes about a minute.' : 'We couldn’t load your email just now. Try again in a moment.') + '</div><div class="rm-acts" style="margin-top:12px">' + (expired ? '<a class="btn go" href="/api/gmail?action=start&ws=' + encodeURIComponent(WS) + '">Reconnect Gmail</a>' : '') + '<a class="btn" href="/' + WS + '/inbox">Open inbox</a></div>'; return; }
      if (!mailOk) { el.innerHTML = '<h2>Your inbox</h2><div class="empty">Connect Gmail to see your messages here. You decide what to send.</div><a class="btn" href="/' + WS + '/inbox">Connect Gmail →</a>'; return; }
      var top = S.inbox.filter(function (m) { return m.unread; }).sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); }).slice(0, 6);
      var allUnread = S.inbox.filter(function (m) { return m.unread && !m.seen; }).length;
      var IN = '/' + WS + '/inbox';
      el.innerHTML = '<div class="rm-head"><h2>Latest unread</h2><span>' + (allUnread ? allUnread + ' unread' : 'All caught up') + '</span></div>' +
        (top.length ? '<div class="rm-list">' + top.map(function (m, i) {
          var on = S.mailOpen === i, b = S.bodies[m.id];
          var row = '<div class="rm-row' + (on ? ' on' : '') + (m.seen ? '' : ' unread') + '">' +
            '<button class="rm-sum" data-mail="' + i + '" aria-expanded="' + on + '"><span class="rm-av" aria-hidden="true">' + esc(initialOf(m.from)) + '</span>' +
            '<span class="rm-txt"><span class="rm-l1"><b>' + esc(fromName(m.from)) + '</b><time>' + esc(whenOf(m.date)) + '</time></span>' +
            '<span class="rm-subj">' + esc(m.subject || '(no subject)') + '</span>' + (on ? '' : '<span class="rm-snip">' + esc(m.snippet) + '</span>') + '</span></button>';
          if (on) {
            var body = !b ? '<p class="rm-wait">Opening…</p>' : b.error ? '<p class="rm-wait">This email couldn’t open here. Open it in your Inbox.</p>' :
              '<div class="rm-meta">' + esc(addrOf(m.from)) + ' · ' + esc(new Date(m.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</div>' +
              '<div class="rm-body' + (S.full[m.id] ? ' full' : '') + '">' + esc(b.body || m.snippet) + '</div>' +
              ((b.body || '').length > 700 && !S.full[m.id] ? '<button class="rm-more" data-full="' + esc(m.id) + '">Show the whole email</button>' : '');
            row += '<div class="rm-read">' + body + '<div class="rm-acts"><a class="btn go" href="' + IN + '?open=' + encodeURIComponent(m.id) + '&reply=1">Reply</a><a class="btn" href="' + IN + '?open=' + encodeURIComponent(m.id) + '">Open in Inbox</a></div></div>';
          }
          return row + '</div>';
        }).join('') + '</div>' : '<div class="empty">No unread email. You’re up to date.</div>') +
        '<a class="btn wide" href="' + IN + '">See all email <span aria-hidden="true">→</span></a>';
      return;
    }
    var x = S.needs.filter(function (n) { return n.id === S.pick; })[0];
    var act = '<div class="log"><h3 class="eyebrow" style="margin-bottom:4px">What the hub did today</h3>' + (log.length ? log.map(function (a) { return '<div class="r"><time>' + clock(a.at) + '</time><div>' + esc(a.text) + '</div></div>'; }).join('') : '<div class="r"><time>–</time><div>Nothing yet.</div></div>') + '</div>';
    if (!x) { el.innerHTML = '<h2>Tap anything that needs you</h2><p class="quiet">You’ll see why it’s here, who it goes to, and what to decide.</p>' + act; return; }
    var draft = '';
    if (x.draft) {
      var ready = model.mailReady(S) && x.to.length;
      draft = '<div class="draft"><label for="draftTxt">Draft · not sent. Each person gets their own name and link.</label><textarea id="draftTxt">' + esc(S.drafts[x.draft]) + '</textarea>' +
        (ready ? '<div><button class="btn go" id="sendDraft">Send ' + plural(x.to.length, 'reminder') + ' →</button></div><small>Nothing sends until you press the button.</small>'
          : '<small>' + (S.mail && S.mail.connected ? 'Add an email for each person on the Timecards page to send from here.' : 'Sends from your own email once Gmail is connected.') + '</small>') + '</div>';
    }
    el.innerHTML = '<div><div class="eyebrow">Needs you</div><h2>' + esc(x.t) + '</h2></div><div class="why"><p>' + esc(x.why) + '</p></div>' +
      '<div class="rows">' + x.rows.map(function (r) { return '<div class="r"><span>' + esc(r[0]) + '</span><div>' + esc(r[1]) + '</div></div>'; }).join('') + '</div>' + draft +
      (x.href ? '<div><a class="btn go" href="' + esc(x.href) + '">' + esc(x.cta) + ' →</a></div>' : '') + act;
    var ta = $('draftTxt'); if (ta) ta.oninput = function () { S.drafts[x.draft] = ta.value; var send = $('sendDraft'); if (send) { delete send.dataset.sure; send.textContent = 'Send ' + plural(x.to.length, 'reminder') + ' →'; } };
    var sb = $('sendDraft'); if (sb) sb.onclick = function () { sendReminders(x, sb); };
  }

  function sendReminders(x, btn) {
    if (!model.mailReady(S)) { toast('Gmail is unavailable. Nothing was sent.'); return; }
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Press again to send ' + plural(x.to.length, 'email'); return; }
    btn.disabled = true; var ok = 0, fail = 0;
    var chain = Promise.resolve();
    x.to.forEach(function (m) {
      chain = chain.then(function () {
        var text = S.drafts[x.draft].split('{first name}').join(first(m.name)).split('{link}').join(m.link || '');
        return fetch('/api/gmail?action=send&ws=' + encodeURIComponent(WS), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: m.email, subject: 'Quick reminder: your hours for this week', body: text }) })
          .then(function (r) { if (!r.ok) throw 0; ok++; }).catch(function () { fail++; });
      });
    });
    chain.then(function () { did('Sent ' + plural(ok, 'timecard reminder') + (fail ? ', ' + fail + ' failed' : '')); toast(ok ? 'Sent ' + plural(ok, 'reminder') + ' from ' + S.mail.email + '.' : 'Nothing was sent. Try again.'); render(); });
  }

  function pick(id) { S.meeting = null; S.pick = id; S.panel = 'details'; render(); if (innerWidth < 1100) document.querySelector('.panel').scrollIntoView({ behavior: 'auto' }); }


  /* Context stays beside the work, with calendar facts separated from personal notes. */
  function renderAgenda(ready, events) {
    var target = $('agenda');
    if (!ready) {
      var calErr = S.cal && S.cal.error, calExpired = calErr === 'expired', notConnected = !calErr && !(S.cal && S.cal.connected && S.cal.selected);
      var msg = calExpired ? 'Google signed CUEPA out of your calendar. Reconnect and your day shows up here.'
        : notConnected ? 'No calendar connected yet. Connect one to see your day here.'
        : 'Your calendar is unavailable right now. Try again in a moment.';
      target.innerHTML = '<div class="empty">' + msg + '</div>' + (calExpired || notConnected ? '<div class="rm-acts" style="margin-top:12px"><a class="btn go" href="/' + WS + '/hub#connect">' + (calExpired ? 'Reconnect calendar' : 'Connect calendar') + '</a></div>' : '');
      return;
    }
    target.innerHTML = (events.length ? events.slice(0, 5).map(function (event) {
      return '<button class="agenda-row" data-meeting="' + esc(event.id) + '"><time>' + esc(isAllDay(event) ? 'All day' : clock(startOf(event))) + '</time><span><b>' + esc(event.title) + '</b><small>' + esc(event.location || event.calendar || 'Calendar event') + '</small></span><span aria-hidden="true">↗</span></button>';
    }).join('') : '<div class="empty">No events on today’s connected calendars.</div>') +
      (events.length > 5 ? '<a class="btn link" href="/' + WS + '/today">See all ' + events.length + ' events →</a>' : '') +
      (S.followups.length ? '<div class="meeting-followups"><h3 class="eyebrow">Your follow-ups · this session</h3>' + S.followups.map(function (f) { return '<p><b>' + esc(f.title) + '</b><br>' + esc(f.text) + '</p>'; }).join('') + '</div>' : '');
  }
  function openMeeting(id) {
    S.meeting = id; S.pick = null; S.panel = 'details'; renderPanel();
    $('panel').focus({ preventScroll: true });
    if (innerWidth < 1100) document.querySelector('.panel').scrollIntoView({ behavior: 'auto' });
  }
  function renderMeeting() {
    var event = S.events.filter(function (e) { return e.id === S.meeting; })[0], el = $('panel');
    if (!event || !model.calendarReady(S)) { el.innerHTML = '<h2>Meeting unavailable</h2><p class="quiet">The calendar changed or could not be refreshed. Check the source before preparing.</p>'; return; }
    var note = S.notes[event.id] || { objective: '', notes: '', ready: false };
    S.notes[event.id] = note;
    el.innerHTML = '<div><div class="eyebrow">Meeting preparation</div><h2>' + esc(event.title) + '</h2><p class="quiet">' + esc(isAllDay(event) ? 'All day' : clock(startOf(event))) + ' · ' + esc(event.calendar || 'Calendar') + '</p></div>' +
      '<div class="rows"><div class="r"><span>Who’s coming</span><div>' + esc(event.who && event.who.length ? event.who.join(', ') : 'No attendees listed') + '</div></div><div class="r"><span>Where</span><div>' + esc(event.location || 'No location listed') + '</div></div></div>' +
      '<section class="prep-context"><h3 class="eyebrow">From the calendar</h3><p>' + esc(event.notes || 'No description provided. Add your own preparation below.') + '</p></section>' +
      '<div class="draft"><label for="meetingObjective">What do you want to leave with?</label><textarea id="meetingObjective" rows="2" placeholder="The outcome you want from this conversation…">' + esc(note.objective) + '</textarea><label for="meetingNotes">Talking points, things to bring, and notes</label><textarea id="meetingNotes" rows="4" placeholder="Capture what you want to ask or follow up on…">' + esc(note.notes) + '</textarea><small>Private to this tab. Download your notes before reloading or leaving.</small></div>' +
      '<div class="prep-actions"><button class="btn go" id="meetingReady">' + (note.ready ? '✓ Ready · undo' : 'I’m ready →') + '</button><button class="btn" id="downloadNotes">Download notes</button></div>' +
      '<form class="draft" id="followupForm"><label for="meetingFollowup">Add a follow-up to your day</label><input id="meetingFollowup" maxlength="500" required placeholder="A specific next step…"><button class="btn" type="submit">Add follow-up</button></form>' +
      '<a class="btn link" href="/' + WS + '/inbox">Check related conversations in Inbox →</a><small class="quiet">Email matching is not connected here. No messages are sent from meeting prep.</small>';
    $('meetingObjective').oninput = function () { note.objective = this.value; };
    $('meetingNotes').oninput = function () { note.notes = this.value; };
    $('meetingReady').onclick = function () { note.ready = !note.ready; this.textContent = note.ready ? '✓ Ready · undo' : 'I’m ready →'; };
    $('downloadNotes').onclick = function () {
      var text = event.title + '\n\nDesired outcome\n' + note.objective + '\n\nNotes\n' + note.notes + '\n\nFollow-ups\n' + S.followups.filter(function (f) { return f.id === event.id; }).map(function (f) { return '• ' + f.text; }).join('\n');
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'meeting-notes.txt'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    };
    $('followupForm').onsubmit = function (e) { e.preventDefault(); var text = $('meetingFollowup').value.trim(); if (!text) return; S.followups.push({ id: event.id, title: event.title, text: text }); $('meetingFollowup').value = ''; renderAgenda(model.calendarReady(S), eventsOn(TODAY_I)); toast('Follow-up added for this session.'); };
  }

  $('agenda').addEventListener('click', function (e) { var button = e.target.closest('[data-meeting]'); if (button) openMeeting(button.dataset.meeting); });

  /* events */
  $('needs').addEventListener('click', function (e) { var b = e.target.closest('[data-need]'); if (b) pick(b.dataset.need); });
  $('days').addEventListener('click', function (e) { var b = e.target.closest('[data-day]'); if (!b) return; var i = +b.dataset.day; S.day = S.day === i ? null : i; renderWeek(model.calendarReady(S)); });
  function openMail(i) {
    var top = S.inbox.filter(function (m) { return m.unread; }).sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); }).slice(0, 6);
    var m = top[i]; if (!m || S.bodies[m.id]) return;
    get('/api/gmail?action=read&ws=' + encodeURIComponent(WS) + '&id=' + encodeURIComponent(m.id)).then(function (r) {
      S.bodies[m.id] = r.message || { body: m.snippet };
      if (!m.seen) { m.seen = true; post('/api/gmail?action=read-state&ws=' + encodeURIComponent(WS), { id: m.id, unread: false }).catch(function () {}); }
    }).catch(function () { S.bodies[m.id] = { error: true }; }).then(function () { if (S.panel === 'inbox') renderPanel(); });
  }
  $('panel').addEventListener('click', function (e) {
    var f = e.target.closest('[data-full]'); if (f) { S.full[f.dataset.full] = true; renderPanel(); return; }
    var b = e.target.closest('[data-mail]'); if (!b) return; var i = +b.dataset.mail; S.mailOpen = S.mailOpen === i ? -1 : i; renderPanel(); if (S.mailOpen === i) openMail(i);
  });
  $('tabInbox').onclick = function () { S.panel = 'inbox'; renderPanel(); };
  $('tabDetails').onclick = function () { S.panel = 'details'; renderPanel(); };

  function loadAll() { return Promise.all([loadCal(), loadTc(), loadMail()]).then(function () { S.updated = new Date(); }); }
  setInterval(function () { loadAll().then(render); }, EVERY);
  Promise.all([loadCal(), loadTc(), loadMail()]).then(function () {
    var skipped = false; try { skipped = localStorage.getItem('cuepa_start_' + WS) === 'done'; } catch (e) { skipped = true; }
    var calOk = model.calendarReady(S), mailOk = model.mailReady(S);
    var unavailable = (S.cal && S.cal.error === 'unavailable') || (S.mail && S.mail.error === 'unavailable');
    if (!skipped && !unavailable && !calOk && !mailOk) { location.replace('/' + WS + '/start'); return; }
    S.updated = new Date(); render();
  });
})();

