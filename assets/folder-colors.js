/* Folder colours for email (shared by The Room and the Inbox).
   Uses the colour the person picked for the label in Gmail; folders without one get a stable
   colour from a fixed palette. Every colour is rendered as a soft tint with dark text so it
   always passes contrast (WCAG AA), and the folder name is always shown next to the colour. */
(function () {
  'use strict';
  var PALETTE = ['#2F6FDE', '#C26401', '#8E44AD', '#C2185B', '#00838F', '#1E8E3E', '#9E7C00', '#6D4C41', '#3949AB', '#D84315'];
  function hex(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); var n = parseInt(h, 16); return isNaN(n) || h.length !== 6 ? null : [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function toHex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join(''); }
  function lum(c) { var f = function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function mix(c, w, t) { return [0, 1, 2].map(function (i) { return c[i] + (w[i] - c[i]) * t; }); }
  function hash(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function hue(c) { var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; }
  function far(a, b) { if (a < 0 || b < 0) return true; var d = Math.abs(a - b); return Math.min(d, 360 - d) >= 32; }
  var cache = {}, picked = {};
  /* Give every folder a colour that is clearly different from the others: Gmail colours first,
     then the next palette colour whose hue is far from every colour already in use. */
  function assign(labels) {
    var used = [], todo = [];
    (labels || []).forEach(function (l) { if (SYSTEM[l.id]) return; var c = hex(l.color && l.color.bg); if (c && lum(c) <= .85) { picked[l.id] = c; used.push(hue(c)); } else todo.push(l); });
    todo.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).forEach(function (l, i) {
      var choice = null;
      for (var k = 0; k < PALETTE.length && !choice; k++) { var c = hex(PALETTE[(i + k) % PALETTE.length]), h = hue(c); if (used.every(function (u) { return far(u, h); })) choice = c; }
      choice = choice || hex(PALETTE[i % PALETTE.length]); picked[l.id] = choice; used.push(hue(choice));
    });
    cache = {};
  }
  function colorFor(label) {
    if (!label) return null;
    if (cache[label.id]) return cache[label.id];
    var base = picked[label.id] || hex(label.color && label.color.bg);
    if (!base || lum(base) > .85) base = hex(PALETTE[hash(label.id || label.name) % PALETTE.length]);
    var bg = mix(base, [255, 255, 255], .84), fg = base.slice(), dot = base;
    for (var i = 0; i < 20 && ratio(fg, bg) < 4.8; i++) fg = mix(fg, [0, 0, 0], .15);
    return (cache[label.id] = { bg: toHex(bg), fg: toHex(fg), dot: toHex(dot) });
  }
  var SYSTEM = { INBOX: 1, SENT: 1, TRASH: 1, SPAM: 1, STARRED: 1, IMPORTANT: 1, UNREAD: 1, DRAFT: 1 };
  /* the user folders an email is in, in a stable order, skipping the one being viewed */
  function foldersOf(msg, labels, except) {
    var ids = (msg && msg.labels) || [];
    return labels.filter(function (l) { return !SYSTEM[l.id] && l.id !== except && ids.indexOf(l.id) >= 0; });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function chip(label) { var c = colorFor(label); return '<span class="fc-chip" style="background:' + c.bg + ';color:' + c.fg + '"><i style="background:' + c.dot + '" aria-hidden="true"></i>' + esc(label.name) + '</span>'; }
  function avatarStyle(label) { if (!label) return ''; var c = colorFor(label); return ' style="background:' + c.bg + ';color:' + c.fg + '"'; }
  window.CuepaFolders = { assign: assign, colorFor: colorFor, foldersOf: foldersOf, chip: chip, avatarStyle: avatarStyle, ratio: function (a, b) { return ratio(hex(a), hex(b)); } };
})();
