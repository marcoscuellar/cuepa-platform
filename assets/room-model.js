/* Shared source-state rules. The assistant is deterministic and never sends data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuepaRoomModel = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function mailReady(s) { return !!(s.mail && s.mail.connected && !s.mail.error); }
  function calendarReady(s) { return !!(s.cal && s.cal.connected && s.cal.selected > 0 && !s.cal.error); }
  function missing(s) {
    var names = [];
    if (!calendarReady(s)) names.push('Calendar');
    if (!mailReady(s)) names.push('Gmail');
    if (!s.tc || s.tc.error) names.push('Timecards');
    return names;
  }
  function sourcesReady(s) { return missing(s).length === 0; }
  function healthText(s) {
    var absent = missing(s);
    if (absent.length) return 'Not fully checked · ' + absent.join(', ') + ' unavailable or not connected.';
    return s.needs.length ? 'Connected sources checked. ' + s.needs.length + ' attention items found.' : 'No known attention items from the connected sources.';
  }
  function assistantReply(question, s, events, mode) {
    if (mode === 'ideas') return 'Let’s structure this outcome: “' + question + '”\n\n1. What would success look like?\n2. Who benefits, and who owns the next step?\n3. What is the smallest experiment you could run?\n4. What evidence would tell you to continue or stop?\n\nThis is a worksheet, not an AI recommendation.';
    if (/calendar|meeting|schedule/i.test(question)) {
      if (!calendarReady(s)) return 'Your calendar is unavailable or no calendar is selected. I cannot tell whether your day is free. Open Calendar to check the connection.';
      return events.length ? 'Today’s calendar:\n' + events.map(function (e) { return '• ' + e.title; }).join('\n') + '\n\nSelect a meeting in Your day to prepare.' : 'No events were returned for today from your selected calendars.';
    }
    if (/mail|inbox|reply|unread/i.test(question)) {
      if (!mailReady(s)) return 'Gmail could not be checked. Your unread count is unknown.';
      return s.inbox.filter(function (m) { return m.unread; }).length + ' unread messages in the loaded inbox. Unread does not necessarily mean a reply is needed. Open Inbox to review them.';
    }
    if (/need|priorit|attention|today|day/i.test(question)) return healthText(s) + (s.needs.length ? '\n\n' + s.needs.map(function (n) { return '• ' + n.t + ' — ' + n.d; }).join('\n') : '') + '\n\nI only summarize the sources shown here; I do not infer urgency or take actions.';
    return 'I can summarize your calendar, loaded unread email, or attention items. For open-ended thinking, switch to Ideas. No AI model is connected yet.';
  }
  return { mailReady: mailReady, calendarReady: calendarReady, sourcesReady: sourcesReady, healthText: healthText, assistantReply: assistantReply };
}));
