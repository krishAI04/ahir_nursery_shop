import { Hono } from "hono";
import type { Env } from "./env";
import { storefrontCors } from "./lib/cors";
import { catalog } from "./store/catalog";
import { admin } from "./admin/index";
import { runPublishCron } from "./cron/publish";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.use("/api/store/*", storefrontCors);
app.route("/", catalog);
// All /admin routes must be added to the `admin` sub-app (behind requireStaff), never on this parent app.
app.route("/", admin);

export default {
  fetch: app.fetch,
  scheduled: (e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runPublishCron(e.cron, env));
  },
};
