import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { admin } from "../src/admin/index";
import { productCounts } from "../src/admin/products";
import type { Env } from "../src/env";

const d = () => db(env);
const NOW = "2026-11-26T00:00:00.000Z";
const devEnv = { ...env, ENVIRONMENT: "development", IMAGE_BASE_URL: "" } as unknown as Env;
const get = async (path: string) => (await admin.request(`http://localhost${path}`, {}, devEnv)).text();
const text = (html: string) => html.replace(/<(style|script)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ");

async function prod(handle: string, o: { status?: string; photo?: string; similar?: boolean; inStock?: number } = {}) {
  const title = handle[0]!.toUpperCase() + handle.slice(1);
  const [p] = await d()
    .insert(s.products)
    .values({ handle, title, status: o.status ?? "draft", representativePhoto: o.similar ? 1 : 0, createdAt: NOW, updatedAt: NOW })
    .returning();
  if (o.photo) await d().insert(s.productImages).values({ productId: p!.id, r2Key: o.photo });
  await d().insert(s.variants).values({ productId: p!.id, sku: `${handle}-s`, sizeLabel: "Standard", inStock: o.inStock ?? 1 });
  return p!;
}

describe("admin product list", () => {
  beforeEach(async () => {
    for (const t of [s.orderStatusLog, s.refunds, s.orderItems, s.orders, s.variants, s.productImages, s.productSources, s.productCategories, s.products, s.categories]) {
      await d().delete(t);
    }
  });

  it("rows show a thumbnail and a status badge", async () => {
    await prod("rose", { status: "published", photo: "products/rose/a.jpg" });
    await prod("tulip");
    await prod("lily", { status: "published", photo: "products/lily/a.jpg", similar: true });
    const html = await get("/admin/products");
    expect(html).toContain("/img/products/rose/a.jpg");
    expect(html).toContain("Showing in shop");
    expect(html).toContain("Needs a photo");
    expect(html).toContain("Similar photo");
  });

  it("filter tabs show counts", async () => {
    await prod("rose", { status: "published", photo: "r.jpg" });
    await prod("lily", { status: "published", photo: "l.jpg" });
    await prod("tulip");
    const t = text(await get("/admin/products"));
    expect(t).toMatch(/All\s*3/);
    expect(t).toMatch(/Hidden\s*1/);
  });

  it("counts stay right as photos, status and products change", async () => {
    const live = async () =>
      env.DB.prepare(
        `SELECT COUNT(*) AS "all", COALESCE(SUM(status = 'published'), 0) AS published, COALESCE(SUM(status = 'draft'), 0) AS draft,
          COALESCE(SUM(NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)), 0) AS needsPhoto, COALESCE(SUM(representative_photo = 1), 0) AS similar
        FROM products p`,
      ).first();
    const rose = await prod("rose", { photo: "r.jpg" });
    const lily = await prod("lily");
    await d().insert(s.productImages).values({ productId: rose.id, r2Key: "r2.jpg" });
    await env.DB.prepare("UPDATE products SET status = 'published', representative_photo = 1 WHERE id = ?").bind(rose.id).run();
    await env.DB.prepare("DELETE FROM product_images WHERE product_id = ? AND r2_key = 'r.jpg'").bind(rose.id).run();
    await env.DB.prepare("UPDATE product_images SET product_id = ? WHERE product_id = ?").bind(lily.id, rose.id).run();
    expect(await productCounts(env)).toEqual(await live());
    await env.DB.prepare("DELETE FROM variants WHERE product_id = ?").bind(lily.id).run();
    await env.DB.prepare("DELETE FROM product_images WHERE product_id = ?").bind(lily.id).run();
    await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(lily.id).run();
    expect(await productCounts(env)).toEqual(await live());
    expect(await productCounts(env)).toMatchObject({ all: 1, published: 1, needsPhoto: 1, similar: 1 });
  });

  it("similar filter lists only similar-photo products", async () => {
    await prod("rose", { status: "published", photo: "r.jpg", similar: true });
    await prod("lily", { status: "published", photo: "l.jpg" });
    const html = await get("/admin/products?filter=similar");
    expect(html).toContain(">Rose<");
    expect(html).not.toContain(">Lily<");
  });

  it("out-of-stock filter lists products with no in-stock size", async () => {
    await prod("rose", { inStock: 0 });
    await prod("lily");
    const html = await get("/admin/products?filter=out-of-stock");
    expect(html).toContain(">Rose<");
    expect(html).not.toContain(">Lily<");
  });

  it("add-photo picker searches and links to the product with the sheet open", async () => {
    const rose = await prod("rose");
    await prod("lily");
    const html = await get("/admin/add-photo?q=ros");
    expect(html).toContain(`href="/admin/products/${rose.id}?add=1"`);
    expect(html).toContain("Rose");
    expect(html).not.toContain(">Lily<");
    expect(await get("/admin/add-photo")).toContain("Which product?");
  });
});
