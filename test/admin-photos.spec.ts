import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { eq, asc } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { admin } from "../src/admin/index";
import type { Env } from "../src/env";

const d = () => db(env);
const NOW = "2026-11-20T00:00:00.000Z";
const devEnv = { ...env, ENVIRONMENT: "development" } as unknown as Env;
const BASE = "http://localhost";
const get = (path: string) => admin.request(`${BASE}${path}`, {}, devEnv);
const post = (path: string, form: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  admin.request(
    `${BASE}${path}`,
    { method: "POST", body: new URLSearchParams(form), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } },
    devEnv,
  );
const put = (path: string, body: BodyInit | null, headers: Record<string, string>) =>
  admin.request(`${BASE}${path}`, { method: "PUT", body, headers }, devEnv);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function prod(handle: string, status = "draft") {
  const [p] = await d().insert(s.products).values({ handle, title: handle, status, createdAt: NOW, updatedAt: NOW }).returning();
  return p!;
}
async function img(productId: number, key: string, position: number) {
  await env.PHOTOS.put(key, "x");
  const [i] = await d().insert(s.productImages).values({ productId, r2Key: key, position }).returning();
  return i!;
}
const imagesOf = (pid: number) => d().select().from(s.productImages).where(eq(s.productImages.productId, pid)).orderBy(asc(s.productImages.position));

describe("admin photos", () => {
  beforeEach(async () => {
    const { objects } = await env.PHOTOS.list();
    for (const o of objects) await env.PHOTOS.delete(o.key);
    for (const t of [s.orderStatusLog, s.refunds, s.orderItems, s.orders, s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });

  it("uploads a JPEG to R2 and appends a row", async () => {
    const p = await prod("rose");
    await img(p.id, "old.jpg", 1);
    const res = await put(`/admin/products/${p.id}/photos`, JPEG, { "content-type": "image/jpeg", "content-length": String(JPEG.length) });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; id: number; position: number };
    expect(j.ok).toBe(true);
    expect(j.position).toBe(2);
    const rows = await imagesOf(p.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.r2Key).toMatch(/^products\/rose\/[0-9a-f-]{36}\.jpg$/);
    const obj = await env.PHOTOS.get(rows[1]!.r2Key);
    expect(obj?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(JPEG);
  });

  it("refuses non-image types, missing length, unknown products and cross-site PUT", async () => {
    const p = await prod("rose");
    const h = { "content-length": "8" };
    expect((await put(`/admin/products/${p.id}/photos`, JPEG, { ...h, "content-type": "text/plain" })).status).toBe(415);
    expect((await put(`/admin/products/${p.id}/photos`, JPEG, { ...h, "content-type": "image/jpeg; charset=x" })).status).toBe(415);
    expect((await put(`/admin/products/${p.id}/photos`, JPEG, { "content-type": "image/jpeg" })).status).toBe(411);
    expect((await put(`/admin/products/9999/photos`, JPEG, { ...h, "content-type": "image/jpeg" })).status).toBe(404);
    expect((await put(`/admin/products/${p.id}/photos`, JPEG, { ...h, "content-type": "image/jpeg", Origin: "https://evil.example" })).status).toBe(403);
    expect(await imagesOf(p.id)).toHaveLength(0);
  });

  it("refuses a body over 5 MB without writing", async () => {
    const p = await prod("rose");
    const res = await put(`/admin/products/${p.id}/photos`, new Uint8Array(5 * 1024 * 1024 + 1), {
      "content-type": "image/png",
      "content-length": String(5 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(await imagesOf(p.id)).toHaveLength(0);
    expect((await env.PHOTOS.list({ prefix: "products/" })).objects).toHaveLength(0);
  });

  it("refuses a body that does not match its Content-Length, writing nothing", async () => {
    const p = await prod("rose");
    for (const [len, size] of [[4, 8], [16, 8]] as const) {
      const req = new Request(`${BASE}/admin/products/${p.id}/photos`, {
        method: "PUT",
        body: new Uint8Array(size),
        headers: { "content-type": "image/jpeg", "content-length": String(len) },
      });
      const res = await admin.fetch(req, devEnv);
      await res.text();
      expect(res.status).toBe(413);
      expect(await imagesOf(p.id)).toHaveLength(0);
      expect((await env.PHOTOS.list({ prefix: "products/" })).objects).toHaveLength(0);
    }
  });

  it("refuses a zero-length body", async () => {
    const p = await prod("rose");
    const res = await put(`/admin/products/${p.id}/photos`, new Uint8Array(0), { "content-type": "image/jpeg", "content-length": "0" });
    expect(res.status).toBe(400);
  });

  it("removes the stored object if the row insert fails", async () => {
    const p = await prod("rose");
    const failing = {
      ...devEnv,
      DB: { prepare: (sql: string) => (sql.includes("INSERT INTO product_images") ? (() => { throw new Error("boom"); })() : env.DB.prepare(sql)) },
    } as unknown as Env;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await admin.request(`${BASE}/admin/products/${p.id}/photos`, { method: "PUT", body: JPEG, headers: { "content-type": "image/jpeg", "content-length": "8" } }, failing);
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect((await env.PHOTOS.list({ prefix: "products/" })).objects).toHaveLength(0);
  });

  it("move with an unknown direction changes nothing", async () => {
    const p = await prod("rose");
    await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    expect((await post(`/admin/products/${p.id}/photos/${b.id}/move`, { dir: "sideways" })).status).toBe(303);
    expect((await imagesOf(p.id)).map((r) => r.r2Key)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("will not delete another product's photo", async () => {
    const p = await prod("rose");
    const q = await prod("lily");
    const other = await img(q.id, "c.jpg", 1);
    expect((await post(`/admin/products/${p.id}/photos/${other.id}/delete`)).status).toBe(404);
    expect(await env.PHOTOS.get("c.jpg")).not.toBeNull();
    expect(await imagesOf(q.id)).toHaveLength(1);
  });

  it("moves a photo up and down, no-op at the ends, 404 for another product's photo", async () => {
    const p = await prod("rose");
    const q = await prod("lily");
    await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    const other = await img(q.id, "c.jpg", 1);
    const keys = async () => (await imagesOf(p.id)).map((r) => r.r2Key);
    expect((await post(`/admin/products/${p.id}/photos/${b.id}/move`, { dir: "up" })).status).toBe(303);
    expect(await keys()).toEqual(["b.jpg", "a.jpg"]);
    await post(`/admin/products/${p.id}/photos/${b.id}/move`, { dir: "up" });
    expect(await keys()).toEqual(["b.jpg", "a.jpg"]);
    await post(`/admin/products/${p.id}/photos/${b.id}/move`, { dir: "down" });
    expect(await keys()).toEqual(["a.jpg", "b.jpg"]);
    await post(`/admin/products/${p.id}/photos/${b.id}/move`, { dir: "down" });
    expect(await keys()).toEqual(["a.jpg", "b.jpg"]);
    expect((await post(`/admin/products/${p.id}/photos/${other.id}/move`, { dir: "up" })).status).toBe(404);
  });

  it("deletes the object and row and renumbers", async () => {
    const p = await prod("rose");
    await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    await img(p.id, "c.jpg", 3);
    const res = await post(`/admin/products/${p.id}/photos/${b.id}/delete`);
    expect(res.status).toBe(303);
    expect(await env.PHOTOS.get("b.jpg")).toBeNull();
    const rows = await imagesOf(p.id);
    expect(rows.map((r) => [r.r2Key, r.position])).toEqual([["a.jpg", 1], ["c.jpg", 2]]);
  });

  it("still redirects when the object delete fails after the row is gone", async () => {
    const p = await prod("rose");
    const a = await img(p.id, "a.jpg", 1);
    const failing = { ...devEnv, PHOTOS: { delete: () => Promise.reject(new Error("r2 down")) } } as unknown as Env;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await admin.request(
      `${BASE}/admin/products/${p.id}/photos/${a.id}/delete`,
      { method: "POST", body: new URLSearchParams(), headers: { "content-type": "application/x-www-form-urlencoded" } },
      failing,
    );
    expect(res.status).toBe(303);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(await imagesOf(p.id)).toHaveLength(0);
  });

  it("hides a published product when its last photo is deleted", async () => {
    const p = await prod("rose", "published");
    const a = await img(p.id, "a.jpg", 1);
    const res = await post(`/admin/products/${p.id}/photos/${a.id}/delete`);
    expect(res.status).toBe(303);
    const [row] = await d().select().from(s.products).where(eq(s.products.id, p.id));
    expect(row!.status).toBe("draft");
    const page = await get(res.headers.get("location")!);
    expect(await page.text()).toContain("Product hidden because it has no photo");
  });

  it("shows the page, linked from the edit page", async () => {
    const p = await prod("rose");
    await img(p.id, "a.jpg", 1);
    const html = await (await get(`/admin/products/${p.id}/photos`)).text();
    expect(html).toContain("/img/a.jpg");
    expect(html).toContain("Delete this photo?");
    expect(html).toContain("image/jpeg");
    expect(await (await get(`/admin/products/${p.id}`)).text()).toContain(`/admin/products/${p.id}/photos`);
    expect((await get("/admin/products/9999/photos")).status).toBe(404);
  });

  it("first photo by position is the store thumbnail", async () => {
    const p = await prod("rose", "published");
    await d().insert(s.variants).values({ productId: p.id, sku: "rose-1", sizeLabel: "S", pricePaise: 100 });
    await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    await post(`/admin/products/${p.id}/photos/${b.id}/move`, { dir: "up" });
    const res = await SELF.fetch("http://example.com/api/store/products");
    const j = (await res.json()) as { items: { thumbnail_url: string }[] };
    expect(j.items[0]!.thumbnail_url).toContain("b.jpg");
  });
});

describe("final fix wave: photos", () => {
  it("a size mismatch still answers 413 when removing the stored object fails, and logs it", async () => {
    const p = await prod("fw-rose");
    const flaky = {
      ...devEnv,
      PHOTOS: { put: (...a: Parameters<R2Bucket["put"]>) => env.PHOTOS.put(...a), delete: async () => { throw new Error("r2 down"); } },
    } as unknown as Env;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [len, size] of [[4, 8], [16, 8]] as const) {
      const req = new Request(`${BASE}/admin/products/${p.id}/photos`, {
        method: "PUT",
        body: new Uint8Array(size),
        headers: { "content-type": "image/jpeg", "content-length": String(len) },
      });
      const res = await admin.fetch(req, flaky);
      await res.text();
      expect(res.status, `${len}/${size}`).toBe(413);
    }
    expect(spy.mock.calls.some((c) => String(c[0]).includes("could not remove"))).toBe(true);
    spy.mockRestore();
  });
});

describe("photo uploader and reorder", () => {
  beforeEach(async () => {
    const { objects } = await env.PHOTOS.list();
    for (const o of objects) await env.PHOTOS.delete(o.key);
    for (const t of [s.orderStatusLog, s.refunds, s.orderItems, s.orders, s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });
  const productRow = async (id: number) => (await d().select().from(s.products).where(eq(s.products.id, id)))[0]!;
  const order = async (pid: number) => (await imagesOf(pid)).map((r) => [r.id, r.position]);

  it("order endpoint saves the new order", async () => {
    const p = await prod("rose");
    const a = await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    const c = await img(p.id, "c.jpg", 3);
    const res = await post(`/admin/products/${p.id}/photos/order`, { order: `${c.id},${a.id},${b.id}` });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/admin/products/${p.id}/photos?saved=1`);
    expect(await order(p.id)).toEqual([[c.id, 1], [a.id, 2], [b.id, 3]]);
    expect((await productRow(p.id)).updatedAt > NOW).toBe(true);
    const j = await post(`/admin/products/${p.id}/photos/order`, { order: `${a.id},${b.id},${c.id}` }, { accept: "application/json" });
    expect(j.status).toBe(200);
    expect(await j.json()).toEqual({ ok: true });
    expect(await order(p.id)).toEqual([[a.id, 1], [b.id, 2], [c.id, 3]]);
  });

  it("order endpoint refuses a list that is missing, foreign or repeated ids", async () => {
    const p = await prod("rose");
    const q = await prod("lily");
    const a = await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    const c = await img(p.id, "c.jpg", 3);
    const other = await img(q.id, "x.jpg", 1);
    const before = await order(p.id);
    for (const list of [`${a.id},${b.id}`, `${a.id},${b.id},${c.id},999`, `${a.id},${a.id},${b.id}`, `${b.id},${a.id},${other.id}`, `${c.id},${b.id},${a.id},`, "", "x"]) {
      const res = await post(`/admin/products/${p.id}/photos/order`, { order: list }, { accept: "application/json" });
      expect(res.status, list).toBe(400);
      expect(await order(p.id)).toEqual(before);
    }
    expect((await post(`/admin/products/${p.id}/photos/order`, { order: `${a.id},${a.id},${b.id}` })).status).toBe(400);
    expect((await post(`/admin/products/9999/photos/order`, { order: `${a.id}` })).status).toBe(404);
    expect(await order(q.id)).toEqual([[other.id, 1]]);
  });

  it("uploading to a similar-photo product makes the new photo main and clears the mark", async () => {
    const p = await prod("rose");
    await d().update(s.products).set({ representativePhoto: 1 }).where(eq(s.products.id, p.id));
    const old = await img(p.id, "old.jpg", 1);
    const res = await put(`/admin/products/${p.id}/photos`, JPEG, { "content-type": "image/jpeg", "content-length": String(JPEG.length) });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; id: number; position: number };
    expect(j.position).toBe(1);
    expect(await order(p.id)).toEqual([[j.id, 1], [old.id, 2]]);
    const row = await productRow(p.id);
    expect(row.representativePhoto).toBe(0);
    expect(row.updatedAt > NOW).toBe(true);
  });

  it("uploading to a normal product appends and bumps updated_at", async () => {
    const p = await prod("rose");
    const a = await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    const res = await put(`/admin/products/${p.id}/photos`, JPEG, { "content-type": "image/jpeg", "content-length": String(JPEG.length) });
    const j = (await res.json()) as { id: number; position: number };
    expect(j.position).toBe(3);
    expect(await order(p.id)).toEqual([[a.id, 1], [b.id, 2], [j.id, 3]]);
    const row = await productRow(p.id);
    expect(row.updatedAt > NOW).toBe(true);
    expect(row.representativePhoto).toBe(0);
  });

  it("move and delete bump updated_at", async () => {
    const p = await prod("rose");
    await img(p.id, "a.jpg", 1);
    const b = await img(p.id, "b.jpg", 2);
    await post(`/admin/products/${p.id}/photos/${b.id}/move`, { dir: "up" });
    expect((await productRow(p.id)).updatedAt > NOW).toBe(true);
    const q = await prod("lily");
    const c = await img(q.id, "c.jpg", 1);
    await img(q.id, "e.jpg", 2);
    await post(`/admin/products/${q.id}/photos/${c.id}/delete`);
    expect((await productRow(q.id)).updatedAt > NOW).toBe(true);
  });

  it("product page opens the add sheet when asked", async () => {
    const p = await prod("rose");
    const asked = await (await get(`/admin/products/${p.id}?add=1`)).text();
    expect(asked).toContain("data-open-add");
    expect(asked).toMatch(/<dialog[^>]*id="add-sheet"[^>]*data-autoopen/);
    const plain = await (await get(`/admin/products/${p.id}`)).text();
    expect(plain).toMatch(/<dialog[^>]*id="add-sheet"/);
    expect(plain).not.toMatch(/<dialog[^>]*id="add-sheet"[^>]*data-autoopen/);
  });

  it("uploader asks for camera and gallery", async () => {
    const p = await prod("rose");
    const html = await (await get(`/admin/products/${p.id}`)).text();
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple/);
    expect(html).toContain("Take a photo");
    expect(html).toContain("Choose from gallery");
    expect(html).toContain("Could not upload this photo. Try another one.");
    expect(html).toContain("Could not save the new order");
    const script = html.slice(html.indexOf("XMLHttpRequest") - 3000, html.indexOf("XMLHttpRequest") + 3000);
    expect(html).toContain("XMLHttpRequest");
    expect(script).toContain("2000");
    expect(script).toContain("image/jpeg");
    expect(html).toContain(`data-put="/admin/products/${p.id}/photos"`);
  });
});
