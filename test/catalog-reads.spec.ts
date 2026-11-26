import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/env";

// D1 free plan: 5M rows read/day. Seed a catalogue the size of the real import and count rows_read per request.
const NOW = "2026-11-20T00:00:00.000Z";

let rowsRead = 0;
const count = <T extends { meta?: { rows_read?: number } }>(r: T): T => {
  rowsRead += r.meta?.rows_read ?? 0;
  return r;
};
const wrapStmt = (s: D1PreparedStatement): D1PreparedStatement =>
  new Proxy(s, {
    get(t, k) {
      if (k === "__target") return t;
      if (k === "bind") return (...a: unknown[]) => wrapStmt(t.bind(...a));
      if (k === "all" || k === "run") return async () => count(await t.all());
      if (k === "first") return async (col?: string) => {
        const r = count(await t.all<Record<string, unknown>>());
        const row = r.results[0] ?? null;
        return col ? (row?.[col] ?? null) : row;
      };
      if (k === "raw") throw new Error("raw() not counted");
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
const unwrap = (s: D1PreparedStatement) => (s as unknown as { __target?: D1PreparedStatement }).__target ?? s;
const countingDb: D1Database = new Proxy(env.DB, {
  get(t, k) {
    if (k === "prepare") return (sql: string) => wrapStmt(t.prepare(sql));
    if (k === "batch") return async (stmts: D1PreparedStatement[]) => (await t.batch(stmts.map(unwrap))).map(count);
    const v = Reflect.get(t, k);
    return typeof v === "function" ? v.bind(t) : v;
  },
});
const testEnv = { ...env, DB: countingDb, ENVIRONMENT: "development" } as unknown as Env;

async function measure(path: string) {
  rowsRead = 0;
  const res = await app.request(`http://localhost${path}`, {}, testEnv);
  expect(res.status, path).toBe(200);
  const body = path.startsWith("/api/") ? await res.json() : await res.text();
  return { rows: rowsRead, body: body as any };
}

describe("catalogue list reads stay small with a full-size catalogue", () => {
  beforeAll(async () => {
    for (const t of ["variants", "product_images", "product_sources", "product_categories", "products", "categories"]) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
    const seq = (n: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO categories (id, parent_id, name, handle, is_internal) VALUES (1, NULL, 'Plants', 'plants', 0), (2, 1, 'Fruit', 'fruit', 0), (3, 1, 'Shrubs', 'shrubs', 0), (4, NULL, 'Pots', 'pots', 0), (5, NULL, 'Unsorted', 'unsorted', 1)"),
      // 1..900 published; 901..1100 drafts in Unsorted; 1101..1120 published but still in Unsorted (hidden).
      env.DB.prepare(`${seq(1120)} INSERT INTO products (id, handle, title, status, created_at, updated_at)
        SELECT i, 'p' || i, 'Plant ' || printf('%04d', (i * 7919) % 1120), CASE WHEN i BETWEEN 901 AND 1100 THEN 'draft' ELSE 'published' END, '${NOW}', '${NOW}' FROM n`),
      env.DB.prepare(`${seq(1120)} INSERT INTO product_categories (product_id, category_id)
        SELECT i, CASE WHEN i > 900 THEN 5 WHEN i % 3 = 0 THEN 2 WHEN i % 3 = 1 THEN 3 ELSE 4 END FROM n`),
      env.DB.prepare(`${seq(300)} INSERT INTO product_categories (product_id, category_id) SELECT i * 3, 4 FROM n`),
      env.DB.prepare(`${seq(1120)} INSERT INTO variants (product_id, sku, size_label, price_paise) SELECT i, 's' || i, 'Small', 10000 + i FROM n`),
      env.DB.prepare(`${seq(1120)} INSERT INTO variants (product_id, sku, size_label, price_paise) SELECT i, 'l' || i, 'Large', NULL FROM n`),
      env.DB.prepare(`${seq(1120)} INSERT INTO product_images (product_id, r2_key, position) SELECT i, 'img/' || i || '.jpg', 0 FROM n`),
    ]);
  });

  it("default list, deep page and search each read well under 1,500 rows, with an exact total", async () => {
    for (const path of ["/api/store/products", "/api/store/products?page=30", "/api/store/products?q=Plant%2000"]) {
      const { rows, body } = await measure(path);
      expect(rows, path).toBeLessThan(1500);
      if (path === "/api/store/products") {
        expect(body.total).toBe(900);
        expect(body.items).toHaveLength(24);
      }
    }
  });

  it("category list reads stay bounded and total is exact", async () => {
    const parent = await measure("/api/store/products?category=plants");
    expect(parent.body.total).toBe(600);
    expect(parent.rows).toBeLessThan(3000);
    const leaf = await measure("/api/store/products?category=pots");
    expect(leaf.body.total).toBe(600);
    expect(leaf.rows).toBeLessThan(3000);
  });

  it("product detail reads only a few rows", async () => {
    const { rows } = await measure("/api/store/products/p5");
    expect(rows).toBeLessThan(50);
  });

  it("admin product list reads well under 1,500 rows", async () => {
    for (const path of ["/admin/products", "/admin/products?filter=published", "/admin/products?page=10"]) {
      const { rows } = await measure(path);
      expect(rows, path).toBeLessThan(1500);
    }
  });

  it("admin similar and out-of-stock filters read well under 1,500 rows", async () => {
    for (const path of ["/admin/products?filter=similar", "/admin/products?filter=out-of-stock"]) {
      const { rows } = await measure(path);
      expect(rows, path).toBeLessThan(1500);
    }
  });

  it("publish page change count reads well under 1,500 rows", async () => {
    const withHook = { ...testEnv, PAGES_DEPLOY_HOOK: "https://hooks.test/x", CF_API_TOKEN: "t", CF_ACCOUNT_ID: "a", PAGES_PROJECT: "p" } as Env;
    const live = { id: "d", created_on: "2026-11-19T00:00:00Z", latest_stage: { name: "deploy", status: "success", ended_on: "2026-11-19T00:01:00Z" } };
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: [live] })));
    rowsRead = 0;
    const res = await app.request("http://localhost/admin/publish", {}, withHook);
    f.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("1120");
    expect(rowsRead).toBeLessThan(1500);
  });

  it("add-photo picker search reads well under 1,500 rows", async () => {
    const prefix = await measure("/admin/add-photo?q=Plant%2000");
    expect(prefix.rows).toBeLessThan(1500);
    expect(prefix.body).toContain("Plant 00");
    const lower = await measure("/admin/add-photo?q=plant");
    expect(lower.rows).toBeLessThan(1500);
    expect(lower.body).toContain("Plant 0");
  });
});

describe("store GET caching", () => {
  it("store GET JSON responses are cacheable for 2 minutes", async () => {
    for (const path of ["/api/store/categories", "/api/store/products", "/api/store/products/p5"]) {
      const res = await app.request(`http://localhost${path}`, {}, testEnv);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=120");
    }
    const missing = await app.request("http://localhost/api/store/products/nope", {}, testEnv);
    expect(missing.headers.get("cache-control")).toBeNull();
  });
});
