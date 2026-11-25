import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { Env } from "../env";
import { latestDeployments, triggerBuild } from "../lib/pages";

/** Nightly rebuild, and a 30-minute check that retries a failed deploy once. */
export async function runPublishCron(cron: string, env: Env, fetchImpl: typeof fetch = fetch): Promise<"nightly" | "retried" | "nothing"> {
  if (!env.PAGES_DEPLOY_HOOK) return "nothing";
  if (cron === "30 20 * * *") {
    await triggerBuild(env, fetchImpl);
    return "nightly";
  }
  if (cron !== "*/30 * * * *" || !env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.PAGES_PROJECT) return "nothing";

  let newest, previous;
  try {
    [newest, previous] = await latestDeployments(env, fetchImpl);
  } catch (e) {
    console.error("publish check failed:", e instanceof Error ? e.message : "unknown error"); // message holds the status code only
    return "nothing";
  }
  // Only the first failure of a streak is retried; later ones wait for staff or the nightly build.
  if (newest?.status !== "failed" || previous?.status === "failed") return "nothing";

  const d = db(env);
  const [row] = await d.select().from(schema.sitePublish).where(eq(schema.sitePublish.id, 1));
  if (row?.lastRetriedDeployId === newest.id) return "nothing";
  await d
    .insert(schema.sitePublish)
    .values({ id: 1, lastRetriedDeployId: newest.id })
    .onConflictDoUpdate({ target: schema.sitePublish.id, set: { lastRetriedDeployId: newest.id } });
  await triggerBuild(env, fetchImpl);
  return "retried";
}
