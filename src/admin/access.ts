import type { Env } from "../env";

export class AccessError extends Error {}

type Jwk = JsonWebKey & { kid?: string };
const KEY_TTL_MS = 60 * 60 * 1000;
const SKEW_S = 60;
const REFRESH_GAP_MS = 60 * 1000;
const keyCache = new Map<string, { at: number; keys: Jwk[] }>();
const lastForced = new Map<string, number>();

export function clearAccessKeyCache() {
  keyCache.clear();
  lastForced.clear();
}

async function loadKeys(team: string, force: boolean): Promise<Jwk[]> {
  const hit = keyCache.get(team);
  if (!force && hit && Date.now() - hit.at < KEY_TTL_MS) return hit.keys;
  if (force) {
    const last = lastForced.get(team);
    if (hit && last !== undefined && Date.now() - last < REFRESH_GAP_MS) return hit.keys;
    lastForced.set(team, Date.now());
  }
  let keys: Jwk[];
  try {
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(String(res.status));
    keys = ((await res.json()) as { keys: Jwk[] }).keys;
    if (!Array.isArray(keys)) throw new Error("bad certs");
  } catch {
    if (force && hit) return hit.keys;
    throw new AccessError("certs unavailable");
  }
  keyCache.set(team, { at: Date.now(), keys });
  return keys;
}

function decode(part: string): Uint8Array {
  const s = part.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

const json = (part: string) => JSON.parse(new TextDecoder().decode(decode(part)));

export async function verifyAccessJwt(
  env: Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">,
  token: string | null,
  now: Date = new Date(),
): Promise<{ email: string }> {
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new AccessError("no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessError("malformed");
  let header: { alg?: string; kid?: string };
  let claims: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: unknown };
  try {
    header = json(parts[0]);
    claims = json(parts[1]);
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object") throw 0;
  } catch {
    throw new AccessError("malformed");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AccessError("bad header");

  let keys = await loadKeys(env.ACCESS_TEAM_DOMAIN, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await loadKeys(env.ACCESS_TEAM_DOMAIN, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new AccessError("unknown key");

  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    ok = false;
  }
  if (!ok) throw new AccessError("bad signature");

  const t = Math.floor(now.getTime() / 1000);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(env.ACCESS_AUD)) throw new AccessError("bad aud");
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new AccessError("bad iss");
  if (typeof claims.exp !== "number" || claims.exp <= t - SKEW_S) throw new AccessError("expired");
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > t + SKEW_S)) throw new AccessError("not yet valid");
  if (typeof claims.email !== "string" || !claims.email) throw new AccessError("no email");
  return { email: claims.email };
}
