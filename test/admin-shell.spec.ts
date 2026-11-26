import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { admin } from "../src/admin/index";
import type { Env } from "../src/env";

// The Publish menu item only shows when publishing is set up (admin-publish.spec "no nav link"), so give this env a hook.
const devEnv = { ...env, ENVIRONMENT: "development", PAGES_DEPLOY_HOOK: "https://hooks.test/deploy/x" } as unknown as Env;
const BASE = "http://localhost";
const get = (path: string) => admin.request(`${BASE}${path}`, {}, devEnv);

describe("admin shell", () => {
  it("every page has the bottom menu with Products, Add photo, Publish, Help", async () => {
    const html = await (await get("/admin/products")).text();
    for (const href of ["/admin/products", "/admin/add-photo", "/admin/publish", "/admin/help"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain("Add photo");
    expect(html).toContain("Help");
    expect(html).toContain('<symbol id="camera"');
  });

  it("no emoji in admin pages", async () => {
    for (const path of ["/admin/products", "/admin/help", "/admin/products/new"]) {
      const html = await (await get(path)).text();
      expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it("help page explains the main jobs", async () => {
    const res = await get("/admin/help");
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const s of ["Add a photo", "Hide a product", "Publish", "Sizes"]) expect(html).toContain(s);
  });

  it("the menu marks the current page", async () => {
    const html = await (await get("/admin/help")).text();
    expect(html).toMatch(/href="\/admin\/help"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/help"/);
  });
});
