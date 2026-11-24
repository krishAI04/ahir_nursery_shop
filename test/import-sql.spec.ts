import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProductDraft } from "../scripts/catalog/build";
import { photoKeyFor, toSql } from "../scripts/catalog/sql";

const NOW = "2026-11-20T00:00:00.000Z";
const mk = (o: Partial<ProductDraft>): ProductDraft => ({
  handle: "h",
  title: "T",
  status: "draft",
  categoryPaths: [["Plants", "Fruit Plants"]],
  photoFile: null,
  credit: null,
  representative: false,
  variants: [{ sku: "h-standard", size: "Standard", colour: null, rawNames: ["T"] }],
  source: { sheetRows: ["s#2"], rawNames: ["T"], notes: ["n"], photoSource: "", sourceUrl: "", license: "", author: "" },
  ...o,
});
const base = (): ProductDraft[] => [
  mk({
    handle: "mango",
    title: `Bob's "Mango"`,
    status: "published",
    photoFile: "plants/Mango Tree.jpg",
    credit: { author: "A", license: "CC", source_url: "u" },
    variants: [
      { sku: "mango-bag-8x10", size: "Bag 8×10", colour: null, rawNames: ["a"] },
      { sku: "mango-bag-9x11", size: "Bag 9×11", colour: null, rawNames: ["b"] },
    ],
  }),
  mk({
    handle: "blossom",
    title: "Blossom Pot",
    categoryPaths: [["Pots & Planters", "Fruit Plants"], ["Plants", "Fruit Plants"]],
    variants: [
      { sku: "blossom-8-in-black", size: "8 in", colour: "Black", rawNames: [] },
      { sku: "blossom-8-in-terracotta", size: "8 in", colour: "Terracotta", rawNames: [] },
    ],
  }),
  mk({ handle: "code1", title: "FPS 12", categoryPaths: [["Unsorted"]] }),
];
const apply = async (ds: ProductDraft[]) => {
  for (const b of toSql(ds, photoKeyFor, NOW)) await env.DB.exec(b);
};
const one = async <T>(q: string) => (await env.DB.prepare(q).first<T>())!;
const n = async (t: string) => (await one<{ c: number }>(`SELECT count(*) c FROM ${t}`)).c;
const TABLES = ["categories", "products", "variants", "product_images", "product_categories", "product_sources"];
const counts = () => Promise.all(TABLES.map(n));

describe("catalogue import SQL", () => {
  beforeEach(async () => {
    for (const t of [...TABLES].reverse()) await env.DB.exec(`DELETE FROM ${t}`);
  });

  it("loads drafts, categories and photos as built", async () => {
    await apply(base());
    // categories: plants, plants-fruit-plants, pots-planters, pots-planters-fruit-plants, unsorted
    expect(await counts()).toEqual([5, 3, 5, 1, 4, 3]);
    const p = await one<any>("SELECT * FROM products WHERE handle='mango'");
    expect(p).toMatchObject({ title: `Bob's "Mango"`, status: "published", representative_photo: 0, created_at: NOW, updated_at: NOW });
    expect(JSON.parse(p.photo_credit)).toEqual({ author: "A", license: "CC", source_url: "u" });
    expect(await one("SELECT r2_key, position FROM product_images")).toEqual({ r2_key: "products/mango/mango-tree.jpg", position: 1 });
    expect((await one<any>("SELECT count(*) c FROM variants WHERE price_paise IS NOT NULL")).c).toBe(0);
    expect((await one<any>("SELECT is_internal FROM categories WHERE handle='unsorted'")).is_internal).toBe(1);
    expect((await one<any>("SELECT p.handle ph FROM categories c JOIN categories p ON p.id=c.parent_id WHERE c.handle='plants-fruit-plants'")).ph).toBe("plants");
    expect((await one<any>("SELECT count(*) c FROM variants WHERE colour IS NOT NULL")).c).toBe(2);
    expect((await one<any>("SELECT sheet_rows FROM product_sources WHERE product_id=(SELECT id FROM products WHERE handle='mango')")).sheet_rows).toBe('["s#2"]');
  });

  it("applying twice changes nothing", async () => {
    await apply(base());
    const before = await counts();
    await apply(base());
    expect(await counts()).toEqual(before);
  });

  it("keeps staff edits and only adds a new variant", async () => {
    await apply(base());
    await env.DB.exec("UPDATE variants SET price_paise=9900 WHERE sku='mango-bag-8x10'");
    await env.DB.exec("UPDATE products SET title='Renamed', status='draft' WHERE handle='mango'");
    await env.DB.exec("DELETE FROM product_images");
    await env.DB.exec(
      "DELETE FROM product_categories WHERE product_id=(SELECT id FROM products WHERE handle='blossom') AND category_id=(SELECT id FROM categories WHERE handle='plants-fruit-plants')",
    );
    const before = await counts();
    const ds = base();
    ds[0].variants.push({ sku: "mango-bag-10x12", size: "Bag 10×12", colour: null, rawNames: [] });
    await apply(ds);
    expect(await counts()).toEqual(before.map((c, i) => (i === 2 ? c + 1 : c)));
    expect(await one("SELECT title, status FROM products WHERE handle='mango'")).toEqual({ title: "Renamed", status: "draft" });
    expect((await one<any>("SELECT price_paise FROM variants WHERE sku='mango-bag-8x10'")).price_paise).toBe(9900);
    expect(await n("product_images")).toBe(0);
  });

  it("an interrupted run (product row, no sources row) completes once on re-apply", async () => {
    await apply(base());
    await env.DB.exec("DELETE FROM product_sources WHERE product_id=(SELECT id FROM products WHERE handle='mango')");
    await env.DB.exec("DELETE FROM product_images");
    await env.DB.exec("DELETE FROM product_categories WHERE product_id=(SELECT id FROM products WHERE handle='mango')");
    await apply(base());
    await apply(base());
    expect(await counts()).toEqual([5, 3, 5, 1, 4, 3]);
  });
});
