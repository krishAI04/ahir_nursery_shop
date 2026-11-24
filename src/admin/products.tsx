import type { Env } from "../env";
import { likePattern, parsePage } from "../lib/query";
import { slug } from "../lib/slug";
import { Layout } from "./layout";
import type { AdminApp } from "./index";

const PAGE_SIZE = 50;
const FILTERS: [string, string][] = [
  ["", "All"],
  ["published", "Published"],
  ["draft", "Hidden (draft)"],
  ["needs-photo", "Needs photo"],
  ["no-price", "Price on request"],
];

export type Category = { id: number; name: string };

export const Notice = (p: { saved?: boolean; error?: string }) => (
  <>
    {p.saved && (
      <p role="status" style="background:#e3f2e3;padding:8px 12px;border-radius:8px">
        Saved.
      </p>
    )}
    {p.error && (
      <p role="alert" style="background:#fde8e8;padding:8px 12px;border-radius:8px">
        {p.error}
      </p>
    )}
  </>
);

export async function loadCategories(env: Env): Promise<Category[]> {
  const { results } = await env.DB.prepare("SELECT id, name FROM categories WHERE is_internal = 0 ORDER BY name").all<Category>();
  return results;
}

/** First free value of `base`, `base-2`, `base-3`... in the given column (one query when the pattern fits D1's LIKE limit). */
export async function uniqueSlug(env: Env, table: "products" | "variants", column: "handle" | "sku", base: string): Promise<string> {
  const pattern = `${base.replace(/[!%_]/g, "!$&")}-%`;
  if (new TextEncoder().encode(pattern).length <= 50) {
    const { results } = await env.DB.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} = ? OR ${column} LIKE ? ESCAPE '!'`)
      .bind(base, pattern)
      .all<{ v: string }>();
    const taken = new Set(results.map((r) => r.v));
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const hit = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).bind(candidate).first();
    if (!hit) return candidate;
  }
}

function NewProductPage(p: { email: string; categories: Category[]; name?: string; category?: string; error?: string }) {
  return (
    <Layout title="New product" email={p.email}>
      <Notice error={p.error} />
      <form method="post" action="/admin/products/new">
        <p>
          <label>
            Name
            <br />
            <input name="name" value={p.name ?? ""} maxlength={120} required style="width:100%" />
          </label>
        </p>
        <p>
          <label>
            Category
            <br />
            <select name="category" required>
              <option value="">Choose a category</option>
              {p.categories.map((c) => (
                <option value={String(c.id)} selected={p.category === String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </p>
        <button type="submit">Create product</button>
      </form>
    </Layout>
  );
}

type Row = { id: number; title: string; status: string; photos: number; no_price: number };

export function mountProducts(admin: AdminApp) {
  admin.get("/admin/products", async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    const wanted = c.req.query("filter") ?? "";
    const filter = FILTERS.some(([k]) => k === wanted) ? wanted : "";
    const page = parsePage(c.req.query("page"));
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q) {
      where.push(`(p.title LIKE ? ESCAPE '!' OR COALESCE((SELECT ps.raw_names FROM product_sources ps WHERE ps.product_id = p.id), '') LIKE ? ESCAPE '!')`);
      const pat = likePattern(q);
      args.push(pat, pat);
    }
    if (filter === "published" || filter === "draft") {
      where.push("p.status = ?");
      args.push(filter);
    }
    if (filter === "needs-photo") where.push("NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)");
    if (filter === "no-price") where.push("EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.hidden = 0 AND v.price_paise IS NULL)");
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // Pick the page's ids first (title index walk), then count photos/prices for those rows only; one extra row tells "Next".
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.title, p.status,
        (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS photos,
        EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.hidden = 0 AND v.price_paise IS NULL) AS no_price
      FROM (SELECT p.id FROM products p ${w} ORDER BY p.title COLLATE NOCASE, p.id LIMIT ${PAGE_SIZE + 1} OFFSET ?) page
      JOIN products p ON p.id = page.id ORDER BY p.title COLLATE NOCASE, p.id`,
    )
      .bind(...args, (page - 1) * PAGE_SIZE)
      .all<Row>();
    const rows = results.slice(0, PAGE_SIZE);
    const hasMore = results.length > PAGE_SIZE;
    const link = (over: Record<string, string>) => {
      const sp = new URLSearchParams();
      const vals: Record<string, string> = { q, filter, page: String(page), ...over };
      for (const [k, v] of Object.entries(vals)) if (v && !(k === "page" && v === "1")) sp.set(k, v);
      const s = sp.toString();
      return `/admin/products${s ? `?${s}` : ""}`;
    };
    return c.html(
      <Layout title="Products" email={c.var.staffEmail}>
        <form method="get" action="/admin/products">
          <input type="search" name="q" value={q} placeholder="Search by name" aria-label="Search by name" />
          {filter && <input type="hidden" name="filter" value={filter} />}
          <button type="submit">Search</button>
        </form>
        <p style="display:flex;flex-wrap:wrap;gap:8px">
          {FILTERS.map(([k, label]) => (
            <a class="btn" href={link({ filter: k, page: "1" })} style={k === filter ? "" : "background:#e8efe3;color:#1c3d1c"}>
              {label}
            </a>
          ))}
          <a class="btn" href="/admin/products/new">
            New product
          </a>
        </p>
        {rows.length === 0 && <p>No products found.</p>}
        <ul style="list-style:none;padding:0">
          {rows.map((r) => (
            <li style="padding:8px 0;border-bottom:1px solid #ddd">
              <a href={`/admin/products/${r.id}`}>{r.title}</a>
              <br />
              <small>
                {r.status === "published" ? "Published" : "Hidden"}
                {r.photos === 0 && " · Needs photo"}
                {r.no_price ? " · Price on request" : ""}
              </small>
            </li>
          ))}
        </ul>
        <p>
          {page > 1 && (
            <a class="btn" href={link({ page: String(page - 1) })}>
              Previous
            </a>
          )}{" "}
          {hasMore && (
            <a class="btn" href={link({ page: String(page + 1) })}>
              Next
            </a>
          )}
        </p>
      </Layout>,
    );
  });

  admin.get("/admin/products/new", async (c) =>
    c.html(<NewProductPage email={c.var.staffEmail} categories={await loadCategories(c.env)} />),
  );

  admin.post("/admin/products/new", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    const category = String(body.category ?? "");
    const categories = await loadCategories(c.env);
    const fail = (error: string) =>
      c.html(<NewProductPage email={c.var.staffEmail} categories={categories} name={String(body.name ?? "")} category={category} error={error} />, 400);
    if (!name) return fail("Enter a name");
    if (name.length > 120) return fail("The name must be 120 characters or fewer");
    const cat = categories.find((x) => String(x.id) === category);
    if (!cat) return fail("Choose a category");
    const handle = await uniqueSlug(c.env, "products", "handle", slug(name));
    const sku = await uniqueSlug(c.env, "variants", "sku", `${handle}-${slug("Standard")}`);
    const now = new Date().toISOString();
    const [ins] = await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO products (handle, title, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?) RETURNING id").bind(handle, name, now, now),
      c.env.DB.prepare("INSERT INTO variants (product_id, sku, size_label, position) SELECT id, ?, 'Standard', 0 FROM products WHERE handle = ?").bind(sku, handle),
      c.env.DB.prepare("INSERT INTO product_categories (product_id, category_id) SELECT id, ? FROM products WHERE handle = ?").bind(cat.id, handle),
    ]);
    const id = (ins?.results[0] as { id: number }).id;
    return c.redirect(`/admin/products/${id}?saved=1`, 303);
  });
}
