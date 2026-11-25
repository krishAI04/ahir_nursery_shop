import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admin } from "../src/admin/index";
import { latestDeployments, statusLine, triggerBuild, type Deploy } from "../src/lib/pages";
import type { Env } from "../src/env";

const HOOK = "https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abc";
const base = { ...env, ENVIRONMENT: "development" } as unknown as Env;
const withHook = { ...base, PAGES_DEPLOY_HOOK: HOOK, CF_API_TOKEN: "tok", CF_ACCOUNT_ID: "acc", PAGES_PROJECT: "shop" } as Env;
const noHook = { ...base, PAGES_DEPLOY_HOOK: "" } as Env;
const BASE = "http://localhost";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const dep = (stage: string, status: string, id = "d1") => ({
  id,
  created_on: "2026-11-25T05:10:00Z",
  latest_stage: { name: stage, status, ended_on: status === "active" ? null : "2026-11-25T05:12:00Z" },
});

afterEach(() => vi.restoreAllMocks());

describe("pages lib", () => {
  it("triggerBuild sends one POST to the hook and reports 2xx", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}));
    expect(await triggerBuild(withHook)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe(HOOK);
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("triggerBuild is false on non-2xx or network error", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({}, 500));
    expect(await triggerBuild(withHook)).toBe(false);
    f.mockRejectedValueOnce(new Error("down"));
    expect(await triggerBuild(withHook)).toBe(false);
  });

  it("latestDeployments maps success, failure, canceled and active", async () => {
    const f = vi.fn().mockResolvedValue(
      json({ result: [dep("deploy", "success", "a"), dep("build", "failure", "b"), dep("deploy", "canceled", "c"), dep("build", "active", "d"), dep("build", "success", "e")] }),
    );
    const ds = await latestDeployments(withHook, f as unknown as typeof fetch);
    expect(ds.map((d) => d.status)).toEqual(["live", "failed", "failed", "publishing", "publishing"]);
    expect(ds[0]).toEqual({ id: "a", createdOn: "2026-11-25T05:10:00Z", status: "live", endedOn: "2026-11-25T05:12:00Z" });
    expect(ds[3]!.endedOn).toBeNull();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/pages/projects/shop/deployments");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });
});

describe("statusLine", () => {
  const d = (status: Deploy["status"], endedOn: string | null = "2026-11-25T05:12:00Z"): Deploy => ({ id: "x", createdOn: "2026-11-25T05:10:00Z", status, endedOn });
  it("publishing", () => expect(statusLine([d("publishing", null)])).toEqual({ kind: "publishing", text: "Publishing…" }));
  it("live", () => expect(statusLine([d("live")])).toEqual({ kind: "live", text: "Live, updated 10:42 AM" }));
  it("failed shows last live time", () =>
    expect(statusLine([d("failed"), d("live")])).toEqual({
      kind: "failed",
      text: "Didn't go through, the old site is still live (updated 10:42 AM)",
    }));
  it("unknown when empty", () => expect(statusLine([]).kind).toBe("unknown"));
});

describe("admin publish page", () => {
  const get = (e: Env) => admin.request(`${BASE}/admin/publish`, {}, e);
  const post = (e: Env, headers: Record<string, string> = {}) => admin.request(`${BASE}/admin/publish`, { method: "POST", headers }, e);

  it("GET shows status and the button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ result: [dep("deploy", "success")] }));
    const html = await (await get(withHook)).text();
    expect(html).toContain("Live, updated 10:42 AM");
    expect(html).toContain("Publish site");
    expect(html).not.toContain("Try again");
  });

  it("GET shows Try again when failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ result: [dep("build", "failure")] }));
    expect(await (await get(withHook)).text()).toContain("Try again");
  });

  it("GET still renders when the status call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const html = await (await get(withHook)).text();
    expect(html).toContain("Couldn&#39;t check the site status right now");
    expect(html).toContain("Publish site");
  });

  it("POST triggers one build and redirects 303", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}));
    const res = await post(withHook);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/admin\/publish\?started=\d+$/);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe(HOOK);
  });

  it("POST shows an error when the trigger fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}, 500));
    const res = await post(withHook);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Couldn&#39;t start publishing, try again in a minute.");
  });

  it("without the hook: GET says not set up, POST is 404, no nav link", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const html = await (await get(noHook)).text();
    expect(html).toContain("Publishing isn&#39;t set up yet");
    expect(html).not.toContain('href="/admin/publish"');
    expect((await post(noHook)).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a cross-site POST", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    expect((await post(withHook, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it("after a click, says Publishing until a newer deployment appears", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ result: [dep("deploy", "success")] }));
    const at = (ms: number) => (async () => (await admin.request(`${BASE}/admin/publish?started=${ms}`, {}, withHook)).text())();
    expect(await at(Date.now())).toContain("Publishing…");
    f.mockResolvedValue(json({ result: [dep("build", "active")] }));
    expect(await at(Date.now())).toContain("Publishing…");
  });

  it("shows the Publish site button on other admin pages only when the hook is set", async () => {
    const on = await (await admin.request(`${BASE}/admin/products`, {}, withHook)).text();
    expect(on).toContain('action="/admin/publish"');
    const off = await (await admin.request(`${BASE}/admin/products`, {}, noHook)).text();
    expect(off).not.toContain("/admin/publish");
  });
});
