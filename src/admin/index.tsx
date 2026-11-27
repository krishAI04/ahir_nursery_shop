import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import type { Env } from "../env";
import { AccessError, verifyAccessJwt } from "./access";
import { mountAddPhoto } from "./add-photo";
import { mountHelp } from "./help";
import { adminRequest } from "./layout";
import { mountPhotos } from "./photos";
import { mountPrices } from "./prices";
import { mountProductEdit } from "./product-edit";
import { mountProducts } from "./products";
import { mountPublish } from "./publish";
import { SESSION_COOKIE, crossSitePost, loginPage, sessionOk, setSecurityHeaders } from "./session";

export type AdminEnv = { Bindings: Env; Variables: { staffEmail: string } };
export type AdminApp = Hono<AdminEnv>;

export const admin: AdminApp = new Hono<AdminEnv>();

admin.use("/admin", requireStaff());
const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
admin.use("/admin/*", (c, next) => adminRequest.run({ canPublish: !!c.env.PAGES_DEPLOY_HOOK, nonce: newNonce() }, next));
admin.use("/admin/*", requireStaff());

// Session and Access cookies ride along on cross-site top-level POSTs, so refuse any POST from another origin.
admin.use("/admin/*", async (c, next) => {
  if (crossSitePost(c)) return c.text("Forbidden", 403);
  await next();
});

export function requireStaff() {
  return async (c: import("hono").Context<AdminEnv>, next: import("hono").Next) => {
    const host = new URL(c.req.url).hostname;
    if (c.env.ENVIRONMENT === "development" && (host === "localhost" || host === "127.0.0.1")) {
      c.set("staffEmail", "dev@local");
    } else if (await sessionOk(c.env, getCookie(c, SESSION_COOKIE))) {
      c.set("staffEmail", c.env.ADMIN_USERNAME);
    } else {
      try {
        const { email } = await verifyAccessJwt(c.env, c.req.header("Cf-Access-Jwt-Assertion") ?? null);
        c.set("staffEmail", email);
      } catch (e) {
        if (!(e instanceof AccessError)) console.error(e);
        const res = c.html(loginPage(), 403);
        setSecurityHeaders(res.headers);
        return res;
      }
    }
    await next();
    setSecurityHeaders(c.res.headers, { nonce: adminRequest.getStore()?.nonce, imageBase: c.env.IMAGE_BASE_URL });
  };
}

admin.get("/admin", (c) => c.redirect("/admin/products", 302));
admin.get("/admin/", (c) => c.redirect("/admin/products", 302)); // staff often type the trailing slash
admin.post("/admin/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/admin", secure: true, httpOnly: true, sameSite: "Strict" });
  return c.redirect("/admin", 303);
});

mountProducts(admin);
mountProductEdit(admin);
mountPrices(admin);
mountPhotos(admin);
mountPublish(admin);
mountAddPhoto(admin);
mountHelp(admin);
