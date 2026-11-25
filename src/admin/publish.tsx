import { latestDeployments, statusLine, triggerBuild, type Status } from "../lib/pages";
import { Layout } from "./layout";
import type { AdminApp } from "./index";

const UNKNOWN: Status = { kind: "unknown", text: "Couldn't check the site status right now" };

const PUBLISHING: Status = { kind: "publishing", text: "Publishing…" };
const PENDING_MS = 10 * 60 * 1000;

// self: the GET address to reload while Publishing…, so the page updates itself (a POST result reloads as a GET).
function PublishPage(p: { email: string; status?: Status; error?: string; self?: string }) {
  const publishing = p.status?.kind === "publishing";
  const refresh = publishing ? `20;url=${p.self ?? "/admin/publish"}` : undefined;
  return (
    <Layout title="Publish site" email={p.email} refresh={refresh} hidePublish={publishing}>
      {!p.status ? (
        <p>Publishing isn't set up yet.</p>
      ) : (
        <>
          {p.error && <p role="alert" style="color:#8a2b2b;font-weight:600">{p.error}</p>}
          <p role="status">{p.status.text}</p>
          <p>Changes to products and photos go live on the shop site after you publish.</p>
          {!publishing && (
            <form method="post" action="/admin/publish">
              <button type="submit">{p.status.kind === "failed" ? "Try again" : "Publish site"}</button>
            </form>
          )}
        </>
      )}
    </Layout>
  );
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
    return c.html(<PublishPage email={c.var.staffEmail} status={status} self={self} />);
  });

  admin.post("/admin/publish", async (c) => {
    if (!c.env.PAGES_DEPLOY_HOOK) return c.notFound();
    if (await triggerBuild(c.env)) return c.redirect(`/admin/publish?started=${Date.now()}`, 303);
    const status = await latestDeployments(c.env).then(statusLine, () => UNKNOWN);
    return c.html(<PublishPage email={c.var.staffEmail} status={status} error="Couldn't start publishing, try again in a minute." />, 502);
  });
}
