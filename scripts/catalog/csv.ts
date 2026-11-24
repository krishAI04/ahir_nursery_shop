import { readFileSync } from "node:fs";

export type CatalogRow = {
  sheet: string;
  excel_row: string;
  raw_name: string;
  product: string;
  folder: string;
  photo_file: string;
  photo_source: string;
  source_url: string;
  image_url: string;
  license: string;
  author: string;
  notes: string;
};
export type GroupRow = { catalog_product: string; shop_product: string; colour: string };

/** Minimal RFC-4180 parser: quotes, doubled quotes, CRLF/LF, leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let sawQuote = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
      sawQuote = true;
    }
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      out.push(row);
      row = [];
      sawQuote = false;
    } else cell += c;
  }
  if (cell !== "" || row.length || sawQuote) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

export function toCsv(rows: string[][]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
}

function readObjects<T>(path: string): T[] {
  const [head, ...body] = parseCsv(readFileSync(path, "utf8"));
  return body
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])) as T);
}

export const readCatalog = (path: string) => readObjects<CatalogRow>(path);
export const readGroups = (path: string) => readObjects<GroupRow>(path);
export function readSizeLabels(path: string): Map<string, string> {
  return new Map(readObjects<{ raw: string; label: string }>(path).map((r) => [r.raw, r.label]));
}
