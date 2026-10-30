const { findUser, matches, hashPassword, verify, saveHash, makeCookie, clearCookie, readSession, homeOf } = require("./_session");

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

module.exports = async (req, res) => {
  const action = new URL(req.url, "http://x").searchParams.get("action");
  try {
    if (action === "login" && req.method === "POST") {
      const { email, password } = await readBody(req);
      const user = findUser(email);
      if (!user) { matches("scrypt$00$" + "00".repeat(32), password); return json(res, 401, { ok: false, error: WRONG }); }
      const v = await verify(user, password);
      if (!v.ok) return json(res, 401, { ok: false, error: WRONG });
      return json(res, 200, { ok: true, name: user.name, ws: homeOf(user.ws), temp: v.temp }, makeCookie(user, v.temp));
    }

    if (action === "set-password" && req.method === "POST") {
      const s = readSession(req);
      if (!s) return json(res, 401, { ok: false, error: "Please sign in again." });
      const { current, next } = await readBody(req);
      const v = await verify(s.user, current);
      if (!v.ok) return json(res, 400, { ok: false, error: "Your current password isn't right." });
      const pw = String(next || "");
      if (pw.length < 8) return json(res, 400, { ok: false, error: "Use at least 8 characters." });
      if (pw === String(current)) return json(res, 400, { ok: false, error: "Pick a password that's different from the one we sent you." });
      await saveHash(s.email, hashPassword(pw));
      return json(res, 200, { ok: true, ws: homeOf(s.ws) }, makeCookie(s.user, false));
    }

    if (action === "logout") {
      const s = readSession(req);
      res.statusCode = 302;
      res.setHeader("Set-Cookie", clearCookie());
      res.setHeader("Location", "/?signedout=1" + (s && s.ws !== "*" ? "&next=/" + s.ws : ""));
      return res.end();
    }

    if (action === "me") {
      const s = readSession(req);
      if (!s) return json(res, 401, { ok: false });
      return json(res, 200, { ok: true, name: s.name, ws: homeOf(s.ws), temp: s.temp });
    }

    return json(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    console.error("auth error", action, e && e.message);
    return json(res, 500, { ok: false, error: "Sign-in is unavailable right now. Please try again in a minute." });
  }
};
