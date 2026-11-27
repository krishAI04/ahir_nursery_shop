import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { hashPassword } from "../src/admin/session";
import type { Env } from "../src/env";

const ADMIN = "https://admin.shop.example";
const API = "https://api.shop.example";
let prod: Env;

beforeAll(async () => {
  prod = { ...env, ADMIN_HOST: "admin.shop.example", ADMIN_USERNAME: "staff", ADMIN_PASSWORD_HASH: await hashPassword("green-mango-41") } as unknown as Env;
});

const get = (url: string, e: Env = prod, init: RequestInit = {}) => app.request(url, { redirect: "manual", ...init }, e);

describe("admin on its own host", () => {
  it("the admin host's front page opens the admin", async () => {
    const res = await get(`${ADMIN}/`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("the admin host serves the admin sign-in", async () => {
    const res = await get(`${ADMIN}/admin/products`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('action="/admin/login"');
  });

  it("sign-in works on the admin host", async () => {
    const res = await get(`${ADMIN}/admin/login`, prod, {
      method: "POST",
      body: new URLSearchParams({ username: "staff", password: "green-mango-41" }),
      headers: { "CF-Connecting-IP": "7.7.7.7", Origin: ADMIN },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toMatch(/^nc_admin=/);
  });

  it("the admin host does not serve the shop API", async () => {
    expect((await get(`${ADMIN}/api/store/categories`)).status).toBe(404);
    expect((await get(`${ADMIN}/api/health`)).status).toBe(404);
  });

  it("old admin links on the API host move to the admin host, keeping path and query", async () => {
    const res = await get(`${API}/admin/products?q=palm`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${ADMIN}/admin/products?q=palm`);
    expect((await get(`${API}/admin`)).headers.get("location")).toBe(`${ADMIN}/admin`);
  });

  it("a form post to the old admin address is refused, not forwarded", async () => {
    const res = await get(`${API}/admin/login`, prod, { method: "POST", body: new URLSearchParams({ username: "staff", password: "x" }) });
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("the API host still serves the shop API", async () => {
    expect((await get(`${API}/api/health`)).status).toBe(200);
  });

  it("local dev keeps the admin on localhost", async () => {
    expect((await get("http://localhost:8787/admin/products")).status).toBe(403);
    expect((await get("http://127.0.0.1:8787/api/health")).status).toBe(200);
  });

  it("without ADMIN_HOST everything stays on one host", async () => {
    const single = { ...prod, ADMIN_HOST: "" } as Env;
    expect((await get(`${API}/admin/products`, single)).status).toBe(403);
    expect((await get(`${API}/api/health`, single)).status).toBe(200);
  });
});
