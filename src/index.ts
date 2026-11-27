import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { storefrontCors } from "./lib/cors";
import { catalog } from "./store/catalog";
import { admin } from "./admin/index";
import { adminLogin } from "./admin/login";
import { runPublishCron } from "./cron/publish";
import { edgeCache } from "./lib/edge-cache";
import { setSecurityHeaders } from "./admin/session";

export const app = new Hono<{ Bindings: Env }>();

// With ADMIN_HOST set, the admin lives only on that host and the shop API only on the others.
// Old /admin links on the API host get a 301; posts there are refused rather than forwarded.
app.use("*", async (c, next) => {
  const adminHost = c.env.ADMIN_HOST;
  const url = new URL(c.req.url);
  if (!adminHost || url.hostname === "localhost" || url.hostname === "127.0.0.1") return next(); // local dev: one host
  const isAdminPath = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
  if (url.hostname === adminHost) {
    if (url.pathname === "/") return c.redirect("/admin", 302);
    return isAdminPath || url.pathname.startsWith("/img/") ? next() : c.notFound();
  }
  if (!isAdminPath) return next();
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.notFound();
  return c.redirect(`https://${adminHost}${url.pathname}${url.search}`, 301);
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.use("/api/store/*", storefrontCors);
app.use("/api/store/*", edgeCache);
app.route("/", catalog);
// All /admin routes must be added to the `admin` sub-app (behind requireStaff), never on this parent app.
// The only exception is POST /admin/login, which has to work before anyone is signed in.
app.route("/", adminLogin);
app.route("/", admin);

// Unexpected errors: log them, answer without details (no stack traces or SQL reach the caller).
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  if (c.req.path.startsWith("/api/")) return c.json({ error: "internal" }, 500);
  const res = c.text("Something went wrong. Please try again in a minute.", 500);
  if (c.req.path.startsWith("/admin")) setSecurityHeaders(res.headers);
  return res;
});

export default {
  fetch: app.fetch,
  scheduled: (e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runPublishCron(e.cron, env));
  },
};
