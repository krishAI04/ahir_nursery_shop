// Usage: npm run import -- [--remote] [--dry-run] [--yes]
// Default is local only (wrangler --local). --remote touches the real Cloudflare account and needs --yes (or --dry-run).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { buildDrafts } from "./catalog/build";
import { readCatalog, readGroups, readSizeLabels } from "./catalog/csv";
import { parseArgs, UsageError } from "./import-args";
import { photoKeyFor, toSql } from "./catalog/sql";

let pendingError = "";
const { remote, dryRun } = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      process.exit(2);
    }
    // Counts are printed first so the person confirming sees what would be written.
    pendingError = (e as Error).message;
    return { remote: true, dryRun: false };
  }
})();
const root = path.resolve(import.meta.dirname, "..");
const catalogDir = path.resolve(root, process.env.CATALOG_DIR ?? "../photos");
const outDir = path.join(root, "import", "out");
const target = remote ? "remote" : "local";

const drafts = buildDrafts(
  readCatalog(path.join(catalogDir, "catalog.csv")),
  readGroups(path.join(root, "import", "product-groups.csv")),
  readSizeLabels(path.join(root, "import", "size-labels.csv")),
);

// Only keep an image when the photo file is really on disk; otherwise warn and skip it.
const missing: string[] = [];
const photoPath = new Map<string, string>(); // r2 key -> file on disk
const photoKey = (d: (typeof drafts)[number]) => {
  const key = photoKeyFor(d);
  if (!key) return null;
  const file = path.join(catalogDir, d.photoFile!);
  if (!existsSync(file)) {
    missing.push(d.photoFile!);
    return null;
  }
  photoPath.set(key, file);
  return key;
};
const batches = toSql(drafts, photoKey);

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^batch-\d+\.sql$/.test(f)) rmSync(path.join(outDir, f));
const files = batches.map((b, i) => {
  const f = path.join(outDir, `batch-${String(i + 1).padStart(3, "0")}.sql`);
  writeFileSync(f, b + "\n");
  return f;
});

const variants = drafts.reduce((n, d) => n + d.variants.length, 0);
// Matches toSql: a published product whose photo file is missing is written as a draft.
const published = drafts.filter((d) => d.status === "published" && photoPath.has(photoKeyFor(d) ?? "")).length;
console.log(`target: ${target}${dryRun ? " (dry run)" : ""}`);
console.log(`products ${drafts.length} (published ${published}, draft ${drafts.length - published}), variants ${variants}, photos ${photoPath.size}`);
console.log(`wrote ${files.length} SQL batches to ${path.relative(root, outDir)}`);
for (const m of missing) console.warn(`warning: photo file missing, image skipped: ${m}`);
if (dryRun) process.exit(0);
if (pendingError) {
  console.error(`
would write to the REAL Cloudflare account: D1 "nature-care", R2 bucket "nature-care-photos", ${files.length} batches, ${photoPath.size} photos`);
  console.error(pendingError);
  process.exit(2);
}

const wranglerJs = path.join(path.dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin", "wrangler.js");
const wrangler = (args: string[]) => {
  // No shell: file names are passed as plain arguments.
  const r = spawnSync(process.execPath, [wranglerJs, ...args, remote ? "--remote" : "--local"], { cwd: root, stdio: "inherit" });
  return r.status === 0;
};

for (const f of files) {
  if (!wrangler(["d1", "execute", "nature-care", "--file", f])) {
    console.error(`D1 failed on ${path.basename(f)}; stopping (safe to re-run).`);
    process.exit(1);
  }
}

const trackFile = path.join(outDir, "uploaded.txt");
const done = new Set(existsSync(trackFile) ? readFileSync(trackFile, "utf8").split("\n").filter(Boolean) : []);
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
let uploaded = 0;
let failed = 0;
for (const [key, file] of photoPath) {
  const mark = `${target}:${key}`;
  if (done.has(mark)) continue;
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  if (wrangler(["r2", "object", "put", `nature-care-photos/${key}`, "--file", file, "--content-type", type])) {
    appendFileSync(trackFile, mark + "\n");
    uploaded++;
  } else {
    failed++;
    console.warn(`warning: upload failed: ${key}`);
  }
}
console.log(`photos uploaded ${uploaded}, already done ${photoPath.size - uploaded - failed}, failed ${failed}`);
if (failed) process.exit(1);
