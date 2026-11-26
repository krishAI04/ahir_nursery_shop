import { raw } from "hono/html";
import type { Env } from "../env";
import { imageUrl } from "../lib/images";
import { Layout } from "./layout";
import { Notice, type Category } from "./products";
import { categoryPickerScript } from "./static/category-picker";
import { shrinkScript } from "./static/shrink";
import { Icon } from "./ui";

export type Source = { raw_names: string | null; photo_source: string | null; source_url: string | null; license: string | null; author: string | null };
export type Size = { id: number; size_label: string; colour: string | null; price_paise: number | null; in_stock: number };
export type Image = { id: number; r2_key: string; position: number };
export type ProductView = {
  product: { id: number; title: string; description: string | null; status: string; handle: string; representative: boolean };
  categories: Category[];
  selected: number[];
  images: Image[];
  sizes: Size[];
  source?: Source;
  internal: number;
};
export type PageForm = {
  name?: string;
  description?: string;
  selected?: number[];
  prices?: Record<string, string>;
  stock?: Set<number>;
  add?: { size: string; colour: string };
};

export const sizeLabel = (v: { size_label: string; colour: string | null }) => (v.colour ? `${v.size_label}, ${v.colour}` : v.size_label);
const rupeeText = (paise: number | null) =>
  paise == null ? "" : `${Math.floor(paise / 100)}${paise % 100 ? "." + String(paise % 100).padStart(2, "0") : ""}`;

/** Everything the product page shows, in one round trip. */
export async function loadProductView(env: Env, id: number): Promise<ProductView | null> {
  const [prod, cats, sel, imgs, sizes, src, internal] = await env.DB.batch([
    env.DB.prepare("SELECT id, title, description, status, handle, representative_photo FROM products WHERE id = ?").bind(id),
    env.DB.prepare("SELECT id, name FROM categories WHERE is_internal = 0 ORDER BY name"),
    env.DB.prepare("SELECT category_id FROM product_categories WHERE product_id = ?").bind(id),
    env.DB.prepare("SELECT id, r2_key, position FROM product_images WHERE product_id = ? ORDER BY position, id").bind(id),
    env.DB.prepare("SELECT id, size_label, colour, price_paise, in_stock FROM variants WHERE product_id = ? AND hidden = 0 ORDER BY position, id").bind(id),
    env.DB.prepare("SELECT raw_names, photo_source, source_url, license, author FROM product_sources WHERE product_id = ?").bind(id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = ? AND c.is_internal = 1").bind(id),
  ]);
  const row = prod?.results[0] as (Omit<ProductView["product"], "representative"> & { representative_photo: number }) | undefined;
  if (!row) return null;
  const { representative_photo, ...rest } = row;
  return {
    product: { ...rest, representative: representative_photo === 1 },
    categories: (cats?.results ?? []) as Category[],
    selected: ((sel?.results ?? []) as { category_id: number }[]).map((r) => r.category_id),
    images: (imgs?.results ?? []) as Image[],
    sizes: (sizes?.results ?? []) as Size[],
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

const Line = (p: { ok: boolean; children: string }) => (
  <p class={p.ok ? "ok" : "no"}>
    <Icon name={p.ok ? "check" : "alert"} small />
    <span>{p.children}</span>
  </p>
);

function Checklist(p: { v: ProductView }) {
  const { v } = p;
  const shop = new Set(v.categories.map((c) => c.id));
  const hasCat = v.selected.some((id) => shop.has(id)) && v.internal === 0;
  const names = v.sizes.map(sizeLabel);
  const sizes = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
  const photo = v.images.length === 0 ? "none" : v.product.representative ? "similar" : "real";
  const ready = hasCat && names.length > 0 && photo === "real";
  return (
    <div class="check">
      <Line ok={hasCat}>{hasCat ? "Has a category" : "Needs a shop category"}</Line>
      <Line ok={names.length > 0}>{names.length ? `Has sizes (${sizes})` : "Needs a size"}</Line>
      <Line ok={photo === "real"}>
        {photo === "real" ? "Has a real photo" : photo === "similar" ? "Photo is a similar one — add a real photo from the shop" : "Needs a photo"}
      </Line>
      {ready && (
        <p class="ready">
          <b>Ready for the shop</b>
        </p>
      )}
    </div>
  );
}

/** The photo row: Add photos tile first, then each photo with delete and a small move menu (works without JavaScript). */
export function PhotoStrip(p: { env: Env; v: ProductView }) {
  const { product, images } = p.v;
  const base = `/admin/products/${product.id}/photos`;
  return (
    <>
      <div class="strip">
        <button type="button" class="add" data-open-add>
          <Icon name="camera" />
          Add photos
        </button>
        {images.map((i, n) => (
          <div class="ph">
            <img src={imageUrl(p.env, i.r2_key)} alt={n === 0 ? "Main photo" : `Photo ${n + 1}`} loading="lazy" />
            {n === 0 && <span class="main">Main</span>}
            <form method="post" action={`${base}/${i.id}/delete`} onsubmit="return confirm('Delete this photo?')">
              <button type="submit" class="del" aria-label={`Delete photo ${n + 1}`}>
                <span>
                  <Icon name="trash" small />
                </span>
              </button>
            </form>
            {images.length > 1 && (
              <details class="menu">
                <summary aria-label={`Move photo ${n + 1}`}>
                  <span>
                    <Icon name="grip" small />
                  </span>
                </summary>
                <div class="pop">
                  <form method="post" action={`${base}/${i.id}/move`}>
                    <input type="hidden" name="dir" value="up" />
                    <button type="submit" disabled={n === 0}>Move earlier</button>
                  </form>
                  <form method="post" action={`${base}/${i.id}/move`}>
                    <input type="hidden" name="dir" value="down" />
                    <button type="submit" disabled={n === images.length - 1}>Move later</button>
                  </form>
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
      <p class="hint">Hold and drag to change the order. The first photo shows in the shop list.</p>
      <input id="pick" type="file" accept="image/*" data-put={base} hidden />
      <p id="msg" class="hint" role="status"></p>
    </>
  );
}

function Picker(p: { categories: Category[]; selected: number[] }) {
  const on = new Set(p.selected);
  const list = [...p.categories.filter((c) => on.has(c.id)), ...p.categories.filter((c) => !on.has(c.id))];
  const picked = list.filter((c) => on.has(c.id));
  return (
    <fieldset class="picker" data-picker>
      <legend>Categories</legend>
      <div class="chips" data-chips hidden={!picked.length}>
        {picked.map((c) => (
          <label class="chip on" for={`cat-${c.id}`}>
            {c.name}
            <Icon name="x" small />
          </label>
        ))}
      </div>
      <div class="find" data-find hidden>
        <label>
          <Icon name="search" small />
          <input type="search" placeholder="Find a category" aria-label="Find a category" autocomplete="off" />
        </label>
      </div>
      <div class="clist">
        {list.map((c) => (
          <label class="opt">
            <input type="checkbox" id={`cat-${c.id}`} name="category" value={String(c.id)} checked={on.has(c.id)} /> {c.name}
          </label>
        ))}
        <p class="hint" data-none hidden>
          No category matches. Try a shorter word.
        </p>
      </div>
    </fieldset>
  );
}

function Sizes(p: { v: ProductView; form?: PageForm }) {
  const { product, sizes } = p.v;
  const f = p.form;
  return (
    <>
      <form method="post" action={`/admin/products/${product.id}/prices`}>
        {sizes.map((s) => (
          <div class="srow">
            <div class="shead">
              <b>{sizeLabel(s)}</b>
              <label class="sw">
                <input type="checkbox" role="switch" name={`stock_${s.id}`} value="1" checked={f?.stock ? f.stock.has(s.id) : s.in_stock === 1} />
                In stock
              </label>
            </div>
            <label class="price">
              Price (staff only, not shown on the website)
              <input name={`price_${s.id}`} inputmode="decimal" value={f?.prices?.[`price_${s.id}`] ?? rupeeText(s.price_paise)} />
            </label>
            <button type="submit" form={`remove-${s.id}`} class="rm">
              <Icon name="trash" small />
              Remove
            </button>
          </div>
        ))}
        {sizes.length === 0 && <p>No sizes yet.</p>}
        {sizes.length > 0 && (
          <button type="submit" class="wide">
            Save sizes
          </button>
        )}
      </form>
      {sizes.map((s) => (
        <form id={`remove-${s.id}`} method="post" action={`/admin/products/${product.id}/prices/remove`}>
          <input type="hidden" name="remove" value={String(s.id)} />
        </form>
      ))}
      <h3>Add a size or colour</h3>
      <form method="post" action={`/admin/products/${product.id}/prices/add`} class="addsize">
        <label>
          Size
          <input name="size" value={f?.add?.size ?? ""} maxlength={60} required />
        </label>
        <label>
          Colour (optional)
          <input name="colour" value={f?.add?.colour ?? ""} maxlength={40} />
        </label>
        <button type="submit" class="btn s">
          <Icon name="plus" small />
          Add
        </button>
      </form>
    </>
  );
}

function Info(p: { source?: Source }) {
  const src = p.source;
  const names = rawNames(src?.raw_names ?? null);
  const info: [string, string | null | undefined][] = [
    ["Photo from", src?.photo_source],
    ["Link", src?.source_url],
    ["Licence", src?.license],
    ["Author", src?.author],
  ];
  return (
    <details class="info">
      <summary>Photo and name info</summary>
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
    </details>
  );
}

// Lands on the asked-for section; until the upload sheet exists the Add photos tile opens the file picker;
// asks before leaving with unsaved name, description or category changes.
const pageScript = `
(function () {
  var details = document.querySelector("form.details");
  var dirty = false;
  var ask = function (e) {
    if (dirty && !confirm("You have unsaved changes to the name, description or categories. Leave without saving?")) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    dirty = false;
  };
  if (details) {
    var mark = function (e) { if (e.target.name) dirty = true; };
    details.addEventListener("input", mark);
    details.addEventListener("change", mark);
    document.addEventListener("submit", function (e) {
      if (e.target === details) dirty = false;
      else if (e.target.getAttribute("method") !== "dialog") ask(e);
    }, true);
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (a && a.getAttribute("href").charAt(0) !== "#") ask(e);
    }, true);
  }
  var go = document.querySelector("[data-goto]");
  if (go) go.scrollIntoView();
  var pick = document.getElementById("pick");
  document.querySelectorAll("[data-open-add]").forEach(function (b) {
    b.addEventListener("click", function () { if (!b.hasAttribute("data-wired")) pick.click(); });
  });
})();
`;

const help = {
  title: "Editing a product",
  steps: [
    "Tap Add photos to take or choose photos. The first photo is the one customers see in the shop list.",
    "Change the name, description or categories, then tap Save changes.",
    "Go down to Sizes to switch In stock on or off or add a size, then tap Save sizes.",
    "Switch Showing in shop on when the product has a photo, a shop category and a size.",
  ],
};

export function ProductPage(p: {
  email: string;
  env: Env;
  v: ProductView;
  section?: "photos" | "sizes";
  openAdd?: boolean;
  saved?: boolean;
  hidden?: boolean;
  error?: string;
  form?: PageForm;
}) {
  const { product, categories } = p.v;
  const f = p.form;
  const published = product.status === "published";
  const at = p.openAdd ? "photos" : p.section;
  const notice = <Notice saved={p.saved} error={p.error} />;
  return (
    <Layout
      title={product.title}
      email={p.email}
      active="products"
      back={{ href: "/admin/products", label: "All products" }}
      help={help}
      tip="a real photo taken in the shop sells better than a similar one."
    >
      {!at && notice}
      <form method="post" action={`/admin/products/${product.id}/status`} class="live">
        <input type="hidden" name="status" value={published ? "draft" : "published"} />
        <div class="t">
          <b>Showing in shop</b>
          <small>{published ? "Customers can see and ask about it" : "Hidden from customers"}</small>
        </div>
        <button type="submit" class="toggle" role="switch" aria-checked={published ? "true" : "false"} aria-label="Showing in shop">
          <span />
        </button>
      </form>
      <Checklist v={p.v} />
      <section id="photos" aria-labelledby="photos-h" data-goto={at === "photos" ? "" : undefined} data-autoopen={p.openAdd ? "" : undefined}>
        <h2 class="sec" id="photos-h">
          Photos
        </h2>
        {at === "photos" && notice}
        {p.hidden && (
          <p role="status" class="warn">
            Product hidden because it has no photo
          </p>
        )}
        <PhotoStrip env={p.env} v={p.v} />
      </section>
      <form method="post" action={`/admin/products/${product.id}`} class="details">
        <label for="f-name">Name</label>
        <input id="f-name" name="name" value={f?.name ?? product.title} maxlength={120} required />
        <p class="hint">As customers would say it, e.g. "Ceramic Line Pot, Round".</p>
        <label for="f-desc">
          Description <span class="opt-l">(optional)</span>
        </label>
        <textarea id="f-desc" name="description" rows={3} maxlength={5000}>
          {f?.description ?? product.description ?? ""}
        </textarea>
        <p class="hint">One or two short lines: colour, finish, good for which plants.</p>
        <Picker categories={categories} selected={f?.selected ?? p.v.selected} />
        <div class="save">
          <a class="btn s" href="/admin/products">
            Cancel
          </a>
          <button type="submit">Save changes</button>
        </div>
      </form>
      <section id="sizes" aria-labelledby="sizes-h" data-goto={at === "sizes" ? "" : undefined}>
        <h2 class="sec" id="sizes-h">
          Sizes
        </h2>
        {at === "sizes" && notice}
        <Sizes v={p.v} form={f} />
      </section>
      <Info source={p.v.source} />
      <script>{raw(shrinkScript)}</script>
      <script>{raw(categoryPickerScript)}</script>
      <script>{raw(pageScript)}</script>
    </Layout>
  );
}
