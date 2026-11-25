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
    const ds = await latestDeployments(withHook, f as unknown as typeof fetch, Date.parse("2026-11-25T05:11:00Z")); // fresh deploys
    expect(ds.map((d) => d.status)).toEqual(["live", "failed", "cancelled", "publishing", "publishing"]);
    expect(ds[0]).toEqual({ id: "a", createdOn: "2026-11-25T05:10:00Z", status: "live", endedOn: "2026-11-25T05:12:00Z" });
    expect(ds[3]!.endedOn).toBeNull();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/pages/projects/shop/deployments?env=production");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("latestDeployments: a build that finished but never deployed is unknown after 30 minutes", async () => {
    const created = Date.parse("2026-11-25T05:10:00Z");
    const f = vi.fn().mockImplementation(async () => json({ result: [dep("build", "success", "stuck")] }));
    expect((await latestDeployments(withHook, f as unknown as typeof fetch, created + 29 * 60_000))[0]!.status).toBe("publishing");
    expect((await latestDeployments(withHook, f as unknown as typeof fetch, created + 30 * 60_000))[0]!.status).toBe("unknown");
  });

  it("latestDeployments: skipped and canceled are cancelled; idle counts as publishing only for 30 minutes", async () => {
    const created = Date.parse("2026-11-25T05:10:00Z");
    const f = vi.fn().mockImplementation(async () =>
      json({ result: [dep("build", "skipped", "a"), dep("deploy", "canceled", "b"), dep("initialize", "idle", "c"), dep("queued", "weird", "d")] }),
    );
    const soon = await latestDeployments(withHook, f as unknown as typeof fetch, created + 29 * 60_000);
    expect(soon.map((d) => d.status)).toEqual(["cancelled", "cancelled", "publishing", "publishing"]);
    const late = await latestDeployments(withHook, f as unknown as typeof fetch, created + 30 * 60_000);
    expect(late.map((d) => d.status)).toEqual(["cancelled", "cancelled", "unknown", "unknown"]);
  });
});

describe("statusLine", () => {
  const d = (status: Deploy["status"], endedOn: string | null = "2026-11-25T05:12:00Z"): Deploy => ({ id: "x", createdOn: "2026-11-25T05:10:00Z", status, endedOn });
  it("publishing", () => expect(statusLine([d("publishing", null)])).toEqual({ kind: "publishing", text: "Publishing…" }));
  const today = Date.parse("2026-11-25T12:00:00Z");
  const nextDay = Date.parse("2026-11-26T09:00:00Z"); // 2:30 PM on 26 Nov in Asia/Kolkata
  it("live", () => expect(statusLine([d("live")], today)).toEqual({ kind: "live", text: "Live, updated 10:42 AM" }));
  it("live on an earlier day includes the date", () =>
    expect(statusLine([d("live")], nextDay)).toEqual({ kind: "live", text: "Live, updated 25 Nov, 10:42 AM" }));
  it("the day is counted in Asia/Kolkata, not UTC", () =>
    // 19:00 UTC on 25 Nov is still 25 Nov in UTC, but already 12:30 AM on 26 Nov in Kolkata
    expect(statusLine([d("live")], Date.parse("2026-11-25T19:00:00Z")).text).toBe("Live, updated 25 Nov, 10:42 AM"));
  it("failed shows last live time", () =>
    expect(statusLine([d("failed"), d("live")], today)).toEqual({
      kind: "failed",
      text: "Didn't go through, the old site is still live (updated 10:42 AM)",
    }));
  it("failed on a later day dates the last live time", () =>
    expect(statusLine([d("failed"), d("live")], nextDay).text).toBe("Didn't go through, the old site is still live (updated 25 Nov, 10:42 AM)"));
  it("unknown when empty", () => expect(statusLine([]).kind).toBe("unknown"));
  it("failed with no earlier live deploy makes no old-site claim", () =>
    expect(statusLine([d("failed"), d("failed")], today)).toEqual({ kind: "failed", text: "Didn't go through — the site isn't live yet" }));
  it("cancelled is its own status and names the live time", () =>
    expect(statusLine([d("cancelled"), d("live")], today)).toEqual({
      kind: "cancelled",
      text: "Publishing was cancelled — the old site is still live (updated 10:42 AM)",
    }));
  it("cancelled with nothing live yet", () =>
    expect(statusLine([d("cancelled")], today)).toEqual({ kind: "cancelled", text: "Publishing was cancelled — the site isn't live yet" }));
  it("a deploy of unknown state is unknown", () => expect(statusLine([d("unknown"), d("live")], today).kind).toBe("unknown"));
});

describe("admin publish page", () => {
  const get = (e: Env) => admin.request(`${BASE}/admin/publish`, {}, e);
  const post = (e: Env, headers: Record<string, string> = {}) => admin.request(`${BASE}/admin/publish`, { method: "POST", headers }, e);

  it("GET shows status and the button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ result: [dep("deploy", "success")] }));
    const html = await (await get(withHook)).text();
    expect(html).toMatch(/Live, updated (25 Nov, )?10:42 AM/); // dated unless the test runs on 25 Nov 2026
    expect(html).not.toContain('http-equiv="refresh"');
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

  it("while Publishing… the page refreshes itself every 20 seconds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ result: [dep("build", "active")] }));
    const html = await (await get(withHook)).text();
    expect(html).toContain("Publishing…");
    expect(html).toMatch(/<meta http-equiv="refresh" content="20(;url=\/admin\/publish)?"/);
    const started = Date.now();
    const after = await (await admin.request(`${BASE}/admin/publish?started=${started}`, {}, withHook)).text();
    expect(after).toContain(`content="20;url=/admin/publish?started=${started}"`);
  });

  it("hides Publish site and Try again while publishing, header included", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ result: [dep("build", "active")] }));
    const html = await (await get(withHook)).text();
    expect(html).toContain("Publishing…");
    expect(html).not.toContain('action="/admin/publish"');
    expect(html).not.toContain("Try again");
  });

  it("ignores a ?started= in the future", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ result: [dep("deploy", "success")] }));
    const future = Date.now() + 60 * 60 * 1000;
    const html = await (await admin.request(`${BASE}/admin/publish?started=${future}`, {}, withHook)).text();
    expect(html).toMatch(/Live, updated/);
    expect(html).not.toContain(String(future));
  });

  it("never puts the hook URL or the API token in a page", async () => {
    const secretHook = "https://hooks.test/deploy/HOOK-SECRET-7f3a";
    const secret = { ...withHook, PAGES_DEPLOY_HOOK: secretHook, CF_API_TOKEN: "TOKEN-SECRET-91bc" } as Env;
    const f = vi.spyOn(globalThis, "fetch");
    const pages: string[] = [];
    for (const answer of [[dep("deploy", "success")], [dep("build", "failure")], [dep("build", "active")]]) {
      f.mockResolvedValue(json({ result: answer }));
      pages.push(await (await get(secret)).text());
    }
    f.mockRejectedValue(new Error(`down ${secretHook} TOKEN-SECRET-91bc`));
    pages.push(await (await get(secret)).text());
    f.mockResolvedValue(json({}, 500));
    pages.push(await (await post(secret)).text());
    for (const html of pages) {
      expect(html).not.toContain("HOOK-SECRET-7f3a");
      expect(html).not.toContain("TOKEN-SECRET-91bc");
    }
  });

  it("shows the Publish site button on other admin pages only when the hook is set", async () => {
    const on = await (await admin.request(`${BASE}/admin/products`, {}, withHook)).text();
    expect(on).toContain('action="/admin/publish"');
    const off = await (await admin.request(`${BASE}/admin/products`, {}, noHook)).text();
    expect(off).not.toContain("/admin/publish");
  });
});
