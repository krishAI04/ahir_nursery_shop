import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AccessError, clearAccessKeyCache, verifyAccessJwt } from "../src/admin/access";
import { Hono } from "hono";
import { admin, requireStaff, type AdminEnv } from "../src/admin/index";
import type { Env } from "../src/env";

const TEAM = "team.test";
const AUD = "aud-123";
const KID = "kid-1";
const NOW = new Date("2026-11-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? enc.encode(buf) : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const algo = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

async function sign(
  priv: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" },
) {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}

let good: CryptoKeyPair;
let other: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

const env = (over: Partial<Env> = {}) =>
  ({ ENVIRONMENT: "production", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...over }) as Env;

const claims = (over: Record<string, unknown> = {}) => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  exp: nowSec + 600,
  email: "staff@example.com",
  ...over,
});

beforeAll(async () => {
  good = (await crypto.subtle.generateKey(algo, true, ["sign", "verify"])) as CryptoKeyPair;
  other = (await crypto.subtle.generateKey(algo, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = { ...((await crypto.subtle.exportKey("jwk", good.publicKey)) as JsonWebKey), kid: KID, alg: "RS256" } as typeof publicJwk;
});

function mockCerts() {
  const f = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessKeyCache();
});

describe("verifyAccessJwt", () => {
  it("returns the email for a valid token", async () => {
    mockCerts();
    const token = await sign(good.privateKey, claims());
    expect(await verifyAccessJwt(env(), token, NOW)).toEqual({ email: "staff@example.com" });
  });

  it("accepts aud given as a string", async () => {
    mockCerts();
    const token = await sign(good.privateKey, claims({ aud: AUD }));
    expect((await verifyAccessJwt(env(), token, NOW)).email).toBe("staff@example.com");
  });

  it("caches the certs between calls", async () => {
    const f = mockCerts();
    const token = await sign(good.privateKey, claims());
    await verifyAccessJwt(env(), token, NOW);
    await verifyAccessJwt(env(), token, NOW);
    expect(f).toHaveBeenCalledTimes(1);
  });

  const bad: [string, () => Promise<string | null>][] = [
    ["wrong aud", () => sign(good.privateKey, claims({ aud: ["other"] }))],
    ["expired", () => sign(good.privateKey, claims({ exp: nowSec - 120 }))],
    ["wrong issuer", () => sign(good.privateKey, claims({ iss: "https://evil.test" }))],
    ["other key signature", () => sign(other.privateKey, claims())],
    ["not yet valid", () => sign(good.privateKey, claims({ nbf: nowSec + 600 }))],
    ["no email", () => sign(good.privateKey, claims({ email: undefined }))],
    ["wrong alg", () => sign(good.privateKey, claims(), { alg: "HS256", kid: KID })],
    ["unknown kid", () => sign(good.privateKey, claims(), { alg: "RS256", kid: "nope" })],
    ["garbage", async () => "not.a.jwt"],
    ["missing", async () => null],
  ];
  for (const [name, make] of bad) {
    it(`rejects ${name}`, async () => {
      mockCerts();
      await expect(verifyAccessJwt(env(), await make(), NOW)).rejects.toBeInstanceOf(AccessError);
    });
  }

  it("rejects when the certs fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const token = await sign(good.privateKey, claims());
    await expect(verifyAccessJwt(env(), token, NOW)).rejects.toBeInstanceOf(AccessError);
  });
});

describe("requireStaff on /admin", () => {
  it("development: no header needed, home redirects to products", async () => {
    const res = await admin.request("/admin", {}, env({ ENVIRONMENT: "development" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/products");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("/admin/ with a trailing slash also opens products, and still needs a login in production", async () => {
    const res = await admin.request("/admin/", {}, env({ ENVIRONMENT: "development" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/products");
    mockCerts();
    expect((await admin.request("/admin/", {}, env())).status).toBe(403);
  });

  it("production: missing header gives 403 plain page", async () => {
    mockCerts();
    const res = await admin.request("/admin", {}, env());
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain('action="/admin/login"');
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("missing ENVIRONMENT is enforced like production", async () => {
    const res = await admin.request("/admin", {}, env({ ENVIRONMENT: undefined as unknown as string }));
    expect(res.status).toBe(403);
  });

  it("production: valid token passes (real clock window)", async () => {
    mockCerts();
    const token = await sign(good.privateKey, claims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    const res = await admin.request("/admin", { headers: { "Cf-Access-Jwt-Assertion": token } }, env());
    expect(res.status).toBe(302);
  });

  it("production: bad token gives 403", async () => {
    mockCerts();
    const token = await sign(other.privateKey, claims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    const res = await admin.request("/admin", { headers: { "Cf-Access-Jwt-Assertion": token } }, env());
    expect(res.status).toBe(403);
  });
});

describe("Layout", () => {
  it("renders viewport, nav and staff email", async () => {
    const { Layout } = await import("../src/admin/layout");
    const html = String(<Layout title="Orders" email="dev@local">hi</Layout>);
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1"');
    expect(html).not.toContain('href="/admin/orders"');
    expect(html).toContain('href="/admin/products"');
    expect(html).toContain('href="/admin/products?filter=needs-photo"');
    expect(html).toContain("dev@local");
  });
});

describe("fix round 1", () => {
  it("default test env (production) denies /admin/products via the real app", async () => {
    const { app } = await import("../src/index");
    const res = await app.request("/admin/products", {}, env({ ENVIRONMENT: "production" }));
    expect(res.status).toBe(403);
    const res2 = await app.request("/admin/x", {}, env());
    expect(res2.status).toBe(403);
  });

  it("vitest binding ENVIRONMENT is production", async () => {
    const { env: bound } = await import("cloudflare:test");
    expect((bound as unknown as Env).ENVIRONMENT).toBe("production");
  });

  it("dev bypass only on localhost hosts", async () => {
    const dev = env({ ENVIRONMENT: "development" });
    expect((await admin.request("http://workers.example.dev/admin", {}, dev)).status).toBe(403);
    expect((await admin.request("http://127.0.0.1:8787/admin", {}, dev)).status).toBe(302);
    expect((await admin.request("http://localhost:8787/admin", {}, dev)).status).toBe(302);
  });

  it("wrong-case Development is enforced", async () => {
    const res = await admin.request("/admin", {}, env({ ENVIRONMENT: "Development" }));
    expect(res.status).toBe(403);
  });

  it("raw Response handlers keep the security headers", async () => {
    const rawApp = new Hono<AdminEnv>();
    rawApp.use("/admin/*", requireStaff());
    rawApp.get("/admin/raw", () => new Response("x"));
    const res = await rawApp.request("/admin/raw", {}, env({ ENVIRONMENT: "development" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("refreshes keys on unknown kid at most once per 60 s, keeps cache on failed refresh", async () => {
    const f = mockCerts();
    const unknown = await sign(good.privateKey, claims(), { alg: "RS256", kid: "nope" });
    const e = env();
    await expect(verifyAccessJwt(e, unknown, NOW)).rejects.toBeInstanceOf(AccessError);
    await expect(verifyAccessJwt(e, unknown, NOW)).rejects.toBeInstanceOf(AccessError);
    await expect(verifyAccessJwt(e, unknown, NOW)).rejects.toBeInstanceOf(AccessError);
    // initial load + one forced refresh only
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("failed forced refresh keeps cached keys usable", async () => {
    mockCerts();
    const e = env();
    const ok = await sign(good.privateKey, claims());
    await verifyAccessJwt(e, ok, NOW);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const unknown = await sign(good.privateKey, claims(), { alg: "RS256", kid: "nope" });
    await expect(verifyAccessJwt(e, unknown, NOW)).rejects.toBeInstanceOf(AccessError);
    expect((await verifyAccessJwt(e, ok, NOW)).email).toBe("staff@example.com");
  });

  it("non-object header/claims give AccessError", async () => {
    mockCerts();
    const mk = (h: string, p: string) => `${b64url(h)}.${b64url(p)}.${b64url("sig")}`;
    for (const t of [mk("null", "{}"), mk("42", "{}"), mk('{"alg":"RS256","kid":"kid-1"}', "null"), mk('{"alg":"RS256","kid":"kid-1"}', "7")]) {
      await expect(verifyAccessJwt(env(), t, NOW)).rejects.toBeInstanceOf(AccessError);
    }
  });

  it("string nbf is rejected", async () => {
    mockCerts();
    const token = await sign(good.privateKey, claims({ nbf: "0" }));
    await expect(verifyAccessJwt(env(), token, NOW)).rejects.toBeInstanceOf(AccessError);
  });
});

describe("final fix wave: JWKS refresh throttle", () => {
  it("allows another forced refresh once 60 s have passed", async () => {
    const f = mockCerts();
    let clock = Date.parse("2026-11-20T12:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const unknown = await sign(good.privateKey, claims(), { alg: "RS256", kid: "nope" });
    const e = env();
    await expect(verifyAccessJwt(e, unknown, NOW)).rejects.toBeInstanceOf(AccessError);
    expect(f).toHaveBeenCalledTimes(2); // initial load + forced refresh
    clock += 59_000;
    await expect(verifyAccessJwt(e, unknown, NOW)).rejects.toBeInstanceOf(AccessError);
    expect(f).toHaveBeenCalledTimes(2); // still throttled
    clock += 2_000;
    await expect(verifyAccessJwt(e, unknown, NOW)).rejects.toBeInstanceOf(AccessError);
    expect(f).toHaveBeenCalledTimes(3); // 61 s later: refetched
    vi.restoreAllMocks();
  });
});
