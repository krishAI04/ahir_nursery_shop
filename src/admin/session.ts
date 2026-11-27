import type { Context } from "hono";
import type { Env } from "../env";

// Staff sign in with one shared username and password. The Worker keeps only a salted PBKDF2 hash
// (secret ADMIN_PASSWORD_HASH, made by `npm run admin-password`). Sessions are a signed cookie keyed
// on that hash, so changing the password signs everyone out.

type AuthEnv = Pick<Env, "ADMIN_USERNAME" | "ADMIN_PASSWORD_HASH">;

export const SESSION_COOKIE = "nc_admin";
export const SESSION_S = 12 * 60 * 60;
// 20k rounds keeps one sign-in inside the free plan's 10 ms CPU budget; the lockout and a 12+ character
// password make up for the lower count. verifyPassword still accepts up to the Workers maximum of 100k.
const ITERATIONS = 20_000;
const MAX_ITERATIONS = 100_000;
const enc = new TextEncoder();

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  const n = Number(iter);
  if (algo !== "pbkdf2-sha256" || !salt || !hash || !Number.isInteger(n) || n < 1 || n > MAX_ITERATIONS) return false;
  try {
    return same(await derive(password, unb64(salt), n), unb64(hash));
  } catch {
    return false;
  }
}

async function sign(env: AuthEnv, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.ADMIN_PASSWORD_HASH), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${env.ADMIN_USERNAME}.${exp}`))));
}

export async function newSession(env: AuthEnv, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_S;
  return `${exp}.${await sign(env, exp)}`;
}

export async function sessionOk(env: AuthEnv, value: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!value || !env.ADMIN_PASSWORD_HASH || !env.ADMIN_USERNAME) return false;
  const [exp, sig] = value.split(".");
  const e = Number(exp);
  if (!sig || !Number.isInteger(e) || e * 1000 <= now) return false;
  return same(enc.encode(await sign(env, e)), enc.encode(sig));
}

/** A state-changing request from another site (cookies ride along on cross-site top-level POSTs). */
export function crossSitePost(c: Context): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return false;
  const origin = c.req.header("Origin");
  return (origin !== undefined && origin !== new URL(c.req.url).origin) || c.req.header("Sec-Fetch-Site") === "cross-site";
}

/** Every admin response: never cached, never framed, no referrer to other sites. */
export const setSecurityHeaders = (h: Headers) => {
  h.set("Cache-Control", "no-store");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "same-origin");
};

export const loginPage = (message?: string) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title>` +
  `<style>body{font:18px system-ui;margin:0;padding:24px;display:flex;justify-content:center}form{width:100%;max-width:340px;display:grid;gap:12px}` +
  `input,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #999}button{background:#2f6b3a;color:#fff;border:0}p{margin:0}.err{color:#b00020}</style></head>` +
  `<body><form method="post" action="/admin/login"><h1 style="margin:0">Nature Care admin</h1>` +
  (message ? `<p class="err" role="alert">${message}</p>` : "") +
  `<label>Username<br><input name="username" autocomplete="username" autocapitalize="none" required style="width:100%;box-sizing:border-box"></label>` +
  `<label>Password<br><input name="password" type="password" autocomplete="current-password" required style="width:100%;box-sizing:border-box"></label>` +
  `<button type="submit">Sign in</button></form></body></html>`;
