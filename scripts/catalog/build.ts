import { slug } from "../../src/lib/slug";
import type { CatalogRow, GroupRow } from "./csv";
import { classify, defaultSizeLabel, extractSize, type PhotoClass } from "./size";

export type ProductDraft = {
  handle: string;
  title: string;
  status: "published" | "draft";
  categoryPaths: string[][];
  photoFile: string | null;
  credit: { author: string; license: string; source_url: string } | null;
  representative: boolean;
  variants: { sku: string; size: string; colour: string | null; rawNames: string[] }[];
  source: {
    sheetRows: string[];
    rawNames: string[];
    notes: string[];
    photoSource: string;
    sourceUrl: string;
    license: string;
    author: string;
  };
};

const TOP: Record<string, string> = {
  plants: "Plants",
  "pots-planters": "Pots & Planters",
  "garden-tools": "Garden Tools",
  "sprayers-watering": "Sprayers & Watering",
  "soil-fertilizer": "Soil & Fertilizer",
  "decor-accessories": "Decor & Accessories",
};
const RANK: PhotoClass[] = ["exact", "lookalike", "copied", "none", "code"];

function categoryPath(folder: string): string[] {
  const [top, ...rest] = folder.split("/").filter(Boolean);
  const name = (s: string) =>
    /^[a-z]{1,3}$/.test(s)
      ? s.toUpperCase()
      : s
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
  return [TOP[top] ?? name(top), ...rest.map(name)];
}

// Colour words (also used by generate-maps.ts). "Ter" / "Tec." are shop shorthand for Terracotta.
export const COLOUR = /(?<![A-Za-z])(Black|Terracotta|Teracota|Tercota|Ter|Tec\.?|Colours?|White)(?![A-Za-z])/i;
const COLOUR_NAME: Record<string, string> = {
  teracota: "Terracotta",
  tercota: "Terracotta",
  ter: "Terracotta",
  tec: "Terracotta",
  "tec.": "Terracotta",
  colours: "Colour",
};
export function colourName(word: string): string {
  const w = word.toLowerCase();
  return COLOUR_NAME[w] ?? w.charAt(0).toUpperCase() + w.slice(1);
}

type Token = { key: string; dims: boolean; safe: boolean };

// Numbers that are model codes or other units, never a size we can show.
const UNIT_AFTER = /^\s*(?:mm|cm|gsm|micron)\b/i;
const MODEL_BEFORE = /(?:^|[^A-Za-z])(?:fps|fprc)\s*-?\s*$/i;

/** Number tokens (hyphen-glued, mid-name, D/H dimensions) and a colour word from a raw name. */
function parseName(name: string): { tokens: Token[]; colour: string | null } {
  let t = name.replace(/\(\s*\d+\s*\)/g, " "); // set counts "(2)" are not sizes
  const dims: string[] = [];
  t = t.replace(/\(\s*([DL])\s*(\d+(?:\.\d+)?)\s*-\s*H\s*(\d+(?:\.\d+)?)\s*\)/gi, (_m, x: string, a: string, h: string) => {
    dims.push(`${x.toUpperCase()}${a}×H${h}`);
    return " \u0001 ";
  });
  const m = COLOUR.exec(t);
  const colour = m ? colourName(m[1]) : null;
  if (m) t = t.replace(COLOUR, " ");
  const tokens: Token[] = [...t.matchAll(/\u0001|\d+(?:\.\d+)?/g)].map((x) => {
    if (x[0] === "\u0001") return { key: dims.shift()!, dims: true, safe: true };
    const before = t.slice(0, x.index);
    const after = t.slice(x.index! + x[0].length);
    const safe = x[0].split(".")[0].length < 4 && !UNIT_AFTER.test(after) && !MODEL_BEFORE.test(before);
    return { key: x[0], dims: false, safe };
  });
  return { tokens, colour };
}

type Item = { row: CatalogRow; cls: PhotoClass; colour: string | null };

/** Number of extra raw names folded into an existing variant (same SKU). */
export const countMerges = (drafts: ProductDraft[]) =>
  drafts.reduce((n, d) => n + d.variants.reduce((m, v) => m + v.rawNames.length - 1, 0), 0);

export function buildDrafts(
  rows: CatalogRow[],
  groups: GroupRow[],
  sizeLabels: Map<string, string>,
): ProductDraft[] {
  const groupOf = new Map(groups.map((g) => [g.catalog_product, g]));
  const products = new Map<string, { title: string; items: Item[] }>();
  for (const row of rows) {
    const cls = classify(row.photo_source);
    if (cls === "excluded") continue;
    // Code-only rows are named by their code and never merged with a same-titled normal product.
    const g = cls === "code" ? undefined : groupOf.get(row.product);
    const title = cls === "code" ? row.raw_name : g ? g.shop_product : row.product || row.raw_name;
    const key = cls === "code" ? `code:${row.raw_name}` : title;
    const entry = products.get(key) ?? { title, items: [] };
    entry.items.push({ row, cls, colour: g?.colour || null });
    products.set(key, entry);
  }

  const usedHandles = new Set<string>();
  const drafts: ProductDraft[] = [];
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  for (const { title, items } of products.values()) {
    let handle = slug(title);
    for (let n = 2; usedHandles.has(handle); n++) handle = `${slug(title)}-${n}`;
    usedHandles.add(handle);

    const best = RANK.find((c) => items.some((i) => i.cls === c))!;
    const lead = items.find((i) => i.cls === best)!.row;
    const unsorted = best === "code" || !lead.folder;
    const folders = unsorted ? [] : uniq(items.map((i) => i.row.folder));
    const hasPhoto = (best === "exact" || best === "lookalike") && !!lead.photo_file;

    const isPlant = lead.folder.split("/")[0] === "plants";
    const numberUnit = lead.folder.split("/")[0] === "pots-planters" ? (n: string) => `${n} in` : (n: string) => `Size ${n}`;
    type Base = { item: Item; size: string; colour: string | null };
    const bases: Base[] = items.map((item) => {
      const raw = extractSize(item.row.raw_name);
      let size = sizeLabels.get(raw ?? "") ?? defaultSizeLabel(raw);
      // "Bag" only makes sense for plants; elsewhere AxB is just "A×B in".
      if (!isPlant && !sizeLabels.has(raw ?? "") && size.startsWith("Bag ")) size = size.slice(4);
      return { item, size, colour: item.colour };
    });
    // Rows that would collapse into one variant are split by colour word and, when none of them
    // carries a size mark, by the first safe number that differs. Set counts "(2)" never split.
    const buckets = new Map<string, Base[]>();
    for (const b of bases) {
      const k = `${b.size}|${b.colour ?? ""}`;
      buckets.set(k, [...(buckets.get(k) ?? []), b]);
    }
    for (const bucket of buckets.values()) {
      if (new Set(bucket.map((b) => b.item.row.raw_name)).size < 2) continue;
      const parsed = bucket.map((b) => parseName(b.item.row.raw_name));
      if (bucket.every((b) => b.colour === null) && new Set(parsed.map((p) => p.colour).filter(Boolean)).size >= 2) {
        bucket.forEach((b, n) => (b.colour = parsed[n].colour));
      }
      if (bucket.some((b) => extractSize(b.item.row.raw_name) !== null)) continue;
      const safe = parsed.map((p) => p.tokens.filter((t) => t.safe));
      const longest = Math.max(...safe.map((s) => s.length));
      let i = 0;
      while (i < longest && new Set(safe.map((s) => s[i]?.key)).size === 1) i++;
      if (i === longest) continue;
      // Rows without a token at the chosen position keep their size (usually Standard).
      bucket.forEach((b, n) => {
        const tok = safe[n][i];
        if (tok) b.size = tok.dims ? `${tok.key} in` : numberUnit(tok.key);
      });
    }

    const variants: ProductDraft["variants"] = [];
    for (const { item, size, colour } of bases) {
      const { row } = item;
      const sku = `${handle}-${slug(size)}${colour ? `-${slug(colour)}` : ""}`;
      const v = variants.find((x) => x.sku === sku);
      if (!v) variants.push({ sku, size, colour, rawNames: [row.raw_name] });
      else if (!v.rawNames.includes(row.raw_name)) v.rawNames.push(row.raw_name);
    }

    drafts.push({
      handle,
      title,
      // All Unsorted products stay drafts until staff file them (spec section 3).
      status: hasPhoto && !unsorted ? "published" : "draft",
      categoryPaths: unsorted ? [["Unsorted"]] : folders.map(categoryPath),
      photoFile: hasPhoto ? lead.photo_file : null,
      credit:
        hasPhoto && lead.photo_source === "free licence (credit needed)"
          ? { author: lead.author, license: lead.license, source_url: lead.source_url }
          : null,
      representative: hasPhoto && best === "lookalike",
      variants,
      source: {
        sheetRows: items.map((i) => `${i.row.sheet}#${i.row.excel_row}`),
        rawNames: uniq(items.map((i) => i.row.raw_name)),
        notes: uniq(items.map((i) => i.row.notes)),
        photoSource: lead.photo_source,
        sourceUrl: lead.source_url,
        license: lead.license,
        author: lead.author,
      },
    });
  }
  return drafts;
}
