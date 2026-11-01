// Turns a plain-text email body into tidy, safe HTML for the Inbox reader:
// links become short clickable labels, "[image: …]" leftovers disappear, extra blank lines collapse.
(function (root) {
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function label(url) {
    try { const u = new URL(url); return u.hostname.replace(/^www\./, ''); } catch (e) { return 'link'; }
  }
  function link(url) {
    const tail = (url.match(/[.,;:!?)\]]+$/) || [''])[0]; url = url.slice(0, url.length - tail.length);
    if (!/^https?:\/\//i.test(url)) return esc(url + tail);
    return '<a class="ib-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(url) + '">' + esc(label(url)) + ' ↗</a>' + esc(tail);
  }
  function mailBody(text) {
    let t = String(text || '').replace(/\r\n?/g, '\n');
    // <https://...> that wrapped across lines → one URL
    t = t.replace(/<\s*(https?:\/\/[^>]*?)\s*>/gi, (m, u) => '\u0000' + u.replace(/\s+/g, '') + '\u0001');
    // a link sitting on its own line in the middle of a sentence → keep it in the sentence
    t = t.replace(/([^\n])\n(\u0000[^\u0001]*\u0001)\n(?=[a-z])/g, '$1 $2 ');
    t = t.replace(/^[ \t]*\[image:[^\]]*\][ \t]*$/gim, '').replace(/\[image:[^\]]*\]/gi, '');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    let out = '', i = 0;
    const re = /\u0000([^\u0001]*)\u0001|(https?:\/\/[^\s<>"]+)/gi; let m;
    while ((m = re.exec(t))) { out += esc(t.slice(i, m.index)) + link(m[1] || m[2]); i = re.lastIndex; }
    return out + esc(t.slice(i));
  }
  if (typeof module !== 'undefined') module.exports = mailBody; else root.mailBody = mailBody;
})(this);
