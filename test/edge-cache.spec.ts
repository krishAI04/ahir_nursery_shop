import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/env";

const API = "https://api.cache.example";
const on = (extra: Partial<Env> = {}) =>
  ({ ...env, EDGE_CACHE: "on", STOREFRONT_ORIGINS: "https://shop.example, https://www.shop.example", ...extra }) as unknown as Env;
let n = 0;
const fresh = (path: string) => `${API}${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}-${n++}`; // own cache entry per test

describe("edge cache for store reads", () => {
  it("a repeat read is served from the edge copy, not recomputed", async () => {
    const url = fresh("/api/store/contact");
    const first = await (await app.request(url, {}, on({ SHOP_WHATSAPP: "911111111111" }))).json();
    const second = await (await app.request(url, {}, on({ SHOP_WHATSAPP: "922222222222" }))).json();
    expect(first).toEqual(second);
    expect((second as { whatsapp_number: string }).whatsapp_number).toBe("911111111111");
  });

  it("the site build (x-build-key) always reads fresh and does not refill the copy", async () => {
    const url = fresh("/api/store/contact");
    await app.request(url, {}, on({ SHOP_WHATSAPP: "911111111111" }));
    const build = await (await app.request(url, { headers: { "x-build-key": "anything" } }, on({ SHOP_WHATSAPP: "933333333333" }))).json();
    expect((build as { whatsapp_number: string }).whatsapp_number).toBe("933333333333");
    const later = await (await app.request(url, {}, on({ SHOP_WHATSAPP: "944444444444" }))).json();
    expect((later as { whatsapp_number: string }).whatsapp_number).toBe("911111111111");
  });

  it("errors and not-found answers are never stored", async () => {
    const url = fresh("/api/store/products/no-such-plant");
    expect((await app.request(url, {}, on())).status).toBe(404);
    expect(await caches.default.match(url)).toBeUndefined();
  });

  it("a cached answer carries CORS for the origin asking now, not the first one", async () => {
    const url = fresh("/api/store/contact");
    const a = await app.request(url, { headers: { Origin: "https://shop.example" } }, on());
    expect(a.headers.get("access-control-allow-origin")).toBe("https://shop.example");
    const b = await app.request(url, { headers: { Origin: "https://www.shop.example" } }, on());
    expect(b.headers.get("access-control-allow-origin")).toBe("https://www.shop.example");
    const c = await app.request(url, { headers: { Origin: "https://evil.example" } }, on());
    expect(c.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("only store GETs are cached: admin and health are not", async () => {
    const health = fresh("/api/health");
    await app.request(health, {}, on());
    expect(await caches.default.match(health)).toBeUndefined();
  });

  it("is off unless EDGE_CACHE is on", async () => {
    const url = fresh("/api/store/contact");
    await app.request(url, {}, on({ EDGE_CACHE: "", SHOP_WHATSAPP: "911111111111" }));
    const again = await (await app.request(url, {}, on({ EDGE_CACHE: "", SHOP_WHATSAPP: "955555555555" }))).json();
    expect((again as { whatsapp_number: string }).whatsapp_number).toBe("955555555555");
  });
});
