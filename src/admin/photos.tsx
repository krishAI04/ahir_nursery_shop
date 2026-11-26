import type { Env } from "../env";
import type { AdminApp } from "./index";
import { ProductPage, loadProductView, type Image } from "./product-page";

const MAX_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const parseId = (s: string | undefined): number | null => (s && /^\d{1,9}$/.test(s) ? Number(s) : null);

// Passes exactly `len` bytes to R2 and flags a body that was longer or shorter. The stream given to R2
// always ends cleanly (extra bytes are cut off, missing ones padded), so R2 never sees an aborted upload;
// the caller deletes the object and answers 413 when `check.failed` is set.
function exactly(len: number) {
  let seen = 0;
  const check = { failed: false };
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      const room = len - seen;
      if (chunk.byteLength > room) {
        check.failed = true;
        if (room > 0) ctl.enqueue(chunk.subarray(0, room));
        seen = len;
        ctl.terminate();
        return;
      }
      seen += chunk.byteLength;
      ctl.enqueue(chunk);
    },
    flush(ctl) {
      if (seen < len) {
        check.failed = true;
        ctl.enqueue(new Uint8Array(len - seen));
      }
    },
  });
  return { stream, check };
}

type Product = { id: number; title: string; handle: string; status: string };

async function load(env: Env, id: number) {
  const product = await env.DB.prepare("SELECT id, title, handle, status FROM products WHERE id = ?").bind(id).first<Product>();
  if (!product) return null;
  const { results } = await env.DB.prepare("SELECT id, r2_key, position FROM product_images WHERE product_id = ? ORDER BY position, id").bind(id).all<Image>();
  return { product, images: results };
}

const touch = (env: Env, id: number, extra = "") => env.DB.prepare(`UPDATE products SET updated_at = ?${extra} WHERE id = ?`).bind(new Date().toISOString(), id);
const setOrder = (env: Env, id: number, ids: number[]) => [
  ...ids.map((iid, n) => env.DB.prepare("UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?").bind(n + 1, iid, id)),
  touch(env, id),
];

export function mountPhotos(admin: AdminApp) {
  admin.get("/admin/products/:id/photos", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await loadProductView(c.env, id));
    if (!v) return c.notFound();
    return c.html(
      <ProductPage email={c.var.staffEmail} env={c.env} v={v} section="photos" saved={c.req.query("saved") === "1"} hidden={c.req.query("hidden") === "1"} />,
    );
  });

  admin.put("/admin/products/:id/photos", async (c) => {
    const id = parseId(c.req.param("id"));
    const contentType = c.req.header("Content-Type") ?? "";
    const ext = EXT[contentType];
    if (!ext) return c.json({ error: "Only JPEG, PNG or WebP photos" }, 415);
    const lenHeader = c.req.header("Content-Length");
    if (lenHeader === undefined || !/^\d+$/.test(lenHeader)) return c.json({ error: "Length required" }, 411);
    const len = Number(lenHeader);
    if (len > MAX_BYTES) return c.json({ error: "Photo is too big (5 MB at most)" }, 413);
    const product = id
      ? await c.env.DB.prepare("SELECT handle, representative_photo FROM products WHERE id = ?").bind(id).first<{ handle: string; representative_photo: number }>()
      : null;
    if (!id || !product) return c.json({ error: "Not found" }, 404);
    const body = c.req.raw.body;
    if (!body || len === 0) return c.json({ error: "Empty photo" }, 400);
    const key = `products/${product.handle}/${crypto.randomUUID()}.${ext}`;
    const counter = exactly(len);
    try {
      // R2 needs a known length; our counter rejects a body that does not match it.
      await c.env.PHOTOS.put(key, body.pipeThrough(counter.stream).pipeThrough(new FixedLengthStream(len)), { httpMetadata: { contentType } });
    } catch (e) {
      await c.env.PHOTOS.delete(key).catch(() => {});
      console.error("photo upload failed", e);
      return c.json({ error: "Could not save the photo" }, 500);
    }
    if (counter.check.failed) {
      await c.env.PHOTOS.delete(key).catch((e) => console.error("photo upload: could not remove mismatched upload", key, e));
      return c.json({ error: "Upload did not match its size" }, 413);
    }
    // A real photo for a product that only had a similar one goes first and clears the "similar" mark.
    const similar = product.representative_photo === 1;
    let row: { id: number; position: number } | undefined;
    try {
      const insert = c.env.DB.prepare(
        similar
          ? "INSERT INTO product_images (product_id, r2_key, position) VALUES (?, ?, (SELECT COALESCE(MIN(position), 2) - 1 FROM product_images WHERE product_id = ?)) RETURNING id, position"
          : "INSERT INTO product_images (product_id, r2_key, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM product_images WHERE product_id = ?)) RETURNING id, position",
      ).bind(id, key, id);
      const res = await c.env.DB.batch<{ id: number; position: number }>([
        ...(similar ? [c.env.DB.prepare("UPDATE product_images SET position = position + 1 WHERE product_id = ?").bind(id)] : []),
        insert,
        touch(c.env, id, similar ? ", representative_photo = 0" : ""),
      ]);
      row = res[similar ? 1 : 0]!.results[0];
    } catch (e) {
      await c.env.PHOTOS.delete(key).catch(() => {});
      throw e;
    }
    return c.json({ ok: true, id: row!.id, position: row!.position });
  });

  // Drag to reorder: `order` must list exactly this product's photo ids, each once.
  admin.post("/admin/products/:id/photos/order", async (c) => {
    const id = parseId(c.req.param("id"));
    const v = id && (await load(c.env, id));
    if (!id || !v) return c.notFound();
    const json = (c.req.header("Accept") ?? "").includes("application/json");
    const ids = String((await c.req.parseBody()).order ?? "").split(",").map(parseId);
    const own = new Set(v.images.map((i) => i.id));
    const ok = ids.length === own.size && new Set(ids).size === ids.length && ids.every((i) => i !== null && own.has(i));
    if (!ok) return json ? c.json({ error: "That photo order does not match this product's photos" }, 400) : c.text("That photo order does not match this product's photos", 400);
    await c.env.DB.batch(setOrder(c.env, id, ids as number[]));
    return json ? c.json({ ok: true }) : c.redirect(`/admin/products/${id}/photos?saved=1`, 303);
  });

  admin.post("/admin/products/:id/photos/:imageId/move", async (c) => {
    const id = parseId(c.req.param("id"));
    const imageId = parseId(c.req.param("imageId"));
    const v = id && (await load(c.env, id));
    if (!id || !imageId || !v) return c.notFound();
    const from = v.images.findIndex((i) => i.id === imageId);
    if (from < 0) return c.notFound();
    const dir = String((await c.req.parseBody()).dir ?? "");
    const to = dir === "up" ? from - 1 : dir === "down" ? from + 1 : -1;
    if (to >= 0 && to < v.images.length) {
      const order = v.images.map((i) => i.id);
      [order[from], order[to]] = [order[to]!, order[from]!];
      await c.env.DB.batch(setOrder(c.env, id, order));
    }
    return c.redirect(`/admin/products/${id}/photos?saved=1`, 303);
  });

  admin.post("/admin/products/:id/photos/:imageId/delete", async (c) => {
    const id = parseId(c.req.param("id"));
    const imageId = parseId(c.req.param("imageId"));
    const v = id && (await load(c.env, id));
    if (!id || !imageId || !v) return c.notFound();
    const img = v.images.find((i) => i.id === imageId);
    if (!img) return c.notFound();
    const rest = v.images.filter((i) => i.id !== imageId);
    const hide = rest.length === 0 && v.product.status === "published";
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM product_images WHERE id = ? AND product_id = ?").bind(imageId, id),
      ...rest.map((i, n) => c.env.DB.prepare("UPDATE product_images SET position = ? WHERE id = ?").bind(n + 1, i.id)),
      touch(c.env, id, hide ? ", status = 'draft'" : ""),
    ]);
    // Row first: a failed object delete leaves only a harmless orphan, never a broken thumbnail.
    await c.env.PHOTOS.delete(img.r2_key).catch((e) => console.error("photo object delete failed", e));
    return c.redirect(`/admin/products/${id}/photos?${hide ? "hidden=1" : "saved=1"}`, 303);
  });
}
