import type { MiddlewareHandler } from "hono";
import type { Env } from "../env";

// A shared Cloudflare edge copy of public store reads, kept for their own Cache-Control window (2 minutes),
// so repeat reads by anyone cost no D1 rows. On when EDGE_CACHE is "on". The site build sends x-build-key
// and always reads fresh, so a Publish never builds from a copy older than the edit.
// CORS headers are stripped before storing; the CORS middleware adds the current caller's on the way out.
export const edgeCache: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.EDGE_CACHE !== "on" || c.req.method !== "GET" || c.req.header("x-build-key") !== undefined) return next();
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return next();
  const key = new Request(c.req.url);
  const hit = await cache.match(key);
  if (hit) {
    c.res = new Response(hit.body, hit);
    return;
  }
  await next();
  const res = c.res;
  if (res.status !== 200 || !/\bpublic\b/.test(res.headers.get("cache-control") ?? "")) return;
  const copy = new Response(res.clone().body, res);
  for (const h of [...copy.headers.keys()]) if (h.startsWith("access-control-")) copy.headers.delete(h);
  copy.headers.delete("vary");
  const put = cache.put(key, copy);
  try {
    c.executionCtx.waitUntil(put);
  } catch {
    await put; // no execution context (tests): store before answering
  }
};
