import type { Env } from "../env";
import { latestDeployments, stamp, statusLine, triggerBuild, type Deploy, type Status } from "../lib/pages";
import { Layout } from "./layout";
import { Icon } from "./ui";
import type { AdminApp } from "./index";

const UNKNOWN: Status = { kind: "unknown", text: "Couldn't check the site status right now" };

const PUBLISHING: Status = { kind: "publishing", text: "Publishing…" };
const PENDING_MS = 10 * 60 * 1000;

/** Products edited since the site last went live (all of them when it never has). */
export async function changedSince(env: Env, iso: string | null): Promise<number> {
  const row = iso
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE updated_at > ?").bind(iso).first<{ n: number }>()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM products").first<{ n: number }>();
  return row?.n ?? 0;
}

const HELP = {
  title: "Publish the website",
  steps: [
    "Tap Publish now to put your changes on the website.",
    "Wait about 3 minutes. The website stays open while it updates.",
    "When it says Live, the changes are on the website.",
  ],
};

function Steps() {
  return (
    <div class="steps" aria-label="Publishing progress">
      <p class="ok"><span class="dot"><Icon name="check" small /></span>Started</p>
      <p><span class="dot">…</span>Building the pages</p>
      <p><span class="dot">…</span>Going live</p>
    </div>
  );
}

// self: the GET address to reload while Publishing…, so the page updates itself (a POST result reloads as a GET).
// changes: how many products changed since the site was last live; since: when that was.
function PublishPage(p: { email: string; status?: Status; error?: string; self?: string; changes?: number | null; since?: string }) {
  const publishing = p.status?.kind === "publishing";
  const refresh = publishing ? `20;url=${p.self ?? "/admin/publish"}` : undefined;
  return (
    <Layout
      title="Publish site"
      email={p.email}
      active="publish"
      refresh={refresh}
      hidePublish={publishing}
      help={HELP}
      tip="No need to publish every time: the website also updates by itself every night at 2 am."
    >
      {!p.status ? (
        <p>Publishing isn't set up yet.</p>
      ) : (
        <>
          {p.error && <p role="alert" style="color:var(--clay);font-weight:600">{p.error}</p>}
          {p.changes != null && (
            <div class="pub">
              <div class="n">{p.changes}</div>
              <p>changes since the website was last updated{p.since ? ` (${p.since})` : ""}</p>
            </div>
          )}
          <p role="status">{p.status.text}</p>
          {publishing ? (
            <Steps />
          ) : (
            <>
              <form method="post" action="/admin/publish">
                <button type="submit" class="pubbtn">
                  <Icon name="upload" small />
                  {p.status.kind === "failed" ? "Try again" : "Publish now"}
                </button>
              </form>
              <p class="hint" style="text-align:center">Takes about 3 minutes. The website stays open while it updates.</p>
            </>
          )}
        </>
      )}
    </Layout>
  );
}

async function sinceLive(env: Env, ds: Deploy[]) {
  const live = ds.find((d) => d.status === "live");
  return { changes: await changedSince(env, live?.createdOn ?? null), since: live ? stamp(new Date(live.endedOn ?? live.createdOn), Date.now()) : undefined };
}

export function mountPublish(admin: AdminApp) {
  admin.get("/admin/publish", async (c) => {
    if (!c.env.PAGES_DEPLOY_HOOK) return c.html(<PublishPage email={c.var.staffEmail} />);
    const ds = await latestDeployments(c.env).catch(() => null);
    // Just after a click the new deployment may not exist yet: until one newer than the click shows up, say Publishing.
    const asked = Number(c.req.query("started"));
    const started = asked > 0 && asked <= Date.now() ? asked : 0; // a time in the future is ignored
    const pending = started > 0 && Date.now() - started < PENDING_MS && !(ds && ds[0] && Date.parse(ds[0].createdOn) >= started);
    const status = pending ? PUBLISHING : ds ? statusLine(ds) : UNKNOWN;
    const self = started > 0 ? `/admin/publish?started=${started}` : "/admin/publish";
    const more = ds ? await sinceLive(c.env, ds) : {};
    return c.html(<PublishPage email={c.var.staffEmail} status={status} self={self} {...more} />);
  });

  admin.post("/admin/publish", async (c) => {
    if (!c.env.PAGES_DEPLOY_HOOK) return c.notFound();
    if (await triggerBuild(c.env)) return c.redirect(`/admin/publish?started=${Date.now()}`, 303);
    const status = await latestDeployments(c.env).then(statusLine, () => UNKNOWN);
    return c.html(<PublishPage email={c.var.staffEmail} status={status} error="Couldn't start publishing, try again in a minute." />, 502);
  });
}
