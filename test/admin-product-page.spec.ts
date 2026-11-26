import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { admin } from "../src/admin/index";
import type { Env } from "../src/env";

const d = () => db(env);
const NOW = "2026-11-20T00:00:00.000Z";
const devEnv = { ...env, ENVIRONMENT: "development" } as unknown as Env;
const BASE = "http://localhost";
const get = async (path: string) => (await admin.request(`${BASE}${path}`, {}, devEnv)).text();
const post = (path: string, form: Record<string, string>) =>
  admin.request(`${BASE}${path}`, { method: "POST", body: new URLSearchParams(form), headers: { "content-type": "application/x-www-form-urlencoded" } }, devEnv);

async function prod(handle: string, o: { photo?: boolean; similar?: number } = {}) {
  const [p] = await d()
    .insert(s.products)
    .values({ handle, title: handle, status: "draft", representativePhoto: o.similar ?? 0, createdAt: NOW, updatedAt: NOW })
    .returning();
  if (o.photo) await d().insert(s.productImages).values({ productId: p!.id, r2Key: `${handle}.jpg`, position: 1 });
  return p!;
}
const size = (productId: number, sku: string, sizeLabel: string) => d().insert(s.variants).values({ productId, sku, sizeLabel, pricePaise: 10000 });

describe("one product page", () => {
  beforeEach(async () => {
    for (const t of [s.orderStatusLog, s.refunds, s.orderItems, s.orders, s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });

  it("one page shows photos, details, categories and sizes", async () => {
    const p = await prod("rose", { photo: true });
    await d().insert(s.categories).values({ handle: "plants", name: "Plants" });
    await size(p.id, "rose-small", "Small pot");
    await size(p.id, "rose-big", "Big pot");
    const html = await get(`/admin/products/${p.id}`);
    for (const x of ["/img/rose.jpg", 'name="name"', 'name="description"', 'name="category"', "Small pot", "Big pot", "Add photos"]) expect(html).toContain(x);
  });

  it("photos and prices addresses show the same page at that section", async () => {
    const p = await prod("rose");
    await size(p.id, "rose-a", "A");
    const photos = await get(`/admin/products/${p.id}/photos`);
    expect(photos).toContain('id="photos"');
    expect(photos).toContain('name="name"');
    const prices = await get(`/admin/products/${p.id}/prices`);
    expect(prices).toContain('id="sizes"');
    expect(prices).toContain('name="name"');
  });

  it("readiness checklist", async () => {
    const bare = await prod("bare");
    expect(await get(`/admin/products/${bare.id}`)).toContain("Needs a photo");
    const p = await prod("rose", { photo: true });
    const [c] = await d().insert(s.categories).values({ handle: "plants", name: "Plants" }).returning();
    await d().insert(s.productCategories).values({ productId: p.id, categoryId: c!.id });
    await size(p.id, "rose-a", "A");
    expect(await get(`/admin/products/${p.id}`)).toContain("Ready for the shop");
  });

  it("saving name keeps sizes, photos and the similar mark", async () => {
    const p = await prod("rose", { photo: true, similar: 1 });
    await size(p.id, "rose-a", "A");
    const r = await post(`/admin/products/${p.id}`, { name: "Red Rose" });
    expect(r.status).toBe(303);
    const [row] = await d().select().from(s.products).where(eq(s.products.id, p.id));
    expect([row!.title, row!.representativePhoto]).toEqual(["Red Rose", 1]);
    expect(await d().select().from(s.variants).where(eq(s.variants.productId, p.id))).toHaveLength(1);
    expect(await d().select().from(s.productImages).where(eq(s.productImages.productId, p.id))).toHaveLength(1);
  });

  it("category picker has a search box", async () => {
    const p = await prod("rose");
    expect(await get(`/admin/products/${p.id}`)).toContain('placeholder="Find a category"');
  });

  it("escapes the name, description and size labels", async () => {
    const [p] = await d()
      .insert(s.products)
      .values({ handle: "x", title: "Pot <script>&", description: "Desc <script>&", status: "draft", createdAt: NOW, updatedAt: NOW })
      .returning();
    await size(p!.id, "x-a", "Size <script>&");
    const html = await get(`/admin/products/${p!.id}`);
    for (const x of ["Pot &lt;script&gt;&amp;", "Desc &lt;script&gt;&amp;", "Size &lt;script&gt;&amp;"]) expect(html).toContain(x);
    for (const x of ["Pot <script>", "Desc <script>", "Size <script>"]) expect(html).not.toContain(x);
  });

  it("a bad price re-renders the page at Sizes and keeps the typed value", async () => {
    const p = await prod("rose");
    const [v] = await d().insert(s.variants).values({ productId: p.id, sku: "rose-a", sizeLabel: "A", pricePaise: 10000 }).returning();
    const r = await post(`/admin/products/${p.id}/prices`, { [`price_${v!.id}`]: "12x" });
    expect(r.status).toBe(400);
    const html = await r.text();
    expect(html).toContain('id="sizes"');
    expect(html).toContain('value="12x"');
  });

  it("adding, showing again and removing a size marks the product changed", async () => {
    const p = await prod("rose");
    await size(p.id, "rose-a", "A");
    const at = async () => (await d().select().from(s.products).where(eq(s.products.id, p.id)))[0]!.updatedAt;
    const reset = () => d().update(s.products).set({ updatedAt: NOW }).where(eq(s.products.id, p.id));
    expect((await post(`/admin/products/${p.id}/prices/add`, { size: "B", colour: "" })).status).toBe(303);
    expect((await at()) > NOW).toBe(true);
    const [b] = await d().select().from(s.variants).where(eq(s.variants.sizeLabel, "B"));
    await reset();
    expect((await post(`/admin/products/${p.id}/prices/remove`, { remove: String(b!.id) })).status).toBe(303);
    expect((await at()) > NOW).toBe(true);
    await size(p.id, "rose-c", "C");
    await d().update(s.variants).set({ hidden: 1 }).where(eq(s.variants.sizeLabel, "C"));
    await reset();
    expect((await post(`/admin/products/${p.id}/prices/add`, { size: "C", colour: "" })).status).toBe(303);
    expect((await at()) > NOW).toBe(true);
  });

  it("no-photo product refuses to show in shop", async () => {
    const p = await prod("rose");
    const r = await post(`/admin/products/${p.id}/status`, { status: "published" });
    expect(r.status).toBe(400);
    const html = await r.text();
    expect(html).toContain("Add a photo first");
    expect(html).toContain("Showing in shop");
  });
});
