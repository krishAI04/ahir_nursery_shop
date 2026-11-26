import { raw } from "hono/html";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Child } from "hono/jsx";
import { HelpSheet, Icon, Tip, adminCss, iconSprite, shellScript, type IconName } from "./ui";

/** Set per request by the admin middleware so every page shows the Publish button without passing it down. */
export const adminRequest = new AsyncLocalStorage<{ canPublish: boolean }>();

type Active = "products" | "needs-photo" | "photo" | "publish" | "help";
type MenuItem = { href: string; icon: IconName; label: string; side: string; active?: Active };

const fonts = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Young+Serif&display=swap";

// Short stable id from the tip text, so a changed tip shows again after an old one was hidden.
const tipId = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};

// hidePublish: the publish page leaves out the header button (it has its own Publish now).
export function Layout(props: {
  title: string;
  email: string;
  active?: Active;
  back?: { href: string; label: string };
  help?: { title: string; steps: string[] };
  tip?: string;
  refresh?: string;
  hidePublish?: boolean;
  wide?: boolean;
  /** Extra class on <main> and the header row, for a page with its own layout (the product page uses "pp"). */
  mainClass?: string;
  /** Tip for the laptop side menu when it should say more than the phone tip line. */
  sideTip?: string;
  /** Icon for the tip line (a light bulb unless the page says otherwise). */
  tipIcon?: IconName;
  children?: Child;
}) {
  const canPublish = !!adminRequest.getStore()?.canPublish;
  // No Publish link when publishing isn't set up (the page would only say so).
  const menu: MenuItem[] = [
    { href: "/admin/products", icon: "leaf", label: "Products", side: "Products", active: "products" },
    { href: "/admin/add-photo", icon: "camera", label: "Add photo", side: "Add photo", active: "photo" },
    { href: "/admin/products?filter=needs-photo", icon: "image", label: "", side: "Needs photo", active: "needs-photo" },
    ...(canPublish ? [{ href: "/admin/publish", icon: "upload", label: "Publish", side: "Publish website", active: "publish" } as MenuItem] : []),
    { href: "/admin/help", icon: "help", label: "Help", side: "Help", active: "help" },
  ];
  const current = (m: MenuItem) => (m.active && m.active === props.active ? "page" : undefined);
  // The bottom menu has no Needs photo item, so Products stays marked there.
  const tabCurrent = (m: MenuItem) => current(m) ?? (m.active === "products" && props.active === "needs-photo" ? "page" : undefined);
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title}</title>
          {props.refresh && <meta http-equiv="refresh" content={props.refresh} />}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
          <link rel="stylesheet" href={fonts} />
          <style dangerouslySetInnerHTML={{ __html: adminCss }} />
        </head>
        <body>
          {iconSprite}
          <nav class="side" aria-label="Menu">
            <div class="brand">
              <span class="mark">
                <Icon name="leaf" />
              </span>
              Nature Care
            </div>
            {menu.map((m) => (
              <a href={m.href} aria-current={current(m)}>
                <Icon name={m.icon} />
                {m.side}
              </a>
            ))}
            {(props.sideTip ?? props.tip) && <div class="help">Tip: {props.sideTip ?? props.tip}</div>}
            <p class="who">Signed in as {props.email}</p>
          </nav>
          <div>
            {props.back && (
              <a class="back" href={props.back.href}>
                <Icon name="left" small />
                {props.back.label}
              </a>
            )}
            <header class={props.mainClass ? `top ${props.mainClass}` : "top"}>
              {!props.back && (
                <span class="mark">
                  <Icon name="leaf" />
                </span>
              )}
              <div class="t">
                <h1 class={props.back ? "ptitle" : undefined}>{props.title}</h1>
                {!props.back && <small>Shop admin</small>}
              </div>
              {props.help && (
                <button type="button" class="q" data-open-help aria-label="Help for this page">
                  <span>
                    <Icon name="help" />
                  </span>
                </button>
              )}
              {canPublish && !props.hidePublish && (
                <form method="post" action="/admin/publish">
                  <button type="submit">Publish site</button>
                </form>
              )}
            </header>
            <main class={[props.wide && "wide", props.mainClass].filter(Boolean).join(" ") || undefined}>
              {props.tip && (
                <Tip id={tipId(props.tip)} class="page-tip" icon={props.tipIcon}>
                  <b>Tip:</b> {props.tip}
                </Tip>
              )}
              {props.children}
            </main>
          </div>
          <nav class="tabs" aria-label="Menu">
            {menu
              .filter((m) => m.label)
              .map((m) => (
                <a href={m.href} class={m.active === "photo" ? "cam" : undefined} aria-current={tabCurrent(m)}>
                  <span class="pill">
                    <Icon name={m.icon} />
                  </span>
                  {m.label}
                </a>
              ))}
          </nav>
          {props.help && <HelpSheet title={props.help.title} steps={props.help.steps} email={props.email} />}
          <script>{raw(shellScript)}</script>
        </body>
      </html>
    </>
  );
}
