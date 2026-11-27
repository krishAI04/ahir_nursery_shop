import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { hashPassword } from "../src/admin/session";
import type { Env } from "../src/env";

const BASE = "https://admin.shop.example";
let prod: Env;
let cookie = "";

beforeAll(async () => {
  prod = {
    ...env,
    ADMIN_USERNAME: "staff",
    ADMIN_PASSWORD_HASH: await hashPassword("green-mango-41"),
    IMAGE_BASE_URL: "https://api.shop.example/img/",
  } as unknown as Env;
  await env.DB.prepare("DELETE FROM login_failures").run();
  const res = await app.request(
    `${BASE}/admin/login`,
    { method: "POST", body: new URLSearchParams({ username: "staff", password: "green-mango-41" }), headers: { "CF-Connecting-IP": "8.8.8.8" } },
    prod,
  );
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
});

const csp = (res: Response) => res.headers.get("content-security-policy") ?? "";

describe("admin Content-Security-Policy", () => {
  it("every admin page script carries the nonce the policy allows, and no other script runs", async () => {
    for (const path of ["/admin/products", "/admin/help", "/admin/publish"]) {
      const res = await app.request(`${BASE}${path}`, { headers: { Cookie: cookie } }, prod);
      expect(res.status).toBe(200);
      const policy = csp(res);
      const nonce = policy.match(/script-src 'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
      expect(nonce, path).toBeTruthy();
      expect(policy).not.toContain("unsafe-inline' 'nonce"); // scripts: nonce only
      expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
      const html = await res.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length, path).toBeGreaterThan(0);
      for (const s of scripts) expect(s, path).toContain(`nonce="${nonce}"`);
    }
  });

  it("each response gets a fresh nonce", async () => {
    const a = csp(await app.request(`${BASE}/admin/help`, { headers: { Cookie: cookie } }, prod));
    const b = csp(await app.request(`${BASE}/admin/help`, { headers: { Cookie: cookie } }, prod));
    expect(a).not.toBe(b);
  });

  it("the policy blocks framing, plugins, base tags and off-site forms, and allows photos from the image host", async () => {
    const policy = csp(await app.request(`${BASE}/admin/products`, { headers: { Cookie: cookie } }, prod));
    for (const part of ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "connect-src 'self'"]) {
      expect(policy).toContain(part);
    }
    expect(policy).toMatch(/img-src [^;]*https:\/\/api\.shop\.example/);
    expect(policy).toMatch(/img-src [^;]*blob:/);
    expect(policy).toMatch(/font-src [^;]*https:\/\/fonts\.gstatic\.com/);
    expect(policy).toMatch(/style-src [^;]*https:\/\/fonts\.googleapis\.com/);
  });

  it("the sign-in page allows no scripts at all", async () => {
    const res = await app.request(`${BASE}/admin/products`, {}, prod);
    expect(res.status).toBe(403);
    expect(csp(res)).toContain("script-src 'none'");
    expect(csp(res)).toContain("frame-ancestors 'none'");
  });

  it("admin responses say not to sniff content types", async () => {
    const res = await app.request(`${BASE}/admin/help`, { headers: { Cookie: cookie } }, prod);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("unexpected errors", () => {
  const broken = () => ({ ...prod, DB: undefined }) as unknown as Env;

  it("a store API failure answers a plain JSON 500 without details", async () => {
    const res = await app.request("https://api.shop.example/api/store/products/x", {}, broken());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("an admin failure answers a short message that is never cached", async () => {
    const res = await app.request(`${BASE}/admin/products`, { headers: { Cookie: cookie } }, broken());
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("Something went wrong");
    expect(body).not.toMatch(/TypeError|at |\.ts/);
  });
});
