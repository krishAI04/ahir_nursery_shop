import { Hono } from "hono";
import type { Env } from "../env";
import { AccessError, verifyAccessJwt } from "./access";
import { mountPhotos } from "./photos";
import { mountPrices } from "./prices";
import { mountProductEdit } from "./product-edit";
import { mountProducts } from "./products";
import { mountPublish } from "./publish";

export type AdminEnv = { Bindings: Env; Variables: { staffEmail: string } };
export type AdminApp = Hono<AdminEnv>;

export const admin: AdminApp = new Hono<AdminEnv>();

const denied = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No access</title></head><body style="font:18px system-ui;padding:24px"><p>You don't have access. Ask the owner to add your email.</p></body></html>`;

admin.use("/admin", requireStaff());
admin.use("/admin/*", requireStaff());

// Access cookies ride along on cross-site top-level POSTs, so refuse any POST from another origin.
admin.use("/admin/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && ((origin !== undefined && origin !== new URL(c.req.url).origin) || c.req.header("Sec-Fetch-Site") === "cross-site")) {
    return c.text("Forbidden", 403);
  }
  await next();
});

/** Every admin response: never cached, never framed, no referrer to other sites. */
const setSecurityHeaders = (h: Headers) => {
  h.set("Cache-Control", "no-store");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "same-origin");
};

export function requireStaff() {
  return async (c: import("hono").Context<AdminEnv>, next: import("hono").Next) => {
    const host = new URL(c.req.url).hostname;
    if (c.env.ENVIRONMENT === "development" && (host === "localhost" || host === "127.0.0.1")) {
      c.set("staffEmail", "dev@local");
    } else {
      try {
        const { email } = await verifyAccessJwt(c.env, c.req.header("Cf-Access-Jwt-Assertion") ?? null);
        c.set("staffEmail", email);
      } catch (e) {
        if (!(e instanceof AccessError)) console.error(e);
        const res = c.html(denied, 403);
        setSecurityHeaders(res.headers);
        return res;
      }
    }
    await next();
    setSecurityHeaders(c.res.headers);
  };
}

admin.get("/admin", (c) => c.redirect("/admin/products", 302));

mountProducts(admin);
mountProductEdit(admin);
mountPrices(admin);
mountPhotos(admin);
mountPublish(admin);
