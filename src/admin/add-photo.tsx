import { Layout } from "./layout";
import { loadRows, ProductRows, SearchBox, searchWhere } from "./products";
import type { AdminApp } from "./index";

/** The camera button: "which product?" first, then the product page opens with the Add photos sheet. */
export function mountAddPhoto(admin: AdminApp) {
  admin.get("/admin/add-photo", async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    const s = q ? searchWhere(q) : null;
    const rows = s ? await loadRows(c.env, [s.sql], s.args, 20) : [];
    return c.html(
      <Layout
        title="Add a photo"
        email={c.var.staffEmail}
        active="photo"
        help={{
          title: "Add a photo",
          steps: [
            "Type a few letters of the product name, or its old name from the Excel sheet.",
            "Tap the product.",
            "Take a photo or choose some from the gallery.",
            "Come back here for the next product.",
          ],
        }}
        tip="Walk the shelves: search, tap the product, take the photo, then come back for the next one."
      >
        <h2>Which product?</h2>
        <SearchBox action="/admin/add-photo" q={q} label="Search products, e.g. tulsi pot" autofocus />
        {!q && <p class="hint">Type a few letters of the name, then tap the product.</p>}
        {q && rows.length === 0 && <p>No products found.</p>}
        <ProductRows env={c.env} rows={rows} href={(r) => `/admin/products/${r.id}?add=1`} />
      </Layout>,
    );
  });
}
