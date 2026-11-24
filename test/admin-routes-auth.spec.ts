import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { admin } from "../src/admin/index";
import { app } from "../src/index";
import type { Env } from "../src/env";

// Production mode, no Cf-Access-Jwt-Assertion: every admin route must refuse.
const prodEnv = { ...env, ENVIRONMENT: "production" } as unknown as Env;
const routes = [...new Map(admin.routes.filter((r) => r.method !== "ALL").map((r) => [`${r.method} ${r.path}`, r])).values()];
const concrete = (path: string) => path.replace(/:\w+(\{[^}]*\})?/g, "1").replace(/\*/g, "x");

describe("admin routes without an Access JWT", () => {
  it("finds the admin routes", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes.map((r) => [r.method, r.path] as const))("%s %s → 403", async (method, path) => {
    const res = await app.request(`https://shop.example${concrete(path)}`, { method }, prodEnv);
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
