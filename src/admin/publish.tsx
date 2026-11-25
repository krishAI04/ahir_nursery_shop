import { latestDeployments, statusLine, triggerBuild, type Status } from "../lib/pages";
import { Layout } from "./layout";
import type { AdminApp } from "./index";

const UNKNOWN: Status = { kind: "unknown", text: "Couldn't check the site status right now" };

function PublishPage(p: { email: string; status?: Status; error?: string }) {
  return (
    <Layout title="Publish site" email={p.email} canPublish={!!p.status}>
      {!p.status ? (
        <p>Publishing isn't set up yet.</p>
      ) : (
        <>
          {p.error && <p role="alert" style="color:#8a2b2b;font-weight:600">{p.error}</p>}
          <p role="status">{p.status.text}</p>
          <p>Changes to products and photos go live on the shop site after you publish.</p>
          <form method="post" action="/admin/publish">
            <button type="submit">{p.status.kind === "failed" ? "Try again" : "Publish site"}</button>
          </form>
        </>
      )}
    </Layout>
  );
}

export function mountPublish(admin: AdminApp) {
  admin.get("/admin/publish", async (c) => {
    if (!c.env.PAGES_DEPLOY_HOOK) return c.html(<PublishPage email={c.var.staffEmail} />);
    const status = await latestDeployments(c.env).then(statusLine, () => UNKNOWN);
    return c.html(<PublishPage email={c.var.staffEmail} status={status} />);
  });

  admin.post("/admin/publish", async (c) => {
    if (!c.env.PAGES_DEPLOY_HOOK) return c.notFound();
    if (await triggerBuild(c.env)) return c.redirect("/admin/publish", 303);
    const status = await latestDeployments(c.env).then(statusLine, () => UNKNOWN);
    return c.html(<PublishPage email={c.var.staffEmail} status={status} error="Couldn't start publishing, try again in a minute." />, 502);
  });
}
