import { Layout } from "./layout";
import type { AdminApp } from "./index";
import { Notice, loadCategories, type Category } from "./products";
import type { Env } from "../env";

type Product = { id: number; title: string; description: string | null; status: string };
type Source = { raw_names: string | null; photo_source: string | null; source_url: string | null; license: string | null; author: string | null };

const parseId = (raw: string): number | null => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

async function load(env: Env, id: number) {
  const [prod, cats, sel, photos, src, internal] = await env.DB.batch([
    env.DB.prepare("SELECT id, title, description, status FROM products WHERE id = ?").bind(id),
    env.DB.prepare("SELECT id, name FROM categories WHERE is_internal = 0 ORDER BY name"),
    env.DB.prepare("SELECT category_id FROM product_categories WHERE product_id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?").bind(id),
    env.DB.prepare("SELECT raw_names, photo_source, source_url, license, author FROM product_sources WHERE product_id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = ? AND c.is_internal = 1").bind(id),
  ]);
  const product = prod?.results[0] as Product | undefined;
  if (!product) return null;
  return {
    product,
    categories: (cats?.results ?? []) as Category[],
    selected: ((sel?.results ?? []) as { category_id: number }[]).map((r) => r.category_id),
    photos: (photos?.results[0] as { n: number }).n,
    source: src?.results[0] as Source | undefined,
    internal: (internal?.results[0] as { n: number }).n,
  };
}

function rawNames(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type View = NonNullable<Awaited<ReturnType<typeof load>>>;

function EditPage(p: { email: string; v: View; saved?: boolean; error?: string; name?: string; description?: string; selected?: number[] }) {
  const { product, categories, photos, source } = p.v;
  const selected = p.selected ?? p.v.selected;
  const names = rawNames(source?.raw_names ?? null);
  const info: [string, string | null | undefined][] = [
    ["Photo from", source?.photo_source],
    ["Link", source?.source_url],
    ["Licence", source?.license],
    ["Author", source?.author],
  ];
  const published = product.status === "published";
  return (
    <Layout title={product.title} email={p.email}>
      <Notice saved={p.saved} error={p.error} />
      <p>
        {published ? "Showing in the shop." : "Hidden from the shop."} {photos === 0 ? "No photo yet." : `${photos} photo(s).`}{" "}
        <a href={`/admin/products/${product.id}/photos`}>Photos</a> <a href={`/admin/products/${product.id}/prices`}>Sizes and prices</a>
      </p>
      <form method="post" action={`/admin/products/${product.id}/status`}>
        <input type="hidden" name="status" value={published ? "draft" : "published"} />
        <button type="submit">{published ? "Hide from shop" : "Publish"}</button>
      </form>
      <form method="post" action={`/admin/products/${product.id}`}>
        <p>
          <label>
            Name
            <br />
            <input name="name" value={p.name ?? product.title} maxlength={120} required style="width:100%" />
          </label>
        </p>
        <p>
          <label>
            Description
            <br />
            <textarea name="description" rows={5} maxlength={5000} style="width:100%">
              {p.description ?? product.description ?? ""}
            </textarea>
          </label>
        </p>
        <fieldset>
          <legend>Categories</legend>
          {categories.map((c) => (
            <label style="display:block;min-height:44px">
              <input type="checkbox" name="category" value={String(c.id)} checked={selected.includes(c.id)} /> {c.name}
            </label>
          ))}
        </fieldset>
        <p>
          <button type="submit">Save</button>
        </p>
      </form>
      <section aria-label="Photo info">
        <h2>Photo info</h2>
        {info.every(([, val]) => !val) && names.length === 0 && <p>Nothing recorded.</p>}
        <dl>
          {info.map(([label, val]) =>
            val ? (
              <>
                <dt>{label}</dt>
                <dd>{val}</dd>
              </>
            ) : null,
          )}
          {names.length > 0 && (
            <>
              <dt>Other names</dt>
              <dd>{names.join(", ")}</dd>
            </>
          )}
        </dl>
      </section>
    </Layout>
  );
}

export function mountProductEdit(admin: AdminApp) {
  admin.get("/admin/products/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await load(c.env, id));
    if (!v) return c.notFound();
    return c.html(<EditPage email={c.var.staffEmail} v={v} saved={c.req.query("saved") === "1"} />);
  });

  admin.post("/admin/products/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await load(c.env, id));
    if (!id || !v) return c.notFound();
    const body = await c.req.parseBody({ all: true });
    const rawName = String(body.name ?? "");
    const name = rawName.trim().replace(/\s+/g, " ");
    const description = String(body.description ?? "");
    const picked = [body.category ?? []].flat().map((x) => Number(x));
    const allowed = new Set(v.categories.map((x) => x.id));
    const chosen = [...new Set(picked.filter((n) => allowed.has(n)))];
    const fail = (error: string) =>
      c.html(<EditPage email={c.var.staffEmail} v={v} error={error} name={rawName} description={description} selected={chosen} />, 400);
    if (!name) return fail("Enter a name");
    if (name.length > 120) return fail("The name must be 120 characters or fewer");
    if (description.length > 5000) return fail("The description is too long");
    const db = c.env.DB;
    const stmts = [
      db.prepare("UPDATE products SET title = ?, description = ?, updated_at = ? WHERE id = ?").bind(name, description.trim() || null, new Date().toISOString(), id),
      db.prepare("DELETE FROM product_categories WHERE product_id = ? AND category_id IN (SELECT id FROM categories WHERE is_internal = 0)").bind(id),
      ...chosen.map((cid) => db.prepare("INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)").bind(id, cid)),
    ];
    // Once sorted into a real category, the product is no longer "unsorted".
    if (chosen.length) stmts.push(db.prepare("DELETE FROM product_categories WHERE product_id = ? AND category_id IN (SELECT id FROM categories WHERE is_internal = 1)").bind(id));
    await db.batch(stmts);
    return c.redirect(`/admin/products/${id}?saved=1`, 303);
  });

  admin.post("/admin/products/:id/status", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await load(c.env, id));
    if (!id || !v) return c.notFound();
    const status = String((await c.req.parseBody()).status ?? "");
    if (status !== "published" && status !== "draft") return c.html(<EditPage email={c.var.staffEmail} v={v} error="Choose publish or hide" />, 400);
    if (status === "published" && v.photos === 0) return c.html(<EditPage email={c.var.staffEmail} v={v} error="Add a photo first" />, 400);
    if (status === "published" && v.internal > 0) return c.html(<EditPage email={c.var.staffEmail} v={v} error="Choose a shop category first" />, 400);
    await c.env.DB.prepare("UPDATE products SET status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), id).run();
    return c.redirect(`/admin/products/${id}?saved=1`, 303);
  });
}
