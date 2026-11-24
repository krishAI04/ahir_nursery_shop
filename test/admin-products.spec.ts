import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { admin } from "../src/admin/index";
import { slug } from "../src/lib/slug";
import type { Env } from "../src/env";

const d = () => db(env);
const NOW = "2026-11-20T00:00:00.000Z";
const devEnv = { ...env, ENVIRONMENT: "development" } as unknown as Env;
const BASE = "http://localhost";
const get = (path: string) => admin.request(`${BASE}${path}`, {}, devEnv);
const post = (path: string, form: Record<string, string | string[]>, headers: Record<string, string> = {}) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return admin.request(
    `${BASE}${path}`,
    { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } },
    devEnv,
  );
};
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

async function cat(handle: string, isInternal = 0) {
  const [c] = await d().insert(s.categories).values({ handle, name: handle, isInternal }).returning();
  return c!;
}
async function prod(handle: string, o: { title?: string; status?: string; photo?: boolean; raw?: string[] } = {}) {
  const [p] = await d()
    .insert(s.products)
    .values({ handle, title: o.title ?? handle, status: o.status ?? "draft", createdAt: NOW, updatedAt: NOW })
    .returning();
  if (o.photo) await d().insert(s.productImages).values({ productId: p!.id, r2Key: `${handle}.jpg` });
  if (o.raw) await d().insert(s.productSources).values({ productId: p!.id, rawNames: JSON.stringify(o.raw) });
  return p!;
}
async function variant(
  productId: number,
  sku: string,
  o: { price?: number | null; size?: string; colour?: string | null; hidden?: number } = {},
) {
  const [v] = await d()
    .insert(s.variants)
    .values({
      productId,
      sku,
      sizeLabel: o.size ?? "Standard",
      colour: o.colour ?? null,
      pricePaise: o.price === undefined ? 10000 : o.price,
      hidden: o.hidden ?? 0,
    })
    .returning();
  return v!;
}
const variantsOf = (pid: number) => d().select().from(s.variants).where(eq(s.variants.productId, pid));

describe("slug", () => {
  it("normalises", () => {
    expect(slug("Bag 12×12 in")).toBe("bag-12x12-in");
    expect(slug("  --Rose & Lily!! ")).toBe("rose-lily");
    expect(slug("!!!")).toBe("item");
    expect(slug("")).toBe("item");
  });
});

describe("admin products", () => {
  beforeEach(async () => {
    for (const t of [s.orderStatusLog, s.refunds, s.orderItems, s.orders, s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });

  it("requires staff and rejects cross-origin POSTs", async () => {
    const prodEnv = { ...env, ENVIRONMENT: "production" } as unknown as Env;
    expect((await admin.request(`${BASE}/admin/products`, {}, prodEnv)).status).toBe(403);
    const c = await cat("plants");
    const bad = await post("/admin/products/new", { name: "Rose", category: String(c.id) }, { Origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect((await d().select().from(s.products)).length).toBe(0);
    const same = await post("/admin/products/new", { name: "Rose", category: String(c.id) }, { Origin: BASE });
    expect(same.status).toBe(303);
    const none = await post("/admin/products/new", { name: "Tulip", category: String(c.id) });
    expect(none.status).toBe(303);
  });

  it("rejects Origin: null and Sec-Fetch-Site: cross-site", async () => {
    const c = await cat("plants");
    const form = { name: "Rose", category: String(c.id) };
    expect((await post("/admin/products/new", form, { Origin: "null" })).status).toBe(403);
    expect((await post("/admin/products/new", form, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await d().select().from(s.products)).length).toBe(0);
    expect((await post("/admin/products/new", form, { "Sec-Fetch-Site": "same-origin" })).status).toBe(303);
  });

  describe("list", () => {
    it("search finds by title and by raw names, case-insensitively", async () => {
      await prod("acalypha", { title: "Acalypha", raw: ["Aclifa", "Copper leaf"] });
      await prod("rose", { title: "Rose" });
      const r1 = await (await get("/admin/products?q=aclifa")).text();
      expect(r1).toContain("Acalypha");
      expect(r1).not.toContain(">Rose<");
      const r2 = await (await get("/admin/products?q=ROSE")).text();
      expect(r2).toContain(">Rose<");
      expect(r2).not.toContain("Acalypha");
    });

    it("handles long and wildcard search terms without error", async () => {
      await prod("rose", { title: "Rose" });
      const longTitle = "L".repeat(60);
      await prod("long", { title: longTitle });
      const longRes = await get(`/admin/products?q=${longTitle}${"z".repeat(100)}`);
      expect(longRes.status).toBe(200);
      const longHtml = await longRes.text();
      expect(longHtml).toContain(`>${longTitle}<`);
      expect(longHtml).not.toContain(">Rose<");
      expect((await get(`/admin/products?q=${"a".repeat(200)}`)).status).toBe(200);
      expect((await get("/admin/products?q=%25%5F")).status).toBe(200);
      expect((await get("/admin/products?page=abc")).status).toBe(200);
    });

    it("filters", async () => {
      const pub = await prod("pub", { title: "PubOne", status: "published", photo: true });
      await variant(pub.id, "pub-s");
      const dr = await prod("dr", { title: "DraftOne", photo: true });
      await variant(dr.id, "dr-s");
      const np = await prod("np", { title: "NoPhotoOne", status: "published" });
      await variant(np.id, "np-s");
      const pr = await prod("pr", { title: "NoPriceOne", photo: true });
      await variant(pr.id, "pr-s", { price: null });
      await variant(pr.id, "pr-t", { size: "Big", price: 500 });
      const hiddenNull = await prod("hn", { title: "HiddenNull", photo: true });
      await variant(hiddenNull.id, "hn-s", { price: null, hidden: 1 });
      await variant(hiddenNull.id, "hn-t", { size: "Big" });
      const titles = async (f: string) => {
        const h = await (await get(`/admin/products?filter=${f}`)).text();
        return ["PubOne", "DraftOne", "NoPhotoOne", "NoPriceOne", "HiddenNull"].filter((t) => h.includes(`>${t}<`));
      };
      expect(await titles("published")).toEqual(["PubOne", "NoPhotoOne"]);
      expect(await titles("draft")).toEqual(["DraftOne", "NoPriceOne", "HiddenNull"]);
      expect(await titles("needs-photo")).toEqual(["NoPhotoOne"]);
      expect(await titles("no-price")).toEqual(["NoPriceOne"]);
    });

    it("paginates 50 per page", async () => {
      for (let i = 0; i < 55; i++) await prod(`p${String(i).padStart(2, "0")}`, { title: `Item ${String(i).padStart(2, "0")}` });
      const p1 = await (await get("/admin/products")).text();
      expect(p1).toContain(">Item 49<");
      expect(p1).not.toContain(">Item 50<");
      const p2 = await (await get("/admin/products?page=2")).text();
      expect(p2).toContain(">Item 54<");
      expect(p2).not.toContain(">Item 00<");
    });
  });

  describe("new product", () => {
    it("creates a draft with one Standard size and a unique name-based slug", async () => {
      const c = await cat("plants");
      const internal = await cat("unsorted", 1);
      const form = await (await get("/admin/products/new")).text();
      expect(form).toContain(`value="${c.id}"`);
      expect(form).not.toContain(`value="${internal.id}"`);
      const r = await post("/admin/products/new", { name: "Rose Lily", category: String(c.id) });
      expect(r.status).toBe(303);
      const [p] = await d().select().from(s.products);
      expect(p!.handle).toBe("rose-lily");
      expect(p!.status).toBe("draft");
      expect(r.headers.get("location")).toBe(`/admin/products/${p!.id}?saved=1`);
      const vs = await d().select().from(s.variants);
      expect(vs.map((v) => [v.sizeLabel, v.sku, v.pricePaise])).toEqual([["Standard", "rose-lily-standard", null]]);
      const links = await d().select().from(s.productCategories);
      expect(links).toEqual([{ productId: p!.id, categoryId: c.id }]);
      await post("/admin/products/new", { name: "Rose Lily", category: String(c.id) });
      const hs = (await d().select().from(s.products)).map((x) => x.handle).sort();
      expect(hs).toEqual(["rose-lily", "rose-lily-2"]);
    });

    it("validates name and category and saves nothing", async () => {
      const c = await cat("plants");
      const internal = await cat("unsorted", 1);
      expect((await post("/admin/products/new", { name: "  ", category: String(c.id) })).status).toBe(400);
      expect((await post("/admin/products/new", { name: "x".repeat(121), category: String(c.id) })).status).toBe(400);
      expect((await post("/admin/products/new", { name: "Rose", category: "" })).status).toBe(400);
      const badcat = await post("/admin/products/new", { name: "<b>Rose</b>", category: String(internal.id) });
      expect(badcat.status).toBe(400);
      const html = await badcat.text();
      expect(html).not.toContain("<b>Rose</b>");
      expect(html).toContain("&lt;b&gt;Rose&lt;/b&gt;");
      expect((await d().select().from(s.products)).length).toBe(0);
    });
  });

  describe("edit, publish and hide", () => {
    it("saves name, description, categories (drops the internal one once sorted)", async () => {
      const a = await cat("a");
      const b = await cat("b");
      const un = await cat("unsorted", 1);
      const p = await prod("rose", { title: "Rose" });
      await d().insert(s.productCategories).values({ productId: p.id, categoryId: un.id });
      const r = await post(`/admin/products/${p.id}`, { name: "Red Rose", description: "Lovely", category: [String(a.id), String(b.id)] });
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe(`/admin/products/${p.id}?saved=1`);
      const [row] = await d().select().from(s.products);
      expect([row!.title, row!.description]).toEqual(["Red Rose", "Lovely"]);
      const links = (await d().select().from(s.productCategories)).map((l) => l.categoryId).sort();
      expect(links).toEqual([a.id, b.id].sort());
      const page = await (await get(`/admin/products/${p.id}?saved=1`)).text();
      expect(page).toContain("Saved");
      expect(page).toContain("Red Rose");
    });

    it("rejects an empty name and 404s unknown products", async () => {
      const p = await prod("rose", { title: "Rose" });
      const r = await post(`/admin/products/${p.id}`, { name: "", description: "x" });
      expect(r.status).toBe(400);
      expect((await d().select().from(s.products))[0]!.title).toBe("Rose");
      expect((await get("/admin/products/9999")).status).toBe(404);
      expect((await get("/admin/products/abc")).status).toBe(404);
    });

    it("publish needs a photo; hide returns to draft", async () => {
      const p = await prod("rose", { title: "Rose" });
      const no = await post(`/admin/products/${p.id}/status`, { status: "published" });
      expect(no.status).toBe(400);
      expect(await no.text()).toContain("Add a photo first");
      expect((await d().select().from(s.products))[0]!.status).toBe("draft");
      await d().insert(s.productImages).values({ productId: p.id, r2Key: "r.jpg" });
      const ok = await post(`/admin/products/${p.id}/status`, { status: "published" });
      expect(ok.status).toBe(303);
      expect((await d().select().from(s.products))[0]!.status).toBe("published");
      const hide = await post(`/admin/products/${p.id}/status`, { status: "draft" });
      expect(hide.status).toBe(303);
      expect((await d().select().from(s.products))[0]!.status).toBe("draft");
      expect((await post(`/admin/products/${p.id}/status`, { status: "bogus" })).status).toBe(400);
    });

    it("cannot publish while linked only to an internal category", async () => {
      const un = await cat("unsorted", 1);
      const p = await prod("rose", { title: "Rose", photo: true });
      await d().insert(s.productCategories).values({ productId: p.id, categoryId: un.id });
      const r = await post(`/admin/products/${p.id}/status`, { status: "published" });
      expect(r.status).toBe(400);
      expect(await r.text()).toContain("Choose a shop category first");
      expect((await d().select().from(s.products))[0]!.status).toBe("draft");
    });

    it("suffixes handles past -2 in one pass", async () => {
      const c = await cat("plants");
      for (let i = 0; i < 3; i++) await post("/admin/products/new", { name: "Fern", category: String(c.id) });
      await post("/admin/products/new", { name: "x".repeat(60), category: String(c.id) });
      await post("/admin/products/new", { name: "x".repeat(60), category: String(c.id) });
      const hs = (await d().select().from(s.products)).map((x) => x.handle).sort();
      expect(hs).toEqual(["fern", "fern-2", "fern-3", "x".repeat(60), `${"x".repeat(60)}-2`].sort());
    });

    it("shows photo info from sources", async () => {
      const p = await prod("rose", { title: "Rose", raw: ["Gulab"] });
      await d()
        .update(s.productSources)
        .set({ author: "Jane Doe", license: "CC BY 4.0", photoSource: "Wikimedia", sourceUrl: "https://example.org/x" })
        .where(eq(s.productSources.productId, p.id));
      const html = await (await get(`/admin/products/${p.id}`)).text();
      expect(html).toContain("Jane Doe");
      expect(html).toContain("CC BY 4.0");
      expect(html).toContain("Wikimedia");
      expect(html).toContain("https://example.org/x");
      expect(html).toContain("Gulab");
    });
  });

  describe("prices and sizes", () => {
    it("saves prices (150, 1,250, empty) in one go", async () => {
      const p = await prod("rose");
      const a = await variant(p.id, "rose-a", { size: "A", price: 1 });
      const b = await variant(p.id, "rose-b", { size: "B", price: 1 });
      const c = await variant(p.id, "rose-c", { size: "C", price: 1 });
      const r = await post(`/admin/products/${p.id}/prices`, {
        [`price_${a.id}`]: "150",
        [`price_${b.id}`]: "1,250",
        [`price_${c.id}`]: "",
        [`stock_${a.id}`]: "1",
      });
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe(`/admin/products/${p.id}/prices?saved=1`);
      const rows = await variantsOf(p.id);
      const by = (id: number) => rows.find((x) => x.id === id)!;
      expect([by(a.id).pricePaise, by(b.id).pricePaise, by(c.id).pricePaise]).toEqual([15000, 125000, null]);
      expect([by(a.id).inStock, by(b.id).inStock, by(c.id).inStock]).toEqual([1, 0, 0]);
    });

    it("rejects the whole form on one bad price, naming the size, saving nothing", async () => {
      const p = await prod("rose");
      const a = await variant(p.id, "rose-a", { size: "Small pot", price: 100 });
      const b = await variant(p.id, "rose-b", { size: "Big pot", price: 200 });
      const r = await post(`/admin/products/${p.id}/prices`, { [`price_${a.id}`]: "300", [`price_${b.id}`]: "abc" });
      expect(r.status).toBe(400);
      const html = await r.text();
      expect(html).toContain("Enter a price like 150 or 150.50");
      expect(html).toContain("Big pot");
      expect(html).toContain('value="abc"');
      expect(html).toContain('value="300"');
      expect((await variantsOf(p.id)).map((x) => x.pricePaise).sort()).toEqual([100, 200]);
    });

    it("ignores price keys for another product's size", async () => {
      const p = await prod("rose");
      const q = await prod("lily");
      const a = await variant(p.id, "rose-a", { size: "A", price: 100 });
      const f = await variant(q.id, "lily-a", { price: 777 });
      const r = await post(`/admin/products/${p.id}/prices`, { [`price_${a.id}`]: "200", [`price_${f.id}`]: "5" });
      expect(r.status).toBe(303);
      expect((await variantsOf(q.id))[0]!.pricePaise).toBe(777);
      expect((await variantsOf(p.id))[0]!.pricePaise).toBe(20000);
    });

    it("cannot remove the last visible size", async () => {
      const p = await prod("rose");
      const a = await variant(p.id, "rose-a", { size: "A" });
      await variant(p.id, "rose-h", { size: "H", hidden: 1 });
      const r = await post(`/admin/products/${p.id}/prices/remove`, { remove: String(a.id) });
      expect(r.status).toBe(400);
      expect(await r.text()).toContain("A product needs at least one size");
      expect((await variantsOf(p.id)).length).toBe(2);
    });

    it("shows only visible sizes and the existing price", async () => {
      const p = await prod("rose");
      await variant(p.id, "rose-a", { size: "Shown", price: 12550 });
      await variant(p.id, "rose-b", { size: "Gone", hidden: 1 });
      const html = await (await get(`/admin/products/${p.id}/prices`)).text();
      expect(html).toContain("Shown");
      expect(html).toContain('value="125.50"');
      expect(html).not.toContain("Gone");
    });

    it("adds a size with a generated code and de-duplicates collisions", async () => {
      const p = await prod("rose");
      await variant(p.id, "rose-standard");
      expect((await post(`/admin/products/${p.id}/prices/add`, { size: "Bag 12×12 in", colour: "" })).status).toBe(303);
      expect((await post(`/admin/products/${p.id}/prices/add`, { size: "Bag 12×12 in", colour: "Red" })).status).toBe(303);
      // an unrelated product already owns the code this size would get
      const other = await prod("rose-2");
      await variant(other.id, "rose-big-pot");
      await post(`/admin/products/${p.id}/prices/add`, { size: "Big pot", colour: "" });
      const rows = await variantsOf(p.id);
      expect(rows.map((x) => [x.sizeLabel, x.colour, x.sku]).sort()).toEqual(
        [
          ["Standard", null, "rose-standard"],
          ["Bag 12×12 in", null, "rose-bag-12x12-in"],
          ["Bag 12×12 in", "Red", "rose-bag-12x12-in-red"],
          ["Big pot", null, "rose-big-pot-2"],
        ].sort(),
      );
      expect(rows.find((x) => x.sizeLabel === "Bag 12×12 in" && !x.colour)!.pricePaise).toBeNull();
    });

    it("rejects an empty or duplicate size, and un-hides a hidden duplicate", async () => {
      const p = await prod("rose");
      await variant(p.id, "rose-a", { size: "Small" });
      await variant(p.id, "rose-b", { size: "Old", hidden: 1 });
      expect((await post(`/admin/products/${p.id}/prices/add`, { size: " ", colour: "" })).status).toBe(400);
      expect((await post(`/admin/products/${p.id}/prices/add`, { size: "Small", colour: "" })).status).toBe(400);
      expect((await post(`/admin/products/${p.id}/prices/add`, { size: "Old", colour: "" })).status).toBe(303);
      const rows = await variantsOf(p.id);
      expect(rows.length).toBe(2);
      expect(rows.find((x) => x.sizeLabel === "Old")!.hidden).toBe(0);
    });

    it("removing a never-ordered size deletes it", async () => {
      const p = await prod("rose");
      const a = await variant(p.id, "rose-a", { size: "A" });
      await variant(p.id, "rose-b", { size: "B" });
      const r = await post(`/admin/products/${p.id}/prices/remove`, { remove: String(a.id) });
      expect(r.status).toBe(303);
      expect((await variantsOf(p.id)).map((x) => x.sizeLabel)).toEqual(["B"]);
    });

    it("removing an ordered size hides it and keeps the order line", async () => {
      const p = await prod("rose");
      const a = await variant(p.id, "rose-a", { size: "A" });
      await variant(p.id, "rose-b", { size: "B" });
      const [o] = await d()
        .insert(s.orders)
        .values({ number: 1, customerName: "N", phone: "1", email: "e@x.com", address: "{}", subtotalPaise: 1, totalPaise: 1, createdAt: NOW, updatedAt: NOW })
        .returning();
      await d().insert(s.orderItems).values({ orderId: o!.id, variantId: a.id, productTitle: "rose", sizeLabel: "A", unitPricePaise: 1, quantity: 1, lineTotalPaise: 1 });
      const r = await post(`/admin/products/${p.id}/prices/remove`, { remove: String(a.id) });
      expect(r.status).toBe(303);
      const v = (await variantsOf(p.id)).find((x) => x.id === a.id);
      expect([v!.hidden, v!.inStock]).toEqual([1, 0]);
      expect((await d().select().from(s.orderItems)).length).toBe(1);
    });

    it("cannot remove another product's size", async () => {
      const p = await prod("rose");
      const q = await prod("lily");
      const v = await variant(q.id, "lily-a");
      expect((await post(`/admin/products/${p.id}/prices/remove`, { remove: String(v.id) })).status).toBe(404);
      expect((await variantsOf(q.id)).length).toBe(1);
    });
  });

  it("no screen shows the words SKU, handle or variant (text or attributes)", async () => {
    const c = await cat("plants");
    const p = await prod("rose", { title: "Rose", photo: true, raw: ["Gulab"] });
    const v = await variant(p.id, "rose-a", { size: "Small" });
    const bare = await prod("bare", { title: "Bare" });
    const pages = ["/admin/products", "/admin/products?q=rose&filter=draft", "/admin/products/new", `/admin/products/${p.id}`, `/admin/products/${p.id}/prices`];
    const priceErr = await post(`/admin/products/${p.id}/prices`, { [`price_${v.id}`]: "abc" });
    expect(priceErr.status).toBe(400);
    const editErr = await post(`/admin/products/${p.id}`, { name: "" });
    expect(editErr.status).toBe(400);
    const pubErr = await post(`/admin/products/${bare.id}/status`, { status: "published" });
    expect(pubErr.status).toBe(400);
    const errs = [
      await post("/admin/products/new", { name: "", category: String(c.id) }),
      priceErr,
      await post(`/admin/products/${p.id}/prices/add`, { size: "" }),
      editErr,
      pubErr,
    ];
    const htmls = [...(await Promise.all(pages.map(async (u) => (await get(u)).text()))), ...(await Promise.all(errs.map((r) => r.text())))];
    for (const h of htmls) {
      expect(text(h).toLowerCase()).not.toMatch(/sku|handle|variant/);
      const attrs = [...h.matchAll(/\s(?:placeholder|aria-label|title|alt|value)="([^"]*)"/g)].map((m) => m[1]).join(" ");
      expect(attrs.toLowerCase()).not.toMatch(/sku|handle|variant/);
    }
  });
});

describe("final fix wave: sizes", () => {
  it("saving prices leaves a size added after the page loaded untouched", async () => {
    const p = await prod("fw-rose");
    const a = await variant(p.id, "fw-rose-a", { size: "A", price: 100 });
    // Someone else adds size B (priced, in stock) after this form was loaded: the form has no price_B field.
    const b = await variant(p.id, "fw-rose-b", { size: "B", price: 500 });
    const r = await post(`/admin/products/${p.id}/prices`, { [`price_${a.id}`]: "200", [`stock_${a.id}`]: "1" });
    expect(r.status).toBe(303);
    const rows = await variantsOf(p.id);
    expect(rows.find((x) => x.id === a.id)).toMatchObject({ pricePaise: 20000, inStock: 1 });
    expect(rows.find((x) => x.id === b.id)).toMatchObject({ pricePaise: 500, inStock: 1 });
  });

  it("a product can have at most 40 sizes", async () => {
    const p = await prod("fw-many");
    await env.DB.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40) INSERT INTO variants (product_id, sku, size_label) SELECT ?, 'fw-many-' || i, 'S' || i FROM n",
    ).bind(p.id).run();
    const r = await post(`/admin/products/${p.id}/prices/add`, { size: "One more", colour: "" });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("A product can have at most 40 sizes");
    expect(await variantsOf(p.id)).toHaveLength(40);
  });
});
