import type { Env } from "../env";

export type Deploy = { id: string; createdOn: string; status: "live" | "failed" | "cancelled" | "publishing" | "unknown"; endedOn: string | null };
export type Status = { kind: "publishing" | "live" | "failed" | "cancelled" | "unknown"; text: string };

/** A non-2xx answer from the Pages API; only the status code is kept, so logs never carry URLs or tokens. */
export class PagesApiError extends Error {
  constructor(readonly status: number) {
    super(`Pages API ${status}`);
  }
}

/** Ask Cloudflare Pages to rebuild the site. True on a 2xx answer. */
export async function triggerBuild(env: Env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    return (await fetchImpl(env.PAGES_DEPLOY_HOOK, { method: "POST" })).ok;
  } catch {
    return false;
  }
}

type ApiDeploy = { id: string; created_on: string; latest_stage?: { name?: string; status?: string; ended_on?: string | null } };

const WAITING_MAX = 30 * 60 * 1000;
// Cancelled and skipped deploys are their own status: never retried (Ruling J). A deploy still waiting
// (idle, or a stage status we don't know) only counts as publishing while it is under 30 minutes old.
function deployStatus(d: ApiDeploy, now: number): Deploy["status"] {
  const { name, status } = d.latest_stage ?? {};
  if (status === "success") return name === "deploy" ? "live" : "publishing";
  if (status === "failure") return "failed";
  if (status === "canceled" || status === "skipped") return "cancelled";
  if (status === "active") return "publishing";
  return now - Date.parse(d.created_on) < WAITING_MAX ? "publishing" : "unknown";
}

/** Newest first. Throws on a network error or non-2xx; the caller decides what to show. */
export async function latestDeployments(env: Env, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Deploy[]> {
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${env.PAGES_PROJECT}/deployments?env=production`, {
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
  if (!res.ok) throw new PagesApiError(res.status);
  const { result } = (await res.json()) as { result?: ApiDeploy[] };
  return (result ?? []).map((d) => ({ id: d.id, createdOn: d.created_on, status: deployStatus(d, now), endedOn: d.latest_stage?.ended_on ?? null }));
}

const clock = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
/** "10:42 AM" today in Kolkata, "25 Nov, 10:42 AM" on any other day. */
const stamp = (at: Date, now: number) => {
  const time = clock.format(at).replace(/\s/g, " ").toUpperCase();
  const date = day.format(at);
  return date === day.format(now) ? time : `${date}, ${time}`;
};

export function statusLine(ds: Deploy[], now = Date.now()): Status {
  const when = (d: Deploy) => stamp(new Date(d.endedOn ?? d.createdOn), now);
  const [latest] = ds;
  if (!latest || latest.status === "unknown") return { kind: "unknown", text: "Couldn't check the site status right now" };
  if (latest.status === "publishing") return { kind: "publishing", text: "Publishing…" };
  if (latest.status === "live") return { kind: "live", text: `Live, updated ${when(latest)}` };
  const live = ds.find((d) => d.status === "live");
  if (latest.status === "cancelled") {
    return { kind: "cancelled", text: `Publishing was cancelled — ${live ? `the old site is still live (updated ${when(live)})` : "the site isn't live yet"}` };
  }
  return { kind: "failed", text: live ? `Didn't go through, the old site is still live (updated ${when(live)})` : "Didn't go through — the site isn't live yet" };
}
