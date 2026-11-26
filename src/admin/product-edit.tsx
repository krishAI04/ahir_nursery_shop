import type { AdminApp } from "./index";
import { ProductPage, loadProductView } from "./product-page";

const parseId = (raw: string): number | null => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

export function mountProductEdit(admin: AdminApp) {
  admin.get("/admin/products/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await loadProductView(c.env, id));
    if (!v) return c.notFound();
    return c.html(<ProductPage email={c.var.staffEmail} env={c.env} v={v} saved={c.req.query("saved") === "1"} openAdd={c.req.query("add") === "1"} />);
  });

  admin.post("/admin/products/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await loadProductView(c.env, id));
    if (!id || !v) return c.notFound();
    const body = await c.req.parseBody({ all: true });
    const rawName = String(body.name ?? "");
    const name = rawName.trim().replace(/\s+/g, " ");
    const description = String(body.description ?? "");
    const picked = [body.category ?? []].flat().map((x) => Number(x));
    const allowed = new Set(v.categories.map((x) => x.id));
    const chosen = [...new Set(picked.filter((n) => allowed.has(n)))];
    const fail = (error: string) =>
      c.html(<ProductPage email={c.var.staffEmail} env={c.env} v={v} error={error} form={{ name: rawName, description, selected: chosen }} />, 400);
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
    const v = id && (await loadProductView(c.env, id));
    if (!id || !v) return c.notFound();
    const status = String((await c.req.parseBody()).status ?? "");
    const fail = (error: string) => c.html(<ProductPage email={c.var.staffEmail} env={c.env} v={v} error={error} />, 400);
    if (status !== "published" && status !== "draft") return fail("Choose publish or hide");
    if (status === "published" && v.images.length === 0) return fail("Add a photo first");
    if (status === "published" && v.internal > 0) return fail("Choose a shop category first");
    await c.env.DB.prepare("UPDATE products SET status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), id).run();
    return c.redirect(`/admin/products/${id}?saved=1`, 303);
  });
}
