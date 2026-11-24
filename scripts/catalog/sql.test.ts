import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDrafts, type ProductDraft } from "./build";
import { readCatalog } from "./csv";
import { photoKeyFor, toSql } from "./sql";

const NOW = "2026-11-20T00:00:00.000Z";
const draft = (o: Partial<ProductDraft> = {}): ProductDraft => ({
  handle: "x",
  title: "X",
  status: "draft",
  categoryPaths: [["Plants", "Fruit Plants"]],
  photoFile: null,
  credit: null,
  representative: false,
  variants: [{ sku: "x-standard", size: "Standard", colour: null, rawNames: ["X"] }],
  source: { sheetRows: ["a#1"], rawNames: ["X"], notes: [], photoSource: "", sourceUrl: "", license: "", author: "" },
  ...o,
});
const all = (ds: ProductDraft[]) => toSql(ds, photoKeyFor, NOW).join("\n");

describe("toSql", () => {
  it("escapes quotes and keeps one statement per line", () => {
    const sql = all([draft({ title: "Bob's \"12\\\" pot'; DROP TABLE products;--\nline2", handle: "bobs" })]);
    expect(sql).toContain("'Bob''s \"12\\\" pot''; DROP TABLE products;--' || char(10) || 'line2'");
    for (const line of sql.split("\n")) expect(line.endsWith(";")).toBe(true);
  });

  it("batches at most 50 statements and never splits a product", () => {
    const ds = Array.from({ length: 120 }, (_, i) =>
      draft({
        handle: `p${i}`,
        title: `P${i}`,
        variants: [1, 2, 3].map((n) => ({ sku: `p${i}-${n}`, size: `S${n}`, colour: null, rawNames: [] })),
      }),
    );
    const batches = toSql(ds, photoKeyFor, NOW);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(b.split("\n").length).toBeLessThanOrEqual(50);
    const count = (re: RegExp) => batches.map((b) => b.split("\n").filter((l) => re.test(l)).length);
    expect(count(/INTO products /)).toEqual(count(/INTO product_sources/));
  });

  it("is create-only SQL with no prices", () => {
    const sql = all([draft({ photoFile: "plants/Mango Tree.JPG" })]);
    expect(sql).not.toMatch(/price_paise/);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|REPLACE/);
    expect(sql).toContain("products/x/mango-tree.jpg");
  });

  it("marks Unsorted internal and uses full-path handles", () => {
    const sql = all([
      draft({ categoryPaths: [["Unsorted"]] }),
      draft({ handle: "y", categoryPaths: [["Plants", "Fruit Plants"], ["Decor", "Fruit Plants"]] }),
    ]);
    expect(sql).toMatch(/INTO categories \(.*\) VALUES \('Unsorted', 'unsorted', NULL, 1\)/);
    expect(sql).toContain("'plants-fruit-plants'");
    expect(sql).toContain("'decor-fruit-plants'");
  });

  it("builds the fixture", () => {
    const rows = readCatalog(path.join(import.meta.dirname, "fixtures", "catalog-mini.csv"));
    const ds = buildDrafts(rows, [], new Map());
    const sql = all(ds);
    expect(sql.split("\n").filter((l) => /INTO products /.test(l)).length).toBe(ds.length);
  });

  it("sanitises photo keys to [a-z0-9._/-]", () => {
    const k = photoKeyFor(draft({ photoFile: "plants/Pots & Planters (Big) #1's.jpg" }))!;
    expect(k).toBe("products/x/pots-planters-big-1-s.jpg");
    expect(k).toMatch(/^[a-z0-9._/-]+$/);
    expect(photoKeyFor(draft({ photoFile: "a/$(rm -rf);x^%y`.png" }))).toMatch(/^products\/x\/[a-z0-9._-]+$/);
  });

  it("splits a product with more than 50 statements across batches", () => {
    const variants = Array.from({ length: 60 }, (_, i) => ({ sku: `x-${i}`, size: `S${i}`, colour: null, rawNames: [] }));
    const batches = toSql([draft({ variants })], photoKeyFor, NOW);
    for (const b of batches) expect(b.split("\n").length).toBeLessThanOrEqual(50);
    const lines = batches.join("\n").split("\n");
    expect(lines.filter((l) => /INTO variants/.test(l)).length).toBe(60);
    expect(/INTO product_sources/.test(lines[lines.length - 1])).toBe(true);
  });

  it("handles CR, CRLF and NUL in text", () => {
    const sql = all([draft({ title: "a\r\nb\rc\0d" })]);
    expect(sql).toContain("'a' || char(10) || 'b' || char(10) || 'cd'");
    expect(sql).not.toContain("\0");
    expect(sql).not.toContain("\r");
    for (const line of sql.split("\n")) expect(line.endsWith(";")).toBe(true);
  });

  it("throws when two category paths give the same handle", () => {
    expect(() => all([draft({ categoryPaths: [["A B"]] }), draft({ handle: "y", categoryPaths: [["A", "B"]] })])).toThrow(/collides.*A B.*A.*B/);
  });
});

describe("toSql missing photo", () => {
  it("writes a published product as draft when its photo file is missing on disk", () => {
    const d = draft({ handle: "gone", status: "published", photoFile: "plants/Gone.jpg" });
    const missing = toSql([d], () => null, NOW).join("\n");
    expect(missing).toMatch(/INSERT OR IGNORE INTO products .*VALUES \('gone', 'X', 'draft'/);
    expect(missing).not.toContain("product_images");
    const found = toSql([d], photoKeyFor, NOW).join("\n");
    expect(found).toMatch(/VALUES \('gone', 'X', 'published'/);
  });
});
