import type { Env } from "../env";
import { MoneyError, parseRupees } from "../lib/money";
import { slug } from "../lib/slug";
import { Layout } from "./layout";
import type { AdminApp } from "./index";
import { Notice, uniqueSlug } from "./products";

type Size = { id: number; size_label: string; colour: string | null; price_paise: number | null; in_stock: number };
type Product = { id: number; title: string; handle: string };

const MAX_SIZES = 40;
const parseId = (raw: string | undefined): number | null => (raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null);
const label = (v: { size_label: string; colour: string | null }) => (v.colour ? `${v.size_label}, ${v.colour}` : v.size_label);
const rupeeText = (paise: number | null) =>
  paise == null ? "" : `${Math.floor(paise / 100)}${paise % 100 ? "." + String(paise % 100).padStart(2, "0") : ""}`;

async function load(env: Env, id: number) {
  const product = await env.DB.prepare("SELECT id, title, handle FROM products WHERE id = ?").bind(id).first<Product>();
  if (!product) return null;
  const { results } = await env.DB.prepare(
    "SELECT id, size_label, colour, price_paise, in_stock FROM variants WHERE product_id = ? AND hidden = 0 ORDER BY position, id",
  )
    .bind(id)
    .all<Size>();
  return { product, sizes: results };
}
type View = NonNullable<Awaited<ReturnType<typeof load>>>;

function PricesPage(p: {
  email: string;
  v: View;
  saved?: boolean;
  error?: string;
  prices?: Record<string, string>;
  stock?: Set<number>;
  add?: { size: string; colour: string };
}) {
  const { product, sizes } = p.v;
  return (
    <Layout title={`Sizes and prices: ${product.title}`} email={p.email}>
      <Notice saved={p.saved} error={p.error} />
      <p>
        <a href={`/admin/products/${product.id}`}>Back to product</a>
      </p>
      <p>Leave a price empty to show "Price on request".</p>
      <form method="post" action={`/admin/products/${product.id}/prices`}>
        {sizes.map((s) => (
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #ddd">
            <strong style="min-width:140px">{label(s)}</strong>
            <label>
              Price (₹){" "}
              <input name={`price_${s.id}`} inputmode="decimal" value={p.prices?.[`price_${s.id}`] ?? rupeeText(s.price_paise)} style="width:120px" />
            </label>
            <label style="min-height:44px;display:inline-flex;align-items:center;gap:6px">
              <input type="checkbox" name={`stock_${s.id}`} value="1" checked={p.stock ? p.stock.has(s.id) : s.in_stock === 1} /> In stock
            </label>
            <button type="submit" form={`remove-${s.id}`} style="background:#8a2b2b">
              Remove
            </button>
          </div>
        ))}
        {sizes.length === 0 && <p>No sizes yet.</p>}
        <p>
          <button type="submit">Save prices</button>
        </p>
      </form>
      {sizes.map((s) => (
        <form id={`remove-${s.id}`} method="post" action={`/admin/products/${product.id}/prices/remove`}>
          <input type="hidden" name="remove" value={String(s.id)} />
        </form>
      ))}
      <h2>Add a size or colour</h2>
      <form method="post" action={`/admin/products/${product.id}/prices/add`}>
        <p>
          <label>
            Size
            <br />
            <input name="size" value={p.add?.size ?? ""} maxlength={60} required />
          </label>
        </p>
        <p>
          <label>
            Colour (optional)
            <br />
            <input name="colour" value={p.add?.colour ?? ""} maxlength={40} />
          </label>
        </p>
        <button type="submit">Add</button>
      </form>
    </Layout>
  );
}

export function mountPrices(admin: AdminApp) {
  admin.get("/admin/products/:id/prices", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await load(c.env, id));
    if (!v) return c.notFound();
    return c.html(<PricesPage email={c.var.staffEmail} v={v} saved={c.req.query("saved") === "1"} />);
  });

  admin.post("/admin/products/:id/prices", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await load(c.env, id));
    if (!id || !v) return c.notFound();
    const body = await c.req.parseBody();
    const prices: Record<string, string> = {};
    const stock = new Set<number>();
    const values: (number | null)[] = [];
    let error: string | undefined;
    // Only sizes that were on the form: a size someone added after the page loaded keeps its price and stock.
    const posted = v.sizes.filter((s) => `price_${s.id}` in body);
    for (const s of posted) {
      const raw = String(body[`price_${s.id}`] ?? "");
      prices[`price_${s.id}`] = raw;
      if (body[`stock_${s.id}`]) stock.add(s.id);
      if (raw.trim() === "") values.push(null);
      else
        try {
          values.push(parseRupees(raw));
        } catch (e) {
          if (!(e instanceof MoneyError)) throw e;
          error ??= `${label(s)}: ${e.message}`;
          values.push(null);
        }
    }
    if (error) return c.html(<PricesPage email={c.var.staffEmail} v={v} error={error} prices={prices} stock={stock} />, 400);
    const now = new Date().toISOString();
    await c.env.DB.batch([
      ...posted.map((s, i) =>
        c.env.DB.prepare("UPDATE variants SET price_paise = ?, in_stock = ? WHERE id = ? AND product_id = ?").bind(values[i] ?? null, stock.has(s.id) ? 1 : 0, s.id, id),
      ),
      c.env.DB.prepare("UPDATE products SET updated_at = ? WHERE id = ?").bind(now, id),
    ]);
    return c.redirect(`/admin/products/${id}/prices?saved=1`, 303);
  });

  admin.post("/admin/products/:id/prices/add", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await load(c.env, id));
    if (!id || !v) return c.notFound();
    const body = await c.req.parseBody();
    const size = String(body.size ?? "").trim().replace(/\s+/g, " ");
    const colour = String(body.colour ?? "").trim().replace(/\s+/g, " ");
    const fail = (error: string) => c.html(<PricesPage email={c.var.staffEmail} v={v} error={error} add={{ size, colour }} />, 400);
    if (!size) return fail("Enter a size");
    if (size.length > 60 || colour.length > 40) return fail("That size or colour is too long");
    const existing = await c.env.DB.prepare("SELECT id, hidden FROM variants WHERE product_id = ? AND size_label = ? AND coalesce(colour, '') = ?")
      .bind(id, size, colour)
      .first<{ id: number; hidden: number }>();
    if (existing && !existing.hidden) return fail("That size is already listed");
    if (v.sizes.length >= MAX_SIZES) return fail(`A product can have at most ${MAX_SIZES} sizes`);
    if (existing) {
      await c.env.DB.prepare("UPDATE variants SET hidden = 0, in_stock = 1 WHERE id = ?").bind(existing.id).run();
      return c.redirect(`/admin/products/${id}/prices?saved=1`, 303);
    }
    const sku = await uniqueSlug(c.env, "variants", "sku", `${v.product.handle}-${slug(size)}${colour ? `-${slug(colour)}` : ""}`);
    await c.env.DB.prepare(
      "INSERT INTO variants (product_id, sku, size_label, colour, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM variants WHERE product_id = ?))",
    )
      .bind(id, sku, size, colour || null, id)
      .run();
    return c.redirect(`/admin/products/${id}/prices?saved=1`, 303);
  });

  admin.post("/admin/products/:id/prices/remove", async (c) => {
    const id = parseId(c.req.param("id"));
    const vid = parseId(String((await c.req.parseBody()).remove ?? ""));
    if (!id || !vid) return c.notFound();
    const own = await c.env.DB.prepare("SELECT id FROM variants WHERE id = ? AND product_id = ?").bind(vid, id).first();
    if (!own) return c.notFound();
    const view = await load(c.env, id);
    if (view && view.sizes.length <= 1 && view.sizes.some((s) => s.id === vid)) {
      return c.html(<PricesPage email={c.var.staffEmail} v={view} error="A product needs at least one size" />, 400);
    }
    const ordered = await c.env.DB.prepare("SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1").bind(vid).first();
    await c.env.DB.prepare(ordered ? "UPDATE variants SET hidden = 1, in_stock = 0 WHERE id = ?" : "DELETE FROM variants WHERE id = ?").bind(vid).run();
    return c.redirect(`/admin/products/${id}/prices?saved=1`, 303);
  });
}
