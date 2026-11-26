import { raw } from "hono/html";
import type { Child } from "hono/jsx";

// Icon drawings from the approved mockup (24x24, stroke only); left/trash/grip/chevron drawn in the same style.
const icons = {
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19l7-7"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5"/><path d="M5 15v4h14v-4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.5"/><path d="M12 16.8v.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l4.5-4 3 2.5 3-3L20 16"/>',
  bulb: '<path d="M9 17h6M10 20h4"/><path d="M8 13.5A5.5 5.5 0 1 1 16 13.5c-.8.8-1 1.5-1 2.5H9c0-1-.2-1.7-1-2.5z"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.2"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/>',
  grip: '<path d="M5 9h14M5 15h14"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
};
export type IconName = keyof typeof icons;

export const iconSprite = raw(
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${Object.entries(icons)
    .map(([id, d]) => `<symbol id="${id}" viewBox="0 0 24 24">${d}</symbol>`)
    .join("")}</defs></svg>`,
);

export function Icon(p: { name: IconName; small?: boolean }) {
  return (
    <svg class={p.small ? "i s" : "i"} aria-hidden="true">
      <use href={`#${p.name}`} />
    </svg>
  );
}

export function Badge(p: { kind: "on" | "off" | "warn"; children: Child }) {
  return <span class={`badge b-${p.kind}`}>{p.children}</span>;
}

/** A dismissable tip line; shellScript remembers the dismiss in localStorage "nc-admin-tip-<id>". */
export function Tip(p: { id: string; children: Child; class?: string }) {
  return (
    <div class={p.class ? `tip ${p.class}` : "tip"} data-tip={p.id}>
      <Icon name="bulb" />
      <span>{p.children}</span>
      <button type="button" class="x" aria-label="Hide this tip">
        <Icon name="close" small />
      </button>
    </div>
  );
}

/** Bottom sheet opened by the top-bar "?" (shellScript wires [data-open-help]). */
export function HelpSheet(p: { title: string; steps: string[]; email?: string }) {
  return (
    <dialog id="help-sheet" class="sheet" aria-labelledby="help-title">
      <div class="grab" />
      <div class="head">
        <h2 id="help-title">{p.title}</h2>
        <form method="dialog">
          <button class="x" aria-label="Close help">
            <Icon name="close" />
          </button>
        </form>
      </div>
      <ol>
        {p.steps.map((s) => (
          <li>{s}</li>
        ))}
      </ol>
      <p class="more">
        <a href="/admin/help">All help</a>
      </p>
      {p.email && <p class="who">Signed in as {p.email}</p>}
    </dialog>
  );
}

export const shellScript = `
document.querySelectorAll("[data-tip]").forEach(function (t) {
  var key = "nc-admin-tip-" + t.getAttribute("data-tip");
  try { if (localStorage.getItem(key)) t.hidden = true; } catch (e) {}
  t.querySelector("button").addEventListener("click", function () {
    t.hidden = true;
    try { localStorage.setItem(key, "1"); } catch (e) {}
  });
});
document.querySelectorAll("[data-open-help]").forEach(function (b) {
  b.addEventListener("click", function () { document.getElementById("help-sheet").showModal(); });
});
`;

export const adminCss = `
:root{--cream:#f7f2e8;--paper:#fffdf8;--forest:#173826;--leaf:#2f6b3f;--mint:#e3efe3;--clay:#a3472f;--amber:#b7791f;--amberbg:#fdf3dc;--muted:#5f5d50;--line:#e6dcc7;--text:#22301f}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;font:16px/1.5 Figtree,system-ui,sans-serif;color:var(--text);background:var(--cream);padding-bottom:calc(84px + env(safe-area-inset-bottom))}
h1,h2,h3{font-family:"Young Serif",serif;font-weight:400;color:var(--forest);line-height:1.25}
h2{font-size:20px;margin:20px 0 8px}
a{color:var(--leaf)}
a,button{min-height:44px}
svg.i{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none;vertical-align:middle}
svg.s{width:16px;height:16px}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 18px;border:0;border-radius:12px;background:var(--forest);color:#fff;font:inherit;font-size:15px;font-weight:700;text-decoration:none;cursor:pointer}
.btn.s{background:var(--paper);color:var(--forest);border:1.5px solid var(--forest)}
input,select,textarea{font:inherit;font-size:16px;min-height:44px;padding:10px 12px;max-width:100%;background:var(--paper);border:1px solid var(--line);border-radius:12px;color:var(--text)}
input[type=checkbox],input[type=radio]{min-height:0;width:22px;height:22px;accent-color:var(--leaf)}
.mark{width:30px;height:30px;border-radius:50%;background:var(--mint);color:var(--forest);display:grid;place-items:center;flex:none}
.mark svg.i{width:18px;height:18px}
.top{display:flex;align-items:center;gap:10px;padding:8px 16px 10px}
.top .t{flex:1;min-width:0}
.top h1{font-size:18px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top h1.ptitle{font-size:21px}
.top small{display:block;font-size:12px;color:var(--muted)}
.top form{margin:0}
.top form button{border-radius:999px;padding:0 14px;font-size:14px}
.back{display:inline-flex;align-items:center;gap:2px;padding:0 10px;font-size:14px;font-weight:600;color:var(--leaf);text-decoration:none}
.q{width:44px;height:44px;padding:0;background:none;color:var(--forest);flex:none}
.q span{width:34px;height:34px;border-radius:50%;background:var(--paper);border:1px solid var(--line);display:grid;place-items:center}
.q svg.i{width:18px;height:18px}
main{max-width:720px;margin:0 auto;padding:0 14px 24px}
main.wide{max-width:none}
.tip{display:flex;gap:10px;align-items:flex-start;background:var(--mint);border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.4;margin:0 0 12px}
.tip>svg.i{color:var(--forest);width:18px;height:18px;margin-top:1px}
.tip b{color:var(--forest)}
.tip>span{flex:1}
.tip .x{width:44px;height:44px;margin:-10px -12px -10px 0;padding:0;background:none;color:var(--muted)}
.badge{display:inline-block;font-size:12px;font-weight:700;padding:3px 8px;border-radius:999px}
.b-on{background:var(--mint);color:var(--leaf)}
.b-off{background:#eee9de;color:var(--muted)}
.b-warn{background:var(--amberbg);color:#8a5a12}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px}
.card h2{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:18px}
.card h2 svg.i{width:20px;height:20px}
.card ol{margin:0;padding-left:22px}
.card li{padding:3px 0}
.who{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:10;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;background:var(--paper);border-top:1px solid var(--line);padding:6px 6px calc(12px + env(safe-area-inset-bottom))}
.tabs a{display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:2px;font-size:12px;font-weight:600;color:var(--muted);text-decoration:none}
.tabs .pill{width:56px;height:30px;border-radius:999px;display:grid;place-items:center}
.tabs a[aria-current]{color:var(--forest);font-weight:700}
.tabs a[aria-current] .pill{background:var(--mint)}
.tabs a.cam{color:var(--forest);font-weight:700}
.tabs a.cam .pill{width:60px;height:34px;margin-top:-2px;background:var(--forest);color:#fff}
.side{display:none}
dialog.sheet{width:100%;max-width:560px;max-height:85vh;margin:auto auto 0;border:0;border-radius:22px 22px 0 0;background:var(--cream);color:var(--text);padding:10px 16px calc(18px + env(safe-area-inset-bottom))}
dialog.sheet::backdrop{background:rgba(20,30,20,.45)}
.grab{width:40px;height:5px;border-radius:3px;background:#cfc6b3;margin:0 auto 8px}
.sheet .head{display:flex;align-items:center;gap:8px}
.sheet h2{flex:1;margin:0;font-size:20px}
.sheet .x{width:44px;height:44px;padding:0;background:none;color:var(--muted)}
.sheet ol{margin:8px 0 12px;padding-left:22px}
.sheet li{padding:4px 0}
.sheet .more{margin:0}
.sheet .more a{display:inline-flex;align-items:center;font-weight:600}
.hint{font-size:14px;color:var(--muted);margin:6px 2px 0}
.form label{display:block;font-size:15px;font-weight:700;margin:14px 2px 6px}
.form input,.form select{width:100%}
.form button{margin-top:20px;width:100%}
.find{display:flex;gap:8px;margin:0 0 10px;flex:1}
.find label{flex:1;min-width:0;display:flex;align-items:center;gap:8px;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:0 12px;color:var(--muted)}
.find label:focus-within{outline:2px solid var(--leaf);outline-offset:1px}
.find input{flex:1;min-width:0;border:0;padding:10px 0;background:none;outline:none}
.find .btn{padding:0 14px}
.chips{display:flex;gap:6px;overflow-x:auto;margin:0 -14px 10px;padding:0 14px 2px;scrollbar-width:none}
.chip{flex:none;display:inline-flex;align-items:center;gap:5px;min-height:44px;padding:0 14px;border-radius:999px;background:var(--paper);border:1px solid var(--line);font-size:14px;font-weight:600;color:var(--text);text-decoration:none}
.chip em{font-style:normal;font-weight:500;color:var(--muted)}
.chip[aria-current]{background:var(--forest);border-color:var(--forest);color:#fff}
.chip[aria-current] em{color:#dfe9e0}
.plist{list-style:none;margin:0;padding:0}
.item{display:flex;gap:12px;align-items:center;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:9px;margin-bottom:8px;color:var(--text);text-decoration:none}
.thumb{width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none;background:#f1ece0}
.thumb.none{display:grid;place-items:center;border:1.5px dashed #cdbf9f;color:#8a7a58}
.thumb.none svg.i{width:24px;height:24px}
.item .t{flex:1;min-width:0}
.item .t b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item .meta{display:block;font-size:14px;color:var(--muted)}
.item .pb .badge{margin-top:4px}
.item .chev{color:#b9ae94;display:flex}
.fab{position:fixed;right:16px;bottom:calc(92px + env(safe-area-inset-bottom));z-index:9;border-radius:999px;background:var(--leaf);box-shadow:0 6px 16px rgba(0,0,0,.22)}
.stats,.ptable{display:none}
.pager{display:flex;gap:8px;margin:14px 0 72px}
@media (min-width:900px){
.tools{display:flex;gap:12px;align-items:flex-start}
.fab{position:static;background:var(--forest);box-shadow:none;border-radius:12px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 12px}
.stat{margin:0;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:14px;color:var(--muted)}
.stat b{display:block;font:400 22px "Young Serif",serif;color:var(--forest)}
.chips{flex-wrap:wrap;margin:0 0 12px;padding:0}
.plist.with-table{display:none}
.ptable{display:table;width:100%;border-collapse:separate;border-spacing:0;background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px}
.ptable th{text-align:left;font-size:14px;font-weight:700;color:var(--muted);background:#f6f0e3;padding:10px 12px}
.ptable td{padding:8px 12px;border-top:1px solid var(--line);vertical-align:middle;overflow-wrap:anywhere}
.ptable tr{position:relative}
.ptable tbody tr:hover{background:#fbf6ec}
.ptable td a{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:600;text-decoration:none}
.ptable td a::after{content:"";position:absolute;inset:0}
.ptable a:focus-visible{outline:none}
.ptable tr:focus-within{outline:2px solid var(--leaf);outline-offset:-2px}
.ptable .thumb{width:40px;height:40px;border-radius:8px}
.pager{margin-bottom:0}
body{display:grid;grid-template-columns:210px 1fr;min-height:100vh;padding-bottom:0}
.tabs,.top .mark,.top small,.page-tip{display:none}
.top{padding:20px 24px 12px}
.top h1,.top h1.ptitle{font-size:24px}
main{margin:0;padding:0 24px 32px}
.side{position:sticky;top:0;height:100vh;overflow-y:auto;display:flex;flex-direction:column;background:var(--forest);color:#e8efe6;padding:18px 14px;font-size:14px}
.side .brand{display:flex;align-items:center;gap:8px;margin-bottom:22px;font-family:"Young Serif",serif;font-size:17px;color:#fff}
.side a{display:flex;align-items:center;gap:8px;padding:0 10px;margin-bottom:2px;border-radius:10px;color:#e8efe6;text-decoration:none}
.side a svg.i{width:18px;height:18px;opacity:.9}
.side a[aria-current]{background:rgba(255,255,255,.13);color:#fff;font-weight:700}
.side .help{margin-top:26px;background:rgba(255,255,255,.08);padding:10px;border-radius:10px;line-height:1.45}
.side .who{margin-top:auto;padding-top:16px;color:#c9d6cb}
dialog.sheet{margin:auto;border-radius:22px;max-height:80vh;padding-bottom:18px}
.grab{display:none}
}
`;
