import type { Env } from "../env";
import { imageUrl } from "../lib/images";
import { likePattern, parsePage } from "../lib/query";
import { slug } from "../lib/slug";
import { Layout } from "./layout";
import { Badge, Icon } from "./ui";
import type { AdminApp } from "./index";

const PAGE_SIZE = 50;
const FILTERS: [string, string][] = [
  ["", "All"],
  ["needs-photo", "Needs photo"],
  ["similar", "Similar photo"],
  ["draft", "Hidden"],
  ["published", "Published"],
  ["out-of-stock", "Out of stock"],
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

/** Counts for the filter chips and the laptop summary: one row kept current by triggers (counting live reads every product). */
export async function productCounts(env: Env): Promise<{ all: number; published: number; draft: number; needsPhoto: number; similar: number }> {
  const r = await env.DB.prepare(
    `SELECT total AS "all", published, draft, needs_photo AS needsPhoto, similar FROM product_stats WHERE id = 1`,
  ).first<{ all: number; published: number; draft: number; needsPhoto: number; similar: number }>();
  return r ?? { all: 0, published: 0, draft: 0, needsPhoto: 0, similar: 0 };
}

/** WHERE clause for search by title or by the old Excel names. */
export function searchWhere(q: string): { sql: string; args: string[] } {
  const pat = likePattern(q);
  return {
    sql: `(p.title LIKE ? ESCAPE '!' OR COALESCE((SELECT ps.raw_names FROM product_sources ps WHERE ps.product_id = p.id), '') LIKE ? ESCAPE '!')`,
    args: [pat, pat],
  };
}

export type Row = { id: number; title: string; status: string; similar: number; thumb: string | null; category: string | null; sizes: number; size: string | null };

/** One page of product rows in title order (ids first via the title index, then details for those rows only). */
export async function loadRows(env: Env, where: string[], args: (string | number)[], limit: number, offset = 0): Promise<Row[]> {
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.status, p.representative_photo AS similar,
      (SELECT i.r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS thumb,
      (SELECT c.name FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = p.id AND c.is_internal = 0 ORDER BY c.name LIMIT 1) AS category,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.hidden = 0) AS sizes,
      (SELECT v.size_label FROM variants v WHERE v.product_id = p.id AND v.hidden = 0 ORDER BY v.position, v.id LIMIT 1) AS size
    FROM (SELECT p.id FROM products p ${w} ORDER BY p.title COLLATE NOCASE, p.id LIMIT ${limit} OFFSET ?) page
    JOIN products p ON p.id = page.id ORDER BY p.title COLLATE NOCASE, p.id`,
  )
    .bind(...args, offset)
    .all<Row>();
  return results;
}

const sizesText = (r: Row) => (r.sizes > 1 ? `${r.sizes} sizes` : r.size ?? "");

const Thumb = (p: { env: Env; r: Row; size: number }) =>
  p.r.thumb ? (
    <img class="thumb" src={imageUrl(p.env, p.r.thumb)} alt="" loading="lazy" width={String(p.size)} height={String(p.size)} />
  ) : (
    <span class="thumb none">
      <Icon name="image" />
    </span>
  );
const shopBadge = (r: Row) => (r.status === "published" ? <Badge kind="on">Showing in shop</Badge> : <Badge kind="off">Hidden</Badge>);

/** Product rows as phone cards; with `table`, a real table replaces the cards from 900 px (CSS shows one or the other). */
export function ProductRows(p: { env: Env; rows: Row[]; href: (r: Row) => string; table?: boolean }) {
  return (
    <>
      <ul class={p.table ? "plist with-table" : "plist"}>
        {p.rows.map((r) => {
          const badge = !r.thumb ? (
            <Badge kind="warn">Needs a photo</Badge>
          ) : r.similar ? (
            <Badge kind="warn">Similar photo · take a real one</Badge>
          ) : (
            shopBadge(r)
          );
          const meta = [r.category, r.sizes > 1 || r.size !== "Standard" ? sizesText(r) : ""].filter(Boolean).join(" · ");
          return (
            <li>
              <a class="item" href={p.href(r)}>
                <Thumb env={p.env} r={r} size={56} />
                <span class="t">
                  <b>{r.title}</b>
                  {meta && <span class="meta">{meta}</span>}
                  <span class="pb">{badge}</span>
                </span>
                <span class="chev">
                  <Icon name="chevron" />
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {p.table && p.rows.length > 0 && (
        <table class="ptable">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Category</th>
              <th scope="col">Sizes</th>
              <th scope="col">Photo</th>
              <th scope="col">Shop</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr>
                <td>
                  <a href={p.href(r)}>
                    <Thumb env={p.env} r={r} size={40} />
                    <span>{r.title}</span>
                  </a>
                </td>
                <td>{r.category ?? ""}</td>
                <td>{sizesText(r)}</td>
                <td>{!r.thumb ? <Badge kind="warn">Needs a photo</Badge> : r.similar ? <Badge kind="warn">Similar</Badge> : <Badge kind="on">Own photo</Badge>}</td>
                <td>{shopBadge(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Search box shared by the list and the Add-photo picker. */
export function SearchBox(p: { action: string; q: string; label: string; filter?: string; autofocus?: boolean }) {
  return (
    <form class="find" method="get" action={p.action} role="search">
      <label>
        <Icon name="search" />
        <input type="search" name="q" value={p.q} placeholder={p.label} aria-label={p.label} autofocus={p.autofocus} />
      </label>
      {p.filter && <input type="hidden" name="filter" value={p.filter} />}
      <button type="submit" class="btn s">
        Search
      </button>
    </form>
  );
}

function NewProductPage(p: { email: string; categories: Category[]; name?: string; category?: string; error?: string }) {
  return (
    <Layout
      title="New product"
      email={p.email}
      active="products"
      back={{ href: "/admin/products", label: "All products" }}
      help={{
        title: "Add a new product",
        steps: [
          "Type the name as customers would say it.",
          "Choose where it belongs in the shop.",
          "Tap Create product. It starts hidden.",
          "On the next page add a photo and sizes, then show it in the shop.",
        ],
      }}
      tip="A new product stays hidden until you add a photo and switch it on."
    >
      <Notice error={p.error} />
      <form class="form" method="post" action="/admin/products/new">
        <label for="np-name">Name</label>
        <input id="np-name" name="name" value={p.name ?? ""} maxlength={120} required />
        <p class="hint">As customers would say it, e.g. "Ceramic Line Pot, Round".</p>
        <label for="np-cat">Category</label>
        <select id="np-cat" name="category" required>
          <option value="">Choose a category</option>
          {p.categories.map((c) => (
            <option value={String(c.id)} selected={p.category === String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
        <p class="hint">Where it shows in the shop. You can add more categories on the next page.</p>
        <button type="submit">Create product</button>
      </form>
    </Layout>
  );
}

export function mountProducts(admin: AdminApp) {
  admin.get("/admin/products", async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    const wanted = c.req.query("filter") ?? "";
    const filter = FILTERS.some(([k]) => k === wanted) ? wanted : "";
    const page = parsePage(c.req.query("page"));
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q) {
      const s = searchWhere(q);
      where.push(s.sql);
      args.push(...s.args);
    }
    if (filter === "published" || filter === "draft") {
      where.push("p.status = ?");
      args.push(filter);
    }
    if (filter === "needs-photo") where.push("NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)");
    if (filter === "similar") where.push("p.representative_photo = 1");
    // Candidates come from the small variants_unavailable_idx, so this doesn't visit every product.
    // Products always keep at least one size (last-size guard + import), so zero-size products are intentionally not matched.
    if (filter === "out-of-stock")
      where.push(
        "p.id IN (SELECT v.product_id FROM variants v WHERE in_stock = 0 OR hidden = 1) AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.hidden = 0 AND v.in_stock = 1)",
      );
    if (filter === "no-price") where.push("EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.hidden = 0 AND v.price_paise IS NULL)");
    // One extra row tells "Next".
    const [results, counts] = await Promise.all([loadRows(c.env, where, args, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE), productCounts(c.env)]);
    const rows = results.slice(0, PAGE_SIZE);
    const hasMore = results.length > PAGE_SIZE;
    const chipCount: Record<string, number> = { "": counts.all, published: counts.published, draft: counts.draft, "needs-photo": counts.needsPhoto, similar: counts.similar };
    const link = (over: Record<string, string>) => {
      const sp = new URLSearchParams();
      const vals: Record<string, string> = { q, filter, page: String(page), ...over };
      for (const [k, v] of Object.entries(vals)) if (v && !(k === "page" && v === "1")) sp.set(k, v);
      const s = sp.toString();
      return `/admin/products${s ? `?${s}` : ""}`;
    };
    return c.html(
      <Layout
        title="Products"
        email={c.var.staffEmail}
        active={filter === "needs-photo" ? "needs-photo" : "products"}
        wide
        help={{
          title: "Products",
          steps: [
            "Search by name, or by the old name from the Excel sheet.",
            "Tap a filter, like Needs photo or Hidden, to see only those products.",
            "Tap a product to change its photo, name or sizes.",
            "Orange labels mean something is missing, like a photo.",
          ],
        }}
        tip="Tap a product to change its photo, name or sizes. Orange means something is missing."
      >
        <div class="tools">
          <SearchBox action="/admin/products" q={q} filter={filter} label="Search products, e.g. tulsi pot" />
          <a class="btn fab" href="/admin/products/new">
            <Icon name="plus" small />
            New product
          </a>
        </div>
        <div class="stats">
          <p class="stat">
            <b>{counts.published}</b>showing in shop
          </p>
          <p class="stat">
            <b>{counts.draft}</b>hidden
          </p>
          <p class="stat">
            <b>{counts.needsPhoto}</b>need a photo
          </p>
          <p class="stat">
            <b>{counts.similar}</b>with a similar photo
          </p>
        </div>
        <nav class="chips" aria-label="Filters">
          {FILTERS.map(([k, label]) => (
            <a class="chip" href={link({ filter: k, page: "1" })} aria-current={k === filter ? "page" : undefined}>
              {label}
              {k in chipCount && <em>{chipCount[k]}</em>}
            </a>
          ))}
        </nav>
        {rows.length === 0 && <p>No products found.</p>}
        <ProductRows env={c.env} rows={rows} href={(r) => `/admin/products/${r.id}`} table />
        {(page > 1 || hasMore) && (
          <p class="pager">
            {page > 1 && (
              <a class="btn s" href={link({ page: String(page - 1) })}>
                Previous
              </a>
            )}
            {hasMore && (
              <a class="btn s" href={link({ page: String(page + 1) })}>
                Next
              </a>
            )}
          </p>
        )}
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
