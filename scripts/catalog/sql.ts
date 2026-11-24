import { slug } from "../../src/lib/slug";
import type { ProductDraft } from "./build";

// Pure (no Node imports): also runs in the Worker test pool.
// Create-only: every insert is INSERT OR IGNORE and nothing is ever updated or deleted, so
// re-running keeps staff edits. Photo and category links are written only while the product has
// no product_sources row yet (that row is the last statement of a product), so a photo or category
// staff removed is not put back. New variants are always added. Each statement is on one line.

const MAX = 50;

const q = (s: string) => `'${s.replace(/\0/g, "").replace(/'/g, "''").replace(/\r\n|\r|\n/g, "' || char(10) || '")}'`;
const lit = (s: string | null) => (s === null ? "NULL" : q(s));
const byHandle = (table: string, handle: string) => `(SELECT id FROM ${table} WHERE handle = ${q(handle)})`;

/** R2 key for a draft's photo: products/<handle>/<file name lowercased, spaces to dashes>. */
export function photoKeyFor(d: ProductDraft): string | null {
  if (!d.photoFile) return null;
  // Keys only use [a-z0-9._/-]: anything else becomes "-", repeats collapse, no leading dots.
  const base = d.photoFile
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+/, "");
  return `products/${slug(d.handle)}/${base || "photo"}`;
}

export function toSql(drafts: ProductDraft[], photoKey: (d: ProductDraft) => string | null, now = new Date().toISOString()): string[] {
  const cats = new Map<string, { path: string; sql: string }>();
  const catSql = (path: string[]) => {
    for (let i = 0; i < path.length; i++) {
      const handle = slug(path.slice(0, i + 1).join(" "));
      const here = JSON.stringify(path.slice(0, i + 1));
      const seen = cats.get(handle);
      if (seen) {
        if (seen.path !== here) throw new Error(`category handle "${handle}" collides: ${seen.path} vs ${here}`);
        continue;
      }
      const parent = i ? byHandle("categories", slug(path.slice(0, i).join(" "))) : "NULL";
      const internal = path[0] === "Unsorted" ? 1 : 0;
      cats.set(handle, {
        path: here,
        sql: `INSERT OR IGNORE INTO categories (name, handle, parent_id, is_internal) VALUES (${q(path[i])}, ${q(handle)}, ${parent}, ${internal});`,
      });
    }
    return slug(path.join(" "));
  };

  const groups: string[][] = [];
  for (const d of drafts) {
    const key = photoKey(d);
    // A published product whose photo file is missing on disk would show without a photo: import it as a draft.
    const status = d.status === "published" && !key ? "draft" : d.status;
    const fresh = `NOT EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id = p.id)`;
    const g: string[] = [
      `INSERT OR IGNORE INTO products (handle, title, status, photo_credit, representative_photo, created_at, updated_at) VALUES (${q(d.handle)}, ${q(d.title)}, ${q(status)}, ${lit(d.credit ? JSON.stringify(d.credit) : null)}, ${d.representative ? 1 : 0}, ${q(now)}, ${q(now)});`,
    ];
    d.variants.forEach((v, i) =>
      g.push(
        `INSERT OR IGNORE INTO variants (product_id, sku, size_label, colour, in_stock, hidden, position) SELECT p.id, ${q(v.sku)}, ${q(v.size)}, ${lit(v.colour)}, 1, 0, ${i} FROM products p WHERE p.handle = ${q(d.handle)};`,
      ),
    );
    if (key)
      g.push(
        `INSERT OR IGNORE INTO product_images (product_id, r2_key, position) SELECT p.id, ${q(key)}, 1 FROM products p WHERE p.handle = ${q(d.handle)} AND ${fresh};`,
      );
    for (const leaf of new Set(d.categoryPaths.map(catSql)))
      g.push(
        `INSERT OR IGNORE INTO product_categories (product_id, category_id) SELECT p.id, c.id FROM products p, categories c WHERE p.handle = ${q(d.handle)} AND c.handle = ${q(leaf)} AND ${fresh};`,
      );
    const s = d.source;
    g.push(
      `INSERT OR IGNORE INTO product_sources (product_id, sheet_rows, raw_names, notes, photo_source, source_url, license, author) SELECT p.id, ${q(JSON.stringify(s.sheetRows))}, ${q(JSON.stringify(s.rawNames))}, ${q(JSON.stringify(s.notes))}, ${q(s.photoSource)}, ${q(s.sourceUrl)}, ${q(s.license)}, ${q(s.author)} FROM products p WHERE p.handle = ${q(d.handle)};`,
    );
    groups.push(g);
  }

  // Categories first (parents were added before children), then whole products packed into batches.
  const batches: string[][] = [];
  const all = [...cats.values()].map((c) => c.sql);
  for (let i = 0; i < all.length; i += MAX) batches.push(all.slice(i, i + MAX));
  let cur: string[] = [];
  for (const g of groups) {
    if (g.length > MAX) {
      // Safe to split: the sources row is last, so an interrupted run completes on re-apply.
      if (cur.length) batches.push(cur);
      cur = [];
      for (let i = 0; i < g.length; i += MAX) batches.push(g.slice(i, i + MAX));
      continue;
    }
    if (cur.length && cur.length + g.length > MAX) {
      batches.push(cur);
      cur = [];
    }
    cur.push(...g);
  }
  if (cur.length) batches.push(cur);
  return batches.map((b) => b.join("\n"));
}
