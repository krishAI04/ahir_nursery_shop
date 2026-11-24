import { Hono } from "hono";
import type { Env } from "../env";
import { imageUrl } from "../lib/images";
import { likePattern, parsePage } from "../lib/query";

export const catalog = new Hono<{ Bindings: Env }>();

const PAGE_SIZE = 24;
// Browsers and proxies may reuse store reads for 2 minutes (price edits show up within that window).
const CACHED = { "Cache-Control": "public, max-age=120" };
// Visible = published and not linked to any internal category (e.g. Unsorted).
const VISIBLE = `p.status = 'published' AND NOT EXISTS (
  SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
  WHERE pc.product_id = p.id AND c.is_internal = 1)`;

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const isSafeKey = (key: string): boolean => !key.includes("..") && key.split("/").every((s) => s !== "" && s !== ".");

type ProductRow = { id: number; handle: string; title: string; rep: number; thumb: string | null; min_price: number | null };
type DetailRow = { id: number; handle: string; title: string; description: string | null; photo_credit: string | null; representative_photo: number };
type CatRow = { id: number; parent_id: number | null; handle: string; is_internal: number };
const marks = (xs: unknown[]) => xs.map(() => "?").join(", ");
type VariantRow = { sku: string; size_label: string; colour: string | null; price_paise: number | null; in_stock: number };


catalog.get("/api/store/categories", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, parent_id, name, handle FROM categories WHERE is_internal = 0 ORDER BY name",
  ).all<{ id: number; parent_id: number | null; name: string; handle: string }>();
  type Node = { handle: string; name: string; children: Node[] };
  const nodes = new Map(results.map((r) => [r.id, { handle: r.handle, name: r.name, children: [] } as Node]));
  const roots: Node[] = [];
  for (const r of results) {
    const parent = r.parent_id == null ? undefined : nodes.get(r.parent_id);
    const node = nodes.get(r.id);
    if (!node) continue;
    // Children of an internal (excluded) parent have no visible parent, so they become roots.
    (parent ? parent.children : roots).push(node);
  }
  return c.json(roots, 200, CACHED);
});

catalog.get("/api/store/products", async (c) => {
  const page = parsePage(c.req.query("page"));
  const category = c.req.query("category");
  const q = c.req.query("q")?.trim();
  // D1 bills rows read: one cheap pass picks the visible ids in title order (index walk), then only the page's rows are joined.
  const { results: cats } = await c.env.DB.prepare("SELECT id, parent_id, handle, is_internal FROM categories").all<CatRow>();
  const hidden = cats.filter((x) => x.is_internal === 1).map((x) => x.id);
  const args: (string | number)[] = [];
  let from = "products p WHERE";
  if (category) {
    const handleOf = new Map(cats.map((x) => [x.id, x.handle]));
    const ids = cats.filter((x) => x.handle === category || (x.parent_id != null && handleOf.get(x.parent_id) === category)).map((x) => x.id);
    if (!ids.length) return c.json({ items: [], page, total: 0 }, 200, CACHED);
    // CROSS JOIN pins the loop order: start from the category rows, not a title-index walk with one seek per category id.
    from = `product_categories pcf CROSS JOIN products p ON p.id = pcf.product_id WHERE pcf.category_id IN (${marks(ids)}) AND`;
    args.push(...ids);
  }
  let where = "p.status = 'published'";
  if (hidden.length) {
    where += ` AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id IN (${marks(hidden)}))`;
    args.push(...hidden);
  }
  if (q) {
    where += ` AND p.title LIKE ? ESCAPE '!'`;
    args.push(likePattern(q));
  }
  const { results: all } = await c.env.DB.prepare(`SELECT DISTINCT p.id FROM ${from} ${where} ORDER BY p.title COLLATE NOCASE, p.id`)
    .bind(...args)
    .all<{ id: number }>();
  const pageIds = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => r.id);
  let rows: ProductRow[] = [];
  if (pageIds.length) {
    rows = (
      await c.env.DB.prepare(
        `SELECT p.id, p.handle, p.title, p.representative_photo AS rep,
          (SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS thumb,
          (SELECT MIN(v.price_paise) FROM variants v WHERE v.product_id = p.id AND v.hidden = 0 AND v.in_stock = 1) AS min_price
        FROM products p WHERE p.id IN (${marks(pageIds)})`,
      )
        .bind(...pageIds)
        .all<ProductRow>()
    ).results;
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = pageIds.flatMap((id) => {
    const r = byId.get(id);
    return r
      ? [{
          handle: r.handle,
          title: r.title,
          thumbnail_url: r.thumb ? imageUrl(c.env, r.thumb) : null,
          min_price_paise: r.min_price ?? null,
          price_on_request: r.min_price == null,
          representative_photo: r.rep === 1,
        }]
      : [];
  });
  return c.json({ items, page, total: all.length }, 200, CACHED);
});

catalog.get("/api/store/products/:handle", async (c) => {
  const p = await c.env.DB.prepare(
    `SELECT p.id, p.handle, p.title, p.description, p.photo_credit, p.representative_photo
     FROM products p WHERE p.handle = ? AND ${VISIBLE}`,
  ).bind(c.req.param("handle")).first<DetailRow>();
  if (!p) return c.json({ error: "not_found" }, 404);
  const [imgs, vars, cats] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT r2_key FROM product_images WHERE product_id = ? ORDER BY position, id").bind(p.id),
    c.env.DB.prepare(
      "SELECT sku, size_label, colour, price_paise, in_stock FROM variants WHERE product_id = ? AND hidden = 0 ORDER BY position, id",
    ).bind(p.id),
    c.env.DB.prepare(
      `SELECT c.handle, c.name FROM product_categories pc JOIN categories c ON c.id = pc.category_id
       WHERE pc.product_id = ? AND c.is_internal = 0 ORDER BY c.name`,
    ).bind(p.id),
  ]);
  let credit: unknown = null;
  try {
    credit = p.photo_credit ? JSON.parse(p.photo_credit) : null;
  } catch {
    credit = null;
  }
  return c.json({
    handle: p.handle,
    title: p.title,
    description: p.description,
    images: (imgs?.results as { r2_key: string }[] | undefined ?? []).map((r) => imageUrl(c.env, r.r2_key)),
    variants: (vars?.results as VariantRow[] | undefined ?? []).map((v) => ({
      sku: v.sku,
      size: v.size_label,
      colour: v.colour,
      price_paise: v.price_paise,
      in_stock: v.in_stock === 1,
    })),
    photo_credit: credit,
    representative_photo: p.representative_photo === 1,
    categories: cats?.results ?? [],
  }, 200, CACHED);
});

// Price enquiries go to the shop's WhatsApp; the storefront adds "?text=..." with the product and size.
catalog.get("/api/store/contact", (c) => {
  const n = c.env.SHOP_WHATSAPP.replace(/\D/g, "");
  return c.json({ whatsapp_number: n || null, whatsapp_url: n ? `https://wa.me/${n}` : null }, 200, CACHED);
});

catalog.get("/img/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!isSafeKey(key)) return c.notFound();
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const stored = obj.httpMetadata?.contentType;
  const type = stored && ["image/jpeg", "image/png", "image/webp"].includes(stored) ? stored : (MIME[ext] ?? "application/octet-stream");
  return new Response(obj.body, {
    headers: {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});
