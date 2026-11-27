import { Hono, type Context } from "hono";
import { setCookie } from "hono/cookie";
import type { Env } from "../env";
import { SESSION_COOKIE, SESSION_S, crossSitePost, loginPage, newSession, setSecurityHeaders, verifyPassword } from "./session";

// The one admin route that works without a session, so it lives outside the `admin` sub-app.
export const adminLogin = new Hono<{ Bindings: Env }>();

const MAX_FAILS = 10; // per address
const MAX_FAILS_ALL = 100; // across all addresses, against guessing from many IPs
const WINDOW_S = 15 * 60;

/** IPv6 users own a whole /64, so count them by it. */
export function clientKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const page = (c: Context, message: string, status: 401 | 403 | 429) => {
  const res = c.html(loginPage(message), status);
  setSecurityHeaders(res.headers);
  return res;
};

adminLogin.post("/admin/login", async (c) => {
  if (crossSitePost(c)) return page(c, "Please sign in from this page.", 403);
  const ip = clientKey(c.req.header("CF-Connecting-IP"));
  const nowS = Math.floor(Date.now() / 1000);
  const db = c.env.DB;

  // Record the attempt first, then count it, so parallel guesses can't all slip under the limit.
  const [ins, , mine, all] = await db.batch<{ n: number }>([
    db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?) RETURNING id").bind(ip, nowS),
    db.prepare("DELETE FROM login_failures WHERE at <= ?").bind(nowS - 24 * 60 * 60),
    db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?").bind(ip, nowS - WINDOW_S),
    db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE at > ?").bind(nowS - WINDOW_S),
  ]);
  const attemptId = (ins!.results[0] as unknown as { id: number }).id;
  if (mine!.results[0]!.n > MAX_FAILS || all!.results[0]!.n > MAX_FAILS_ALL) {
    return page(c, "Too many wrong tries. Wait 15 minutes, then try again.", 429);
  }

  const form = await c.req.parseBody();
  const username = String(form.username ?? "").trim().toLowerCase();
  const password = String(form.password ?? "");
  const hash = c.env.ADMIN_PASSWORD_HASH ?? "";
  // Check the password even when the username is wrong, so both take the same time.
  const passwordOk = await verifyPassword(password, hash);
  if (!passwordOk || !c.env.ADMIN_USERNAME || username !== c.env.ADMIN_USERNAME.toLowerCase()) {
    return page(c, "Wrong username or password.", 401); // the attempt row stays as a failure
  }

  await db.batch([
    db.prepare("DELETE FROM login_failures WHERE id = ?").bind(attemptId),
    db.prepare("DELETE FROM login_failures WHERE ip = ?").bind(ip),
  ]);
  setCookie(c, SESSION_COOKIE, await newSession(c.env), { httpOnly: true, secure: true, sameSite: "Strict", path: "/admin", maxAge: SESSION_S });
  const res = c.redirect("/admin/products", 303);
  setSecurityHeaders(res.headers);
  return res;
});
