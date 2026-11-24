// Laptop script: writes import/size-labels.csv and import/product-groups.csv from photos/catalog.csv.
// Run: npm run maps   (output is deterministic; hand-check product-groups.csv afterwards)
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDrafts, COLOUR, colourName, countMerges } from "./catalog/build";
import { readCatalog, readGroups, readSizeLabels, toCsv } from "./catalog/csv";
import { classify, defaultSizeLabel, extractSize } from "./catalog/size";

const root = path.join(import.meta.dirname, "..");
const catalogPath = process.argv[2] ?? path.join(root, "..", "photos", "catalog.csv");
const rows = readCatalog(catalogPath).filter((r) => classify(r.photo_source) !== "excluded");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// size-labels.csv: every distinct raw size -> default label
const raws = [...new Set(rows.map((r) => extractSize(r.raw_name)).filter((s): s is string => s !== null))].sort(cmp);
// Labels already in the file (hand-fixed) are kept; only new raw sizes get the default.
const labelsPath = path.join(root, "import", "size-labels.csv");
const existing = existsSync(labelsPath) ? readSizeLabels(labelsPath) : new Map<string, string>();
writeFileSync(labelsPath, toCsv([["raw", "label"], ...raws.map((r) => [r, existing.get(r) ?? defaultSizeLabel(r)])]));

// product-groups.csv: colour families (same product name apart from the colour word, same folder)
const families = new Map<string, Map<string, string>>(); // key -> catalog_product -> colour
for (const r of rows) {
  if (classify(r.photo_source) === "code") continue;
  const m = COLOUR.exec(r.product);
  if (!m) continue;
  const word = m[1];
  const colour = colourName(word);
  const shop = r.product.replace(COLOUR, "").replace(/\s+/g, " ").trim();
  const key = `${r.folder}\u0000${shop}`;
  const fam = families.get(key) ?? new Map<string, string>();
  fam.set(r.product, colour);
  families.set(key, fam);
}
// Hand-checked: these look like colour families but are different products (distinct stones).
const NOT_FAMILIES = new Set(["Stone Quartz"]);
const out: string[][] = [];
for (const [key, fam] of families) {
  if (new Set(fam.values()).size < 2) continue; // a lone colour word is not a family
  const shop = key.split("\u0000")[1];
  if (NOT_FAMILIES.has(shop)) continue;
  for (const [catalog, colour] of fam) out.push([catalog, shop, colour]);
}
out.sort((a, b) => cmp(a[1], b[1]) || cmp(a[2], b[2]) || cmp(a[0], b[0]));
writeFileSync(path.join(root, "import", "product-groups.csv"), toCsv([["catalog_product", "shop_product", "colour"], ...out]));
console.log(`size-labels: ${raws.length} raw sizes; product-groups: ${out.length} rows in ${new Set(out.map((o) => o[1])).size} groups`);
const drafts = buildDrafts(rows, readGroups(path.join(root, "import", "product-groups.csv")), readSizeLabels(labelsPath));
console.log(`${drafts.length} products, ${countMerges(drafts)} raw names folded into an existing variant (same SKU)`);
