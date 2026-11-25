import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPublishCron } from "../src/cron/publish";
import { db, schema } from "../src/db";
import type { Env } from "../src/env";

const HOOK = "https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abc";
const NIGHTLY = "30 20 * * *";
const CHECK = "*/30 * * * *";
const withHook = { ...env, PAGES_DEPLOY_HOOK: HOOK, CF_API_TOKEN: "tok", CF_ACCOUNT_ID: "acc", PAGES_PROJECT: "shop" } as unknown as Env;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const dep = (id: string, stage: string, status: string) => ({ id, created_on: "2026-11-25T05:10:00Z", latest_stage: { name: stage, status, ended_on: null } });
// Stub that answers the hook POST with 200 and the deployments GET with `deploys`.
const stub = (deploys: unknown[] | Response) =>
  vi.fn(async (url: string | URL | Request) => (String(url) === HOOK ? json({}) : deploys instanceof Response ? deploys : json({ result: deploys })));
const hookCalls = (f: ReturnType<typeof stub>) => f.mock.calls.filter(([u]) => String(u) === HOOK).length;

beforeEach(async () => {
  await db(env as unknown as Env).delete(schema.sitePublish);
});

describe("runPublishCron", () => {
  it("nightly triggers one build", async () => {
    const f = stub([]);
    expect(await runPublishCron(NIGHTLY, withHook, f as unknown as typeof fetch)).toBe("nightly");
    expect(hookCalls(f)).toBe(1);
  });

  it("retries a failed newest deploy once, then does nothing for the same id", async () => {
    const f = stub([dep("bad", "build", "failure"), dep("old", "deploy", "success")]);
    expect(await runPublishCron(CHECK, withHook, f as unknown as typeof fetch)).toBe("retried");
    expect(await runPublishCron(CHECK, withHook, f as unknown as typeof fetch)).toBe("nothing");
    expect(hookCalls(f)).toBe(1);
  });

  it("first failure after a live deploy is retried", async () => {
    const f = stub([dep("bad", "build", "failure"), dep("ok", "deploy", "success")]);
    expect(await runPublishCron(CHECK, withHook, f as unknown as typeof fetch)).toBe("retried");
    expect(hookCalls(f)).toBe(1);
  });

  it("a retry that fails again is not retried", async () => {
    const f = stub([dep("bad2", "build", "failure"), dep("bad1", "build", "failure"), dep("ok", "deploy", "success")]);
    expect(await runPublishCron(CHECK, withHook, f as unknown as typeof fetch)).toBe("nothing");
    expect(hookCalls(f)).toBe(0);
  });

  it("retries a new failure after an earlier one was retried", async () => {
    await runPublishCron(CHECK, withHook, stub([dep("bad1", "build", "failure")]) as unknown as typeof fetch);
    const f = stub([dep("bad2", "build", "failure")]);
    expect(await runPublishCron(CHECK, withHook, f as unknown as typeof fetch)).toBe("retried");
  });

  it("does nothing when the newest deploy is live or publishing", async () => {
    for (const d of [dep("a", "deploy", "success"), dep("b", "build", "active")]) {
      const f = stub([d]);
      expect(await runPublishCron(CHECK, withHook, f as unknown as typeof fetch)).toBe("nothing");
      expect(hookCalls(f)).toBe(0);
    }
  });

  it("does nothing when the hook is unset", async () => {
    const f = stub([dep("bad", "build", "failure")]);
    const noHook = { ...withHook, PAGES_DEPLOY_HOOK: "" } as Env;
    expect(await runPublishCron(NIGHTLY, noHook, f as unknown as typeof fetch)).toBe("nothing");
    expect(await runPublishCron(CHECK, noHook, f as unknown as typeof fetch)).toBe("nothing");
    expect(f).not.toHaveBeenCalled();
  });

  it("check returns nothing without fetching when API credentials are missing", async () => {
    const f = stub([dep("bad", "build", "failure")]);
    const partial = { ...withHook, CF_API_TOKEN: "" } as Env;
    expect(await runPublishCron(CHECK, partial, f as unknown as typeof fetch)).toBe("nothing");
    expect(f).not.toHaveBeenCalled();
    expect(await runPublishCron(NIGHTLY, partial, f as unknown as typeof fetch)).toBe("nightly");
  });

  it("check returns nothing when the deployments API is down, without leaking secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = stub(json({}, 500));
    expect(await runPublishCron(CHECK, withHook, f as unknown as typeof fetch)).toBe("nothing");
    expect(hookCalls(f)).toBe(0);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("tok");
    expect(logged).not.toContain(HOOK);
    log.mockRestore();
  });
});
