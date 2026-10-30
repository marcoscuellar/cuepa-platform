// Shared sign-in helpers.
// Invite list lives in the CUEPA_USERS env var: [{"email","name","ws":"<slug>"|"*","hash":"scrypt$<saltHex>$<hashHex>"}]
// "hash" there is the TEMPORARY password. Once someone sets their own password, its hash is saved
// in the private Blob store (accounts/<sha256(email)>.json) and the temporary one stops working.
const crypto = require("crypto");

const COOKIE = "cuepa_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours: everyone signs in again each day

function users() {
  try { return JSON.parse(process.env.CUEPA_USERS || "[]"); } catch (e) { return []; }
}
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is not set");
  return s;
}
function sign(data) { return crypto.createHmac("sha256", secret()).update(data).digest("base64url"); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(String(password), salt, 32).toString("hex")}`;
}
function matches(hash, password) {
  const [scheme, saltHex, hashHex] = String(hash || "").split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), want.length);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function findUser(email) {
  const e = String(email || "").trim().toLowerCase();
  return users().find(u => String(u.email).toLowerCase() === e) || null;
}

// ---- saved passwords (private Blob store) ----
function keyFor(email) {
  return "accounts/" + crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex") + ".json";
}
async function getSaved(email) {
  const { get } = await import("@vercel/blob");
  const r = await get(keyFor(email), { access: "private", useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  try { return JSON.parse(await new Response(r.stream).text()); } catch (e) { return null; }
}
async function saveHash(email, hash) {
  const { put } = await import("@vercel/blob");
  await put(keyFor(email), JSON.stringify({ hash, changedAt: new Date().toISOString() }), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json"
  });
}

// Returns { ok, temp } — temp=true means they're still on the password we sent them.
async function verify(user, password) {
  const saved = await getSaved(user.email);
  if (saved && saved.hash) return { ok: matches(saved.hash, password), temp: false };
  return { ok: matches(user.hash, password), temp: true };
}

function makeCookie(user, temp) {
  const payload = Buffer.from(JSON.stringify({ e: user.email, t: temp ? 1 : 0, x: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

function readSession(req) {
  const raw = String(req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [payload, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !mac) return null;
  const good = sign(payload);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  let s; try { s = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch (e) { return null; }
  const now = Date.now() / 1000;
  if (!s || s.x < now || s.x > now + MAX_AGE + 60) return null; // also ends older, longer sign-ins
  const u = findUser(s.e); // removed from CUEPA_USERS = signed out everywhere
  if (!u) return null;
  return { email: u.email, name: u.name, ws: u.ws, temp: !!s.t, user: u };
}

function canSee(session, ws) { return !!session && (session.ws === "*" || session.ws === ws); }
function homeOf(ws) { return ws === "*" ? "cirques-experience" : ws; }

module.exports = { findUser, matches, hashPassword, verify, saveHash, makeCookie, clearCookie, readSession, canSee, homeOf };
