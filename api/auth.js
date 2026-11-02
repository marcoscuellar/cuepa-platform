const { hasToured, markToured, findUser, matches, hashPassword, verify, saveHash, makeCookie, clearCookie, readSessionChecked, homeOf } = require("./_session");

function json(res, code, body, cookie) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise(resolve => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let data = "";
    req.on("data", c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); } });
  });
}
const WRONG = "That email and password don't match. Try again.";

// Sign-in throttle: after 8 wrong tries from one email or one address, wait 15 minutes.
// Kept in memory, so each server instance counts on its own: it slows guessing a lot but is not a hard global cap.
const FAILS = new Map(), MAX_FAILS = 8, WINDOW = 15 * 60 * 1000;
function throttleKeys(req, email) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  return ["e:" + String(email || "").trim().toLowerCase(), "i:" + ip];
}
function locked(keys) {
  const now = Date.now();
  for (const [k, v] of FAILS) if (now - v.at > WINDOW) FAILS.delete(k);
  return keys.some(k => (FAILS.get(k) || { n: 0 }).n >= MAX_FAILS);
}
function noteFail(keys) { for (const k of keys) { const v = FAILS.get(k) || { n: 0 }; FAILS.set(k, { n: v.n + 1, at: Date.now() }); } }
function clearFails(keys) { FAILS.delete(keys[0]); }
const WAIT = "Too many tries. Please wait 15 minutes and try again.";

module.exports = async (req, res) => {
  const action = new URL(req.url, "http://x").searchParams.get("action");
  try {
    // Browsers say where a request came from. Refuse sign-in / password changes started from another site.
    if (req.method === "POST") {
      const o = req.headers.origin; let same = true;
      if (o) { try { same = new URL(o).host === (req.headers["x-forwarded-host"] || req.headers.host); } catch (e) { same = false; } }
      if (!same) return json(res, 403, { ok: false, error: "Please use the CUEPA sign-in page." });
    }
    if (action === "login" && req.method === "POST") {
      const { email, password } = await readBody(req);
      const keys = throttleKeys(req, email);
      if (locked(keys)) return json(res, 429, { ok: false, error: WAIT });
      const user = findUser(email);
      if (!user) { noteFail(keys); return json(res, 401, { ok: false, error: WRONG }); }
      const v = await verify(user, password);
      if (!v.ok) { noteFail(keys); return json(res, 401, { ok: false, error: WRONG }); }
      clearFails(keys);
      return json(res, 200, { ok: true, name: user.name, ws: homeOf(user.ws), temp: v.temp }, makeCookie(user, v.temp));
    }

    if (action === "set-password" && req.method === "POST") {
      const s = await readSessionChecked(req);
      if (!s) return json(res, 401, { ok: false, error: "Please sign in again." });
      const { current, next } = await readBody(req);
      const keys = ["e:" + s.email.toLowerCase()];
      if (locked(keys)) return json(res, 429, { ok: false, error: WAIT });
      const v = await verify(s.user, current);
      if (!v.ok) { noteFail(keys); return json(res, 400, { ok: false, error: "Your current password isn't right." }); }
      const pw = String(next || "");
      if (pw.length < 8) return json(res, 400, { ok: false, error: "Use at least 8 characters." });
      if (pw === String(current)) return json(res, 400, { ok: false, error: "Pick a password that's different from the one we sent you." });
      await saveHash(s.email, hashPassword(pw));
      return json(res, 200, { ok: true, ws: homeOf(s.ws) }, makeCookie(s.user, false));
    }

    if (action === "logout") {
      // A link on another website must not be able to sign someone out.
      if (req.headers["sec-fetch-site"] === "cross-site") { res.statusCode = 302; res.setHeader("Location", "/"); return res.end(); }
      const s = await readSessionChecked(req);
      res.statusCode = 302;
      res.setHeader("Set-Cookie", clearCookie());
      res.setHeader("Location", "/?signedout=1" + (s && s.ws !== "*" ? "&next=/" + s.ws : ""));
      return res.end();
    }

    if (action === "me") {
      const s = await readSessionChecked(req);
      if (!s) return json(res, 401, { ok: false });
      return json(res, 200, { ok: true, name: s.name, ws: homeOf(s.ws), temp: s.temp });
    }

    // First-time tour: has this person seen it yet? (GET) / they finished or skipped it (POST)
    if (action === "tour") {
      const s = await readSessionChecked(req);
      if (!s) return json(res, 401, { ok: false });
      if (req.method === "POST") { await markToured(s.email); return json(res, 200, { ok: true, toured: true }); }
      let toured = true; try { toured = await hasToured(s.email); } catch (e) { toured = true; } // if unsure, don't block their day
      return json(res, 200, { ok: true, toured });
    }

    return json(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    console.error("auth error", action, e && e.message);
    return json(res, 500, { ok: false, error: "Sign-in is unavailable right now. Please try again in a minute." });
  }
};
