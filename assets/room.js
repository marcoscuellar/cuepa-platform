/* The Room — live data from /api/google, /api/timecards and /api/gmail.
   Rule: no made-up numbers. If something isn't connected, it says so; it never shows zero for unknown. */
(function () {
  'use strict';
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
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 4200); }
  var log = []; function did(text) { log.unshift({ at: new Date(), text: text }); }

  var S = { cal: null, events: [], tc: null, mail: null, inbox: [], needs: [], pick: null, panel: 'inbox', mailOpen: 0, day: null, drafts: {}, updated: null };
  var NOW = new Date(), WEEK0 = mondayOf(NOW), TODAY_I = (NOW.getDay() + 6) % 7;

  /* look + greeting */
  $('look').onclick = function () {
    var dark = document.documentElement.dataset.look !== 'dark';
    if (dark) document.documentElement.dataset.look = 'dark'; else delete document.documentElement.dataset.look;
    try { localStorage.setItem('cuepa_look', dark ? 'dark' : 'light'); } catch (e) {}
  };
  var h = NOW.getHours();
  $('date').textContent = NOW.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('hi').innerHTML = esc(h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,') + '<br>' + esc((first(OWNER) || 'there') + '.');

  /* data */
  function loadCal() {
    return get('/api/google?action=status&ws=' + WS).then(function (st) {
      S.cal = { connected: st.connected, selected: (st.selected || []).length };
      if (!st.connected || !S.cal.selected) { S.events = []; return; }
      var end = new Date(WEEK0); end.setDate(end.getDate() + 7);
      return get('/api/google?' + new URLSearchParams({ action: 'events', ws: WS, start: WEEK0.toISOString(), end: end.toISOString() })).then(function (r) {
        S.events = r.events || []; did('Calendar synced, ' + plural(S.events.length, 'event') + ' this week');
      });
    }).catch(function (e) { S.cal = { connected: S.cal ? S.cal.connected : false, error: (e.status === 401 || e.status === 400 || e.status === 409) ? 'expired' : 'down' }; S.events = []; });
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
      if (!st.connected) return;
      return get('/api/gmail?action=list&ws=' + WS).then(function (r) { S.inbox = r.messages || []; did('Inbox checked, ' + S.inbox.filter(function (m) { return m.unread; }).length + ' unread'); });
    }).catch(function (e) { S.mail = { connected: S.mail ? S.mail.connected : false, error: e.message }; S.inbox = []; });
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
    if (S.cal && (!S.cal.connected || S.cal.error)) n.push({ id: 'cal', t: S.cal.error === 'expired' ? 'Reconnect your calendar' : 'Connect your calendar', d: 'Your week stays empty until it’s connected', pill: '! Setup',
      cta: 'Reconnect', href: '/' + WS + '/hub#connect', why: 'The hub reads your calendar to show your week and flag deadlines. It never changes your calendar.', rows: [['Opens', 'Google sign-in, read-only']] });
    if (S.mail && !S.mail.connected) n.push({ id: 'gmail', t: 'Connect your email', d: 'So your most important emails show here', pill: '→ Setup',
      cta: 'Connect Gmail', href: '/' + WS + '/inbox', why: 'With email connected, replies and reminders go out from your own address. Nothing sends without you.', rows: [['Opens', 'Google sign-in'], ['Allows', 'Read and send, only when you press Send']] });
    S.needs = n;
  }

  /* render */
  function render() {
    buildNeeds();
    var tc = S.tc || { team: [], sent: [], late: [] }, unread = S.inbox.filter(function (m) { return m.unread; });
    var calOk = S.cal && S.cal.connected && !S.cal.error, mailOk = S.mail && S.mail.connected;
    var todays = calOk ? eventsOn(TODAY_I) : [];
    var meetings = todays.filter(function (e) { return kind(e) === 'mt'; });

    $('sources').innerHTML = '<span class="eyebrow">The Room</span>' +
      '<span><b>Calendar</b> ' + (calOk ? '<span class="ok">✓ Synced</span>' : '<span class="wait">' + (S.cal && S.cal.error === 'expired' ? '! Needs reconnect' : '◌ Not connected') + '</span>') + '</span>' +
      '<span><b>Timecards</b> ' + (tc.error ? '<span class="wait">! Unavailable</span>' : '<span class="ok">✓ Synced</span>') + '</span>' +
      '<span><b>Gmail</b> ' + (mailOk ? '<span class="ok">✓ Synced</span>' : '<span class="wait">◌ Waiting on sign-in</span>') + '</span>' +
      '<span>Updated ' + clock(S.updated || new Date()) + '</span>';

    /* update line: only what's known, zero parts drop out */
    var parts = [];
    if (mailOk && unread.length) parts.push('<em>' + plural(unread.length, 'email') + '</em> to answer');
    if (calOk && meetings.length) parts.push('<em>' + plural(meetings.length, 'meeting') + '</em>');
    if (S.needs.length) parts.push('<em>' + plural(S.needs.length, 'thing') + '</em> that need' + (S.needs.length === 1 ? 's' : '') + ' you');
    $('update').innerHTML = parts.length ? 'Today you have ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) + '.' : 'Nothing needs you right now. <em>The hub keeps watching.</em>';

    /* three boxes */
    var b1 = mailOk ? '<button class="box lift" id="bMail"><small>▼ Emails need a reply</small><b>' + (unread.length ? plural(unread.length, 'unread email') : 'Inbox is clear') + '</b><span>' + (unread[0] ? 'Newest: ' + esc(fromName(unread[0].from)) : 'Nothing waiting') + '</span></button>'
      : '<a class="box lift" href="/' + WS + '/inbox"><small>▼ Emails need a reply</small><b>Connect Gmail</b><span>Then your emails show here</span></a>';
    var top = S.needs[0];
    var b2 = '<button class="box lift" id="bCrit"><small class="teal">▲ Critical · needs you</small><b>' + esc(top ? top.t : 'Nothing critical') + '</b><span>' + esc(top ? plural(S.needs.length, 'item') + ' need you' : 'All clear') + '</span></button>';
    var rec = S.needs.filter(function (x) { return x.draft; })[0] || top;
    var b3 = '<button class="box rec lift" id="bRec"><small>→ Recommended</small><b>' + esc(rec ? rec.cta : 'Nothing to do right now') + '</b><span>' + esc(rec ? 'Nothing happens until you approve' : 'You’re all set') + '</span></button>';
    $('boxes').innerHTML = b1 + b2 + b3;
    if ($('bMail')) $('bMail').onclick = function () { S.panel = 'inbox'; S.mailOpen = 0; renderPanel(); };
    $('bCrit').onclick = function () { if (top) pick(top.id); };
    $('bRec').onclick = function () { if (rec) pick(rec.id); };

    $('needs').innerHTML = S.needs.length ? S.needs.map(function (x) {
      return '<button class="need lift' + (S.pick === x.id ? ' on' : '') + '" data-need="' + x.id + '"><span><b>' + esc(x.t) + '</b><span class="sub">' + esc(x.d) + '</span></span><span class="pill">' + esc(x.pill) + '</span></button>';
    }).join('') : '<div class="empty">Nothing needs a decision right now.</div>';

    renderTrack(tc, unread, calOk, mailOk, todays);
    renderWeek(calOk);
    renderPanel();
  }

  function renderTrack(tc, unread, calOk, mailOk, todays) {
    var html = '';
    if (tc.team.length) {
      var inN = tc.team.length - tc.late.length, pct = Math.round(inN / tc.team.length * 100), ok = !tc.late.length;
      html += '<div class="metric"><div class="top"><b>Timecards in</b><span class="' + (ok ? 'teal' : '') + '">' + (ok ? '✓ On track' : '! Behind') + '</span></div>' +
        '<div class="bullet" role="img" aria-label="' + inN + ' of ' + tc.team.length + ' timecards in, goal all in"><span></span><span></span><span></span><i class="act" style="width:' + pct + '%"></i><i class="goal" style="left:calc(100% - 3px)"></i></div>' +
        '<div class="val">' + inN + ' of ' + tc.team.length + '</div></div>';
    } else html += '<div class="metric"><div class="top"><b>Timecards in</b><span>◌</span></div><div class="val">No team added yet</div></div>';
    html += '<div class="metric"><div class="top"><b>Unread email</b><span>' + (mailOk ? '' : '◌') + '</span></div><div class="val">' + (mailOk ? unread.length : 'Gmail not connected') + '</div></div>';
    html += '<div class="metric"><div class="top"><b>On today’s calendar</b><span>' + (calOk ? '' : '◌') + '</span></div><div class="val">' + (calOk ? todays.length : 'Calendar not connected') + '</div></div>';
    $('track').innerHTML = html;
  }

  function renderWeek(calOk) {
    var names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], html = '';
    for (var i = 0; i < 7; i++) {
      var evs = calOk ? eventsOn(i) : [], cls = 'day' + (i < TODAY_I ? ' past' : '') + (i === TODAY_I ? ' today' : '') + (S.day === i ? ' sel' : '');
      html += '<div class="' + cls + '"><button class="dh" data-day="' + i + '" aria-label="Open ' + names[i] + '" aria-expanded="' + (S.day === i) + '"><span>' + names[i] + '</span><span>' + (i === TODAY_I ? 'Today' : i < TODAY_I ? '✓' : '') + '</span></button>' +
        evs.slice(0, 3).map(function (e) { var k = kind(e); return '<button class="ev ' + k + '" data-day="' + i + '"><small>' + KLAB[k] + '</small>' + esc(e.title) + '</button>'; }).join('') +
        (evs.length > 3 ? '<span class="more">+' + (evs.length - 3) + ' more</span>' : '') + '</div>';
    }
    $('days').innerHTML = html;
    if (!calOk) { $('dayOpen').innerHTML = '<div class="empty" style="margin-top:12px">' + (S.cal && S.cal.error === 'expired' ? 'Your calendar connection expired. ' : 'No calendar connected yet. ') + '<a href="/' + WS + '/hub#connect">Connect it</a> and your week fills in here.</div>'; return; }
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
    if (S.panel === 'inbox') {
      var mailOk = S.mail && S.mail.connected;
      if (!mailOk) { el.innerHTML = '<h2>Most important emails</h2><div class="empty">Connect Gmail and your most important emails show up here. Nothing sends without you.</div><a class="btn" href="/' + WS + '/inbox">Connect Gmail →</a>'; return; }
      var top = S.inbox.filter(function (m) { return m.unread; }).slice(0, 6);
      el.innerHTML = '<div><h2>Most important emails</h2><div class="quiet">Newest unread first · top ' + top.length + '</div></div>' +
        (top.length ? top.map(function (m, i) {
          var on = S.mailOpen === i;
          return '<div class="mail lift' + (on ? ' on' : '') + '"><button data-mail="' + i + '" aria-expanded="' + on + '"><span class="n">' + (i + 1) + '</span><span><span class="f"><b>' + esc(fromName(m.from)) + '</b><span>' + esc(m.date ? new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '') + '</span></span><span class="s">' + esc(m.subject || '(no subject)') + '</span></span></button>' +
            (on ? '<div class="o">' + esc(m.snippet) + '<br><a class="btn" href="/' + WS + '/inbox">Reply in Inbox →</a></div>' : '') + '</div>';
        }).join('') : '<div class="empty">No unread email. Nice.</div>') +
        '<a class="btn wide" href="/' + WS + '/inbox">See inbox <span aria-hidden="true">→</span></a>';
      return;
    }
    var x = S.needs.filter(function (n) { return n.id === S.pick; })[0];
    var act = '<div class="log"><h3 class="eyebrow" style="margin-bottom:4px">What the hub did today</h3>' + (log.length ? log.map(function (a) { return '<div class="r"><time>' + clock(a.at) + '</time><div>' + esc(a.text) + '</div></div>'; }).join('') : '<div class="r"><time>–</time><div>Nothing yet.</div></div>') + '</div>';
    if (!x) { el.innerHTML = '<h2>Tap anything that needs you</h2><p class="quiet">You’ll see why it’s here, who it goes to, and what to decide.</p>' + act; return; }
    var draft = '';
    if (x.draft) {
      var ready = S.mail && S.mail.connected && x.to.length;
      draft = '<div class="draft"><label for="draftTxt">Draft · not sent. Each person gets their own name and link.</label><textarea id="draftTxt">' + esc(S.drafts[x.draft]) + '</textarea>' +
        (ready ? '<div><button class="btn go" id="sendDraft">Send ' + plural(x.to.length, 'reminder') + ' →</button></div><small>Nothing sends until you press the button.</small>'
          : '<small>' + (S.mail && S.mail.connected ? 'Add an email for each person on the Timecards page to send from here.' : 'Sends from your own email once Gmail is connected.') + '</small>') + '</div>';
    }
    el.innerHTML = '<div><div class="eyebrow">Needs you</div><h2>' + esc(x.t) + '</h2></div><div class="why"><p>' + esc(x.why) + '</p></div>' +
      '<div class="rows">' + x.rows.map(function (r) { return '<div class="r"><span>' + esc(r[0]) + '</span><div>' + esc(r[1]) + '</div></div>'; }).join('') + '</div>' + draft +
      (x.href ? '<div><a class="btn go" href="' + esc(x.href) + '">' + esc(x.cta) + ' →</a></div>' : '') + act;
    var ta = $('draftTxt'); if (ta) ta.oninput = function () { S.drafts[x.draft] = ta.value; };
    var sb = $('sendDraft'); if (sb) sb.onclick = function () { sendReminders(x, sb); };
  }

  function sendReminders(x, btn) {
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

  function pick(id) { S.pick = id; S.panel = 'details'; render(); if (innerWidth < 1250) document.querySelector('.panel').scrollIntoView({ behavior: 'smooth' }); }

  /* events */
  $('needs').addEventListener('click', function (e) { var b = e.target.closest('[data-need]'); if (b) pick(b.dataset.need); });
  $('days').addEventListener('click', function (e) { var b = e.target.closest('[data-day]'); if (!b) return; var i = +b.dataset.day; S.day = S.day === i ? null : i; renderWeek(true); });
  $('panel').addEventListener('click', function (e) { var b = e.target.closest('[data-mail]'); if (!b) return; var i = +b.dataset.mail; S.mailOpen = S.mailOpen === i ? -1 : i; renderPanel(); });
  $('tabInbox').onclick = function () { S.panel = 'inbox'; renderPanel(); };
  $('tabDetails').onclick = function () { S.panel = 'details'; renderPanel(); };

  Promise.all([loadCal(), loadTc(), loadMail()]).then(function () {
    var skipped = false; try { skipped = localStorage.getItem('cuepa_start_' + WS) === 'done'; } catch (e) { skipped = true; }
    var calOk = S.cal && S.cal.connected && !S.cal.error, mailOk = S.mail && S.mail.connected;
    if (!skipped && !calOk && !mailOk) { location.replace('/' + WS + '/start'); return; }
    S.updated = new Date(); render();
  });
})();
