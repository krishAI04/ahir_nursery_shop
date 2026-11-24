import { cors } from "hono/cors";
import type { Env } from "../env";

// Only origins listed in STOREFRONT_ORIGINS (comma-separated) get CORS headers.
export const storefrontCors = cors({
  origin: (origin, c) => {
    const allowed = ((c.env as Env).STOREFRONT_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
  maxAge: 600,
});
