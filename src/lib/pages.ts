import type { Env } from "../env";

export type Deploy = { id: string; createdOn: string; status: "live" | "failed" | "publishing"; endedOn: string | null };
export type Status = { kind: "publishing" | "live" | "failed" | "unknown"; text: string };

/** Ask Cloudflare Pages to rebuild the site. True on a 2xx answer. */
export async function triggerBuild(env: Env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    return (await fetchImpl(env.PAGES_DEPLOY_HOOK, { method: "POST" })).ok;
  } catch {
    return false;
  }
}

type ApiDeploy = { id: string; created_on: string; latest_stage?: { name?: string; status?: string; ended_on?: string | null } };

/** Newest first. Throws on a network error or non-2xx; the caller decides what to show. */
export async function latestDeployments(env: Env, fetchImpl: typeof fetch = fetch): Promise<Deploy[]> {
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${env.PAGES_PROJECT}/deployments`, {
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Pages API ${res.status}`);
  const { result } = (await res.json()) as { result?: ApiDeploy[] };
  return (result ?? []).map((d) => {
    const { name, status, ended_on } = d.latest_stage ?? {};
    return {
      id: d.id,
      createdOn: d.created_on,
      status: status === "success" && name === "deploy" ? "live" : status === "failure" || status === "canceled" ? "failed" : "publishing",
      endedOn: ended_on ?? null,
    };
  });
}

const clock = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const when = (d: Deploy) => clock.format(new Date(d.endedOn ?? d.createdOn)).replace(/\s/g, " ").toUpperCase();

export function statusLine(ds: Deploy[]): Status {
  const [latest] = ds;
  if (!latest) return { kind: "unknown", text: "Couldn't check the site status right now" };
  if (latest.status === "publishing") return { kind: "publishing", text: "Publishing…" };
  if (latest.status === "live") return { kind: "live", text: `Live, updated ${when(latest)}` };
  const live = ds.find((d) => d.status === "live");
  return { kind: "failed", text: `Didn't go through, the old site is still live${live ? ` (updated ${when(live)})` : ""}` };
}
