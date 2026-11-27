import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { admin } from "../src/admin/index";
import { clientKey } from "../src/admin/login";
import { hashPassword, newSession, sessionOk, verifyPassword } from "../src/admin/session";
import type { Env } from "../src/env";

const PASSWORD = "green-mango-41";
const BASE = "https://shop.example";
let prod: Env;

beforeAll(async () => {
  prod = { ...env, ENVIRONMENT: "production", ADMIN_USERNAME: "staff", ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD) } as unknown as Env;
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM login_failures").run();
});

const login = (username: string, password: string, e: Env = prod, headers: Record<string, string> = {}) =>
  app.request(
    `${BASE}/admin/login`,
    { method: "POST", body: new URLSearchParams({ username, password }), headers: { "CF-Connecting-IP": "1.2.3.4", ...headers } },
    e,
  );
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("secret-123");
    expect(h).toMatch(/^pbkdf2-sha256\$20000\$/);
    expect(await verifyPassword("secret-123", h)).toBe(true);
    expect(await verifyPassword("secret-124", h)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects empty or malformed stored hashes", async () => {
    for (const bad of ["", "plain", "pbkdf2-sha256$100000$", "md5$1$a$b", "pbkdf2-sha256$9999999$AA==$AA=="]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });
});

describe("sessions", () => {
  it("accepts a fresh session and refuses an expired, tampered or re-keyed one", async () => {
    const now = Date.UTC(2026, 10, 27, 10);
    const s = await newSession(prod, now);
    expect(await sessionOk(prod, s, now + 60_000)).toBe(true);
    expect(await sessionOk(prod, s, now + 13 * 3600_000)).toBe(false);
    expect(await sessionOk(prod, s.replace(/.$/, (ch) => (ch === "A" ? "B" : "A")), now)).toBe(false);
    expect(await sessionOk({ ...prod, ADMIN_PASSWORD_HASH: await hashPassword("new-one") }, s, now)).toBe(false);
    expect(await sessionOk({ ...prod, ADMIN_USERNAME: "other" }, s, now)).toBe(false);
    expect(await sessionOk(prod, null, now)).toBe(false);
    expect(await sessionOk({ ...prod, ADMIN_PASSWORD_HASH: "" }, s, now)).toBe(false);
  });
});

describe("admin login", () => {
  it("shows the sign-in form on any admin page without a session", async () => {
    const res = await app.request(`${BASE}/admin/products`, {}, prod);
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('action="/admin/login"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
  });

  it("signs in with the right username and password and the cookie opens admin pages", async () => {
    const res = await login("staff", PASSWORD);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/products");
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^nc_admin=/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/admin", "Max-Age=43200"]) expect(set).toContain(attr);

    const page = await app.request(`${BASE}/admin/help`, { headers: { Cookie: cookieOf(res) } }, prod);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Signed in as staff");
  });

  it("username is not case or space sensitive, password is", async () => {
    expect((await login(" Staff ", PASSWORD)).status).toBe(303);
    expect((await login("staff", PASSWORD.toUpperCase())).status).toBe(401);
  });

  it("refuses a wrong password or username without a cookie", async () => {
    for (const [u, p] of [["staff", "nope"], ["owner", PASSWORD], ["", ""]] as const) {
      const res = await login(u, p);
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toContain("Wrong username or password");
    }
  });

  it("refuses everyone while no password is set", async () => {
    const res = await login("staff", "", { ...prod, ADMIN_PASSWORD_HASH: "" } as Env);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("locks an address out after 10 wrong tries in 15 minutes, even with the right password", async () => {
    for (let i = 0; i < 10; i++) expect((await login("staff", "wrong")).status).toBe(401);
    const locked = await login("staff", PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("set-cookie")).toBeNull();
    expect((await login("staff", PASSWORD, prod, { "CF-Connecting-IP": "5.6.7.8" })).status).toBe(303);
  });

  it("old failures outside the window do not count", async () => {
    const old = Math.floor(Date.now() / 1000) - 16 * 60;
    for (let i = 0; i < 10; i++) await env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind("1.2.3.4", old).run();
    expect((await login("staff", PASSWORD)).status).toBe(303);
  });

  it("a good sign-in clears that address's failures", async () => {
    for (let i = 0; i < 9; i++) await login("staff", "wrong");
    expect((await login("staff", PASSWORD)).status).toBe(303);
    for (let i = 0; i < 9; i++) expect((await login("staff", "wrong")).status).toBe(401);
  });

  it("refuses a sign-in posted from another site", async () => {
    expect((await login("staff", PASSWORD, prod, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await login("staff", PASSWORD, prod, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  });

  it("refuses a tampered cookie", async () => {
    const good = cookieOf(await login("staff", PASSWORD));
    const res = await app.request(`${BASE}/admin/help`, { headers: { Cookie: good.slice(0, -2) + "xx" } }, prod);
    expect(res.status).toBe(403);
  });

  it("sign out clears the cookie", async () => {
    const cookie = cookieOf(await login("staff", PASSWORD));
    const res = await app.request(`${BASE}/admin/logout`, { method: "POST", headers: { Cookie: cookie } }, prod);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    expect(res.headers.get("set-cookie")).toMatch(/^nc_admin=;.*Max-Age=0/);
  });

  it("the help page offers sign out", async () => {
    const cookie = cookieOf(await login("staff", PASSWORD));
    const html = await (await app.request(`${BASE}/admin/help`, { headers: { Cookie: cookie } }, prod)).text();
    expect(html).toContain('action="/admin/logout"');
  });

  it("parallel wrong guesses can't all slip under the limit", async () => {
    const res = await Promise.all(Array.from({ length: 15 }, () => login("staff", "wrong")));
    expect(res.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(5);
    expect((await login("staff", PASSWORD)).status).toBe(429);
  });

  it("counts IPv6 addresses by their /64", async () => {
    expect(clientKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:0db8:0001:0002:ffff:1:2:3")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("1.2.3.4")).toBe("1.2.3.4");
    expect(clientKey(undefined)).toBe("unknown");
    for (let i = 0; i < 10; i++) await login("staff", "wrong", prod, { "CF-Connecting-IP": `2001:db8:1:2::${i + 1}` });
    expect((await login("staff", PASSWORD, prod, { "CF-Connecting-IP": "2001:db8:1:2:ffff::9" })).status).toBe(429);
  });

  it("stops all sign-ins after 100 wrong tries from many addresses in 15 minutes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = Array.from({ length: 100 }, (_, i) => env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(`10.0.0.${i}`, now));
    await env.DB.batch(rows);
    expect((await login("staff", PASSWORD, prod, { "CF-Connecting-IP": "9.9.9.9" })).status).toBe(429);
  });

  it("POST /admin/login is the only admin route outside the protected sub-app", () => {
    const outside = app.routes.filter((r) => r.path.startsWith("/admin") && !admin.routes.some((a) => a.path === r.path && a.method === r.method));
    expect(outside.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /admin/login"]);
  });
});
