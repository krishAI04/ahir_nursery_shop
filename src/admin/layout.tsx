import { raw } from "hono/html";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Child } from "hono/jsx";

/** Set per request by the admin middleware so every page shows the Publish button without passing it down. */
export const adminRequest = new AsyncLocalStorage<{ canPublish: boolean }>();

const css = `
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1c1c1c;background:#fafaf7}
.who{font-size:16px;color:#555;padding:6px 16px;background:#eee}
nav{display:flex;flex-wrap:wrap;gap:8px;padding:8px 16px;background:#fff;border-bottom:1px solid #ddd}
nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:8px;background:#e8efe3;color:#1c3d1c;text-decoration:none;font-weight:600}
main{padding:16px;max-width:900px;margin:0 auto}
a,button{min-height:44px}
button,.btn{display:inline-flex;align-items:center;min-height:44px;text-decoration:none;font:inherit;font-weight:600;padding:0 18px;border:0;border-radius:8px;background:#2d6a2d;color:#fff;cursor:pointer}
input,select,textarea{font:inherit;min-height:44px;padding:6px 10px;max-width:100%}
`;

export function Layout(props: { title: string; email: string; refresh?: string; children?: Child }) {
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title}</title>
          {props.refresh && <meta http-equiv="refresh" content={props.refresh} />}
          <style dangerouslySetInnerHTML={{ __html: css }} />
        </head>
        <body>
          <div class="who">{props.email}</div>
          <nav>
            <a href="/admin/products">Products</a>
            <a href="/admin/products?filter=needs-photo">Needs photo</a>
            {adminRequest.getStore()?.canPublish && (
              <form method="post" action="/admin/publish" style="margin-left:auto">
                <button type="submit">Publish site</button>
              </form>
            )}
          </nav>
          <main>
            <h1>{props.title}</h1>
            {props.children}
          </main>
        </body>
      </html>
    </>
  );
}
