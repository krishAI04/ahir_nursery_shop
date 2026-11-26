import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { imageUrl } from "../src/lib/images";
import { isSafeKey } from "../src/store/catalog";

const d = () => db(env);
const NOW = "2026-11-20T00:00:00.000Z";
const get = (path: string, headers: Record<string, string> = {}) => SELF.fetch(`http://example.com${path}`, { headers });

async function cat(handle: string, o: { name?: string; parentId?: number; isInternal?: number } = {}) {
  const [c] = await d()
    .insert(s.categories)
    .values({ handle, name: o.name ?? handle, parentId: o.parentId ?? null, isInternal: o.isInternal ?? 0 })
    .returning();
  return c!;
}
async function prod(
  handle: string,
  catId: number,
  o: { status?: string; title?: string; photoCredit?: string | null; rep?: number } = {},
) {
  const [p] = await d()
    .insert(s.products)
    .values({
      handle,
      title: o.title ?? handle,
      description: "desc",
      status: o.status ?? "published",
      photoCredit: o.photoCredit ?? null,
      representativePhoto: o.rep ?? 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning();
  await d().insert(s.productCategories).values({ productId: p!.id, categoryId: catId });
  return p!;
}
const variant = (
  productId: number,
  sku: string,
  o: { price?: number | null; inStock?: number; hidden?: number; size?: string } = {},
) =>
  d().insert(s.variants).values({
    productId,
    sku,
    sizeLabel: o.size ?? "Standard",
    pricePaise: o.price === undefined ? 10000 : o.price,
    inStock: o.inStock ?? 1,
    hidden: o.hidden ?? 0,
  });

describe("store catalogue", () => {
  beforeEach(async () => {
    for (const t of [s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });

  it("hides drafts from list and detail", async () => {
    const c = await cat("plants");
    await prod("live", c.id);
    await prod("secret", c.id, { status: "draft" });
    const list = (await (await get("/api/store/products")).json()) as any;
    expect(list.items.map((i: any) => i.handle)).toEqual(["live"]);
    expect(list.total).toBe(1);
    expect((await get("/api/store/products/secret")).status).toBe(404);
    expect((await get("/api/store/products/live")).status).toBe(200);
    expect((await get("/api/store/products/nope")).status).toBe(404);
  });

  it("hides internal Unsorted category and its products", async () => {
    const c = await cat("plants", { name: "Plants" });
    const u = await cat("unsorted", { name: "Unsorted", isInternal: 1 });
    await prod("live", c.id);
    await prod("lost", u.id);
    const cats = (await (await get("/api/store/categories")).json()) as any;
    expect(JSON.stringify(cats)).not.toContain("Unsorted");
    const list = (await (await get("/api/store/products")).json()) as any;
    expect(list.items.map((i: any) => i.handle)).toEqual(["live"]);
    expect((await get("/api/store/products/lost")).status).toBe(404);
  });

  it("returns the category tree", async () => {
    const parent = await cat("plants", { name: "Plants" });
    await cat("fruit", { name: "Fruit Plants", parentId: parent.id });
    const tree = (await (await get("/api/store/categories")).json()) as any;
    expect(tree).toEqual([
      { handle: "plants", name: "Plants", children: [{ handle: "fruit", name: "Fruit Plants", children: [] }] },
    ]);
  });

  it("paginates 24 per page", async () => {
    const c = await cat("plants");
    for (let i = 0; i < 30; i++) await prod(`p${String(i).padStart(2, "0")}`, c.id);
    const p1 = (await (await get("/api/store/products")).json()) as any;
    expect(p1.items).toHaveLength(24);
    expect(p1.page).toBe(1);
    expect(p1.total).toBe(30);
    const p2 = (await (await get("/api/store/products?page=2")).json()) as any;
    expect(p2.items).toHaveLength(6);
    expect(p2.page).toBe(2);
    const bad = (await (await get("/api/store/products?page=0")).json()) as any;
    expect(bad.page).toBe(1);
  });

  it("filters by category (including children)", async () => {
    const parent = await cat("plants");
    const child = await cat("fruit", { parentId: parent.id });
    const other = await cat("pots");
    await prod("mango", child.id);
    await prod("pot", other.id);
    const r = (await (await get("/api/store/products?category=plants")).json()) as any;
    expect(r.items.map((i: any) => i.handle)).toEqual(["mango"]);
    expect(r.total).toBe(1);
  });

  it("list items never include prices (staff-only reference data)", async () => {
    const c = await cat("plants");
    const a = await prod("a", c.id);
    await variant(a.id, "A1", { price: 30000, size: "L" });
    await variant(a.id, "A2", { price: 20000, size: "S" });
    await variant(a.id, "A3", { price: 100, size: "Hidden", hidden: 1 });
    await variant(a.id, "A4", { price: 50, size: "OOS", inStock: 0 });
    const b = await prod("b", c.id);
    await variant(b.id, "B1", { price: null });
    await d().insert(s.productImages).values([
      { productId: a.id, r2Key: "a/2.jpg", position: 2 },
      { productId: a.id, r2Key: "a/1.jpg", position: 1 },
    ]);
    const r = (await (await get("/api/store/products")).json()) as any;
    expect(r.items).toEqual([
      { handle: "a", title: "a", thumbnail_url: "/img/a/1.jpg", representative_photo: false },
      { handle: "b", title: "b", thumbnail_url: null, representative_photo: false },
    ]);
    const text = JSON.stringify(r);
    for (const w of ["price", "30000", "20000"]) expect(text).not.toContain(w);
  });

  it("q matches title case-insensitively", async () => {
    const c = await cat("plants");
    await prod("lotus-pot", c.id, { title: "Blue Lotus Pot" });
    await prod("rose", c.id, { title: "Rose" });
    const r = (await (await get("/api/store/products?q=lotus")).json()) as any;
    expect(r.items.map((i: any) => i.handle)).toEqual(["lotus-pot"]);
    expect(r.total).toBe(1);
  });

  it("detail returns variants, images, credit and never leaks sources", async () => {
    const c = await cat("plants", { name: "Plants" });
    const p = await prod("lotus", c.id, {
      photoCredit: JSON.stringify({ author: "A", license: "CC0", source_url: "https://x.y" }),
      rep: 1,
    });
    await variant(p.id, "L1", { price: 5000, size: "S" });
    await variant(p.id, "L2", { price: null, size: "M", inStock: 0 });
    await variant(p.id, "L3", { price: 1, size: "X", hidden: 1 });
    await d().insert(s.productImages).values([
      { productId: p.id, r2Key: "l/b.jpg", position: 1 },
      { productId: p.id, r2Key: "l/a.jpg", position: 0 },
    ]);
    await d().insert(s.productSources).values({
      productId: p.id,
      sheetRows: "[1]",
      rawNames: '["rawname"]',
      notes: '["secretnote"]',
      sourceUrl: "https://secret.example",
      author: "Zed",
    });
    const body = (await (await get("/api/store/products/lotus")).json()) as any;
    expect(body).toEqual({
      handle: "lotus",
      title: "lotus",
      description: "desc",
      images: ["/img/l/a.jpg", "/img/l/b.jpg"],
      variants: [
        { sku: "L1", size: "S", colour: null, in_stock: true },
        { sku: "L2", size: "M", colour: null, in_stock: false },
      ],
      photo_credit: { author: "A", license: "CC0", source_url: "https://x.y" },
      representative_photo: true,
      categories: [{ handle: "plants", name: "Plants" }],
    });
    const text = JSON.stringify(body);
    for (const w of ["rawname", "secretnote", "secret.example", "Zed", "price", "5000"]) expect(text).not.toContain(w);
  });

  it("serves R2 images with immutable caching, 404 when missing", async () => {
    await env.PHOTOS.put("plants/x.jpg", "bytes", { httpMetadata: { contentType: "image/jpeg" } });
    const res = await get("/img/plants/x.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("bytes");
    expect((await get("/img/plants/missing.jpg")).status).toBe(404);
    expect((await get("/img/a/%2e%2e/b.jpg")).status).toBe(404);
  });

  it("CORS only for allowed origins, incl. preflight", async () => {
    const ok = await get("/api/store/categories", { Origin: "https://shop.test" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://shop.test");
    const bad = await get("/api/store/categories", { Origin: "https://evil.test" });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await SELF.fetch("http://example.com/api/store/products", {
      method: "OPTIONS",
      headers: { Origin: "https://shop.test", "Access-Control-Request-Method": "GET" },
    });
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://shop.test");
    const preBad = await SELF.fetch("http://example.com/api/store/products", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.test", "Access-Control-Request-Method": "GET" },
    });
    expect(preBad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("store catalogue fix round 1", () => {
  beforeEach(async () => {
    for (const t of [s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });

  it("long q (100 chars) returns 200 and still matches a title prefix", async () => {
    const c = await cat("plants");
    await prod("long", c.id, { title: "a".repeat(100) });
    const res = await get(`/api/store/products?q=${"a".repeat(100)}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).total).toBe(1);
    const multi = await get(`/api/store/products?q=${encodeURIComponent("é".repeat(60) + "%".repeat(30))}`);
    expect(multi.status).toBe(200);
  });

  it("long multibyte q still matches (pattern is cut at whole characters)", async () => {
    const c = await cat("plants");
    await prod("accent", c.id, { title: "é".repeat(60) + " plant" });
    await prod("other", c.id, { title: "Rose" });
    const r = (await (await get(`/api/store/products?q=${encodeURIComponent("é".repeat(60))}`)).json()) as any;
    expect(r.items.map((i: any) => i.handle)).toEqual(["accent"]);
    expect(r.total).toBe(1);
  });

  it("/img: encoded .. segments never reach R2 as a key", async () => {
    // A key with a literal ".." exists in the bucket; the route guard must still refuse it.
    await env.PHOTOS.put("a/../b.jpg", "secret");
    for (const path of ["/img/a/..%2fb.jpg", "/img/a/..%2Fb.jpg", "/img/a/%2e%2e%2fb.jpg"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      await res.arrayBuffer();
    }
    // "%2e%2e" as a whole path segment is resolved by URL parsing before routing: it names a key inside the bucket.
    await env.PHOTOS.put("b.jpg", "public");
    const res = await get("/img/a/%2e%2e/b.jpg");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("public");
  });

  it("odd page values fall back safely", async () => {
    const c = await cat("plants");
    await prod("one", c.id);
    for (const [p, want] of [["1e20", 10000], ["1e400", 1], ["99999999999", 10000], ["0", 1], ["-1", 1], ["abc", 1], ["2.5", 1]] as const) {
      const res = await get(`/api/store/products?page=${p}`);
      expect(res.status, p).toBe(200);
      expect(((await res.json()) as any).page, p).toBe(want);
    }
  });

  it("/img sanitises content-type and sets nosniff", async () => {
    await env.PHOTOS.put("x/evil.png", "<script>", { httpMetadata: { contentType: "text/html" } });
    await env.PHOTOS.put("x/blob", "z", { httpMetadata: { contentType: "text/html" } });
    const a = await get("/img/x/evil.png");
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    await a.arrayBuffer();
    const b = await get("/img/x/blob");
    expect(b.headers.get("content-type")).toBe("application/octet-stream");
    await b.arrayBuffer();
  });

  it("key guard rejects traversal and odd segments", async () => {
    expect(isSafeKey("a/b.jpg")).toBe(true);
    for (const k of ["a/../b", "..", "a/./b", "a//b", "/a", "a/..%2fb".replace("%2f", "/")]) expect(isSafeKey(k), k).toBe(false);
    expect(isSafeKey("a..b.jpg")).toBe(false);
  });

  it("q treats % and _ literally", async () => {
    const c = await cat("plants");
    await prod("pct", c.id, { title: "50% off" });
    await prod("under", c.id, { title: "a_b" });
    await prod("plain", c.id, { title: "axb" });
    expect(((await (await get("/api/store/products?q=%25")).json()) as any).items.map((i: any) => i.handle)).toEqual(["pct"]);
    expect(((await (await get("/api/store/products?q=a_b")).json()) as any).items.map((i: any) => i.handle)).toEqual(["under"]);
  });

  it("no images and all-out-of-stock", async () => {
    const c = await cat("plants");
    const p = await prod("bare", c.id);
    await variant(p.id, "S1", { price: 100, inStock: 0 });
    const list = (await (await get("/api/store/products")).json()) as any;
    expect(list.items[0].thumbnail_url).toBeNull();
    expect(list.items[0]).not.toHaveProperty("price_on_request");
    expect(((await (await get("/api/store/products/bare")).json()) as any).images).toEqual([]);
  });

  it("imageUrl uses IMAGE_BASE_URL with or without trailing slash", () => {
    expect(imageUrl({ IMAGE_BASE_URL: "https://img.test" }, "a/b.jpg")).toBe("https://img.test/a/b.jpg");
    expect(imageUrl({ IMAGE_BASE_URL: "https://img.test/" }, "a/b.jpg")).toBe("https://img.test/a/b.jpg");
    expect(imageUrl({ IMAGE_BASE_URL: "" }, "a/b.jpg")).toBe("/img/a/b.jpg");
  });

  it("sorts titles case-insensitively", async () => {
    const c = await cat("plants");
    await prod("b", c.id, { title: "banana" });
    await prod("a", c.id, { title: "Zebra" });
    await prod("c", c.id, { title: "Apple" });
    const r = (await (await get("/api/store/products")).json()) as any;
    expect(r.items.map((i: any) => i.title)).toEqual(["Apple", "banana", "Zebra"]);
  });
});
