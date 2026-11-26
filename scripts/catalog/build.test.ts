import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCatalog, readGroups, parseCsv, toCsv, type CatalogRow } from "./csv";
import { buildDrafts, sizeFamilies } from "./build";

const rows = readCatalog(path.join(import.meta.dirname, "fixtures", "catalog-mini.csv"));
const groups = [
  { catalog_product: "Blossom Black Pot", shop_product: "Blossom Pot", colour: "Black" },
  { catalog_product: "Blossom Terracotta Pot", shop_product: "Blossom Pot", colour: "Terracotta" },
];
const build = () => buildDrafts(rows, groups, new Map());
const by = (handle: string) => {
  const d = build().find((x) => x.handle === handle);
  if (!d) throw new Error(`no draft ${handle}`);
  return d;
};

describe("csv", () => {
  it("is BOM-safe and handles quotes", () => {
    expect(rows.length).toBe(44);
    expect(Object.keys(rows[0])[0]).toBe("sheet");
    expect(rows[3].raw_name).toBe('Blossom Black 12"');
  });
  it("round-trips quoting", () => {
    const text = toCsv([["a", 'b,"c"'], ["d", ""]]);
    expect(parseCsv(text)).toEqual([["a", 'b,"c"'], ["d", ""]]);
  });
  it("keeps a trailing quoted-empty cell", () => {
    expect(parseCsv('a,""')).toEqual([["a", ""]]);
    expect(parseCsv('a,""\n')).toEqual([["a", ""]]);
  });
  it("reads groups", () => {
    expect(readGroups(path.join(import.meta.dirname, "../../import/product-groups.csv")).length).toBeGreaterThan(0);
  });
});

describe("buildDrafts", () => {
  it("Lotus 3 sizes -> one product with three variants", () => {
    const d = by("lotus");
    expect(d.status).toBe("published");
    expect(d.variants.map((v) => v.size)).toEqual(["Bag 7×8 in", "Bag 9×11 in", "Bag 10×10 in"]);
    expect(d.variants.map((v) => v.sku)).toEqual(["lotus-bag-7x8-in", "lotus-bag-9x11-in", "lotus-bag-10x10-in"]);
    expect(d.categoryPaths).toEqual([["Plants", "Water Plants"]]);
    expect(d.photoFile).toBe("plants/water-plants/lotus.jpg");
    expect(d.representative).toBe(false);
    expect(d.credit).toBeNull();
  });
  it("Blossom black/terracotta via groups -> size x colour", () => {
    const d = by("blossom-pot");
    expect(d.title).toBe("Blossom Pot");
    expect(d.categoryPaths).toEqual([["Pots & Planters", "Blossom"]]);
    expect(d.variants.map((v) => [v.sku, v.size, v.colour])).toEqual([
      ["blossom-pot-12-in-black", "12 in", "Black"],
      ["blossom-pot-12-in-terracotta", "12 in", "Terracotta"],
    ]);
  });
  it("free licence carries credit", () => {
    expect(by("amla-plant").credit).toEqual({ author: "Jane Doe", license: "CC BY 2.0", source_url: "https://flickr.example/1" });
  });
  it("look-alike is published and representative", () => {
    const d = by("mango-plant");
    expect(d.status).toBe("published");
    expect(d.representative).toBe(true);
    expect(d.photoFile).toBe("plants/fruit-plants/mango.jpg");
  });
  it("copied photo is a draft with no photo", () => {
    const d = by("guava-plant");
    expect(d.status).toBe("draft");
    expect(d.photoFile).toBeNull();
  });
  it("no photo is a draft", () => {
    expect(by("fig-plant").status).toBe("draft");
  });
  it("code-only is a draft in Unsorted titled by its code", () => {
    const d = by("pg-a");
    expect(d.title).toBe("PG (A)");
    expect(d.status).toBe("draft");
    expect(d.categoryPaths).toEqual([["Unsorted"]]);
    expect(d.variants[0].size).toBe("Standard");
  });
  it("not-for-sale rows are absent", () => {
    expect(build().some((d) => d.title === "Old Stock")).toBe(false);
  });
  it("a product in both sheets is one product; best class wins", () => {
    const rose = by("rose");
    expect(rose.variants.map((v) => v.size)).toEqual(["4 in", "5 in"]);
    expect(rose.status).toBe("published");
    expect(rose.source.sheetRows).toEqual(["NC PLANT.xlsx#13", "NT P.xls#14"]);
  });
  it("handles are unique and stable", () => {
    const a = build();
    expect(a.map((d) => d.handle)).toEqual(expect.arrayContaining(["rose", "rose-2", "ganga-imli-pithecellobium", "lady-bug-sprinkler"]));
    expect(by("rose-2").title).toBe("Rose!");
    expect(new Set(a.map((d) => d.handle)).size).toBe(a.length);
    expect(JSON.stringify(build())).toBe(JSON.stringify(a));
  });
  it("size-labels override the default", () => {
    const d = buildDrafts(rows, groups, new Map([["7x8", "Small bag"]])).find((x) => x.handle === "lotus")!;
    expect(d.variants[0].size).toBe("Small bag");
  });
  it("sprayers category title-cases short brand slugs", () => {
    expect(by("lady-bug-sprinkler").categoryPaths).toEqual([["Sprayers & Watering", "AP"]]);
  });
  it("numbers that would collapse become sizes (pots: inches)", () => {
    const d = by("hd-siena-planter");
    expect(d.variants.map((v) => [v.size, v.sku])).toEqual([
      ["20 in", "hd-siena-planter-20-in"],
      ["25 in", "hd-siena-planter-25-in"],
      ["30 in", "hd-siena-planter-30-in"],
    ]);
  });
  it("a single row with a trailing number stays Standard", () => {
    expect(by("fox-vipu-planter").variants.map((v) => v.size)).toEqual(["Standard"]);
  });
  it("AxB outside plants has no Bag prefix", () => {
    expect(by("single-stair").variants[0].size).toBe("2×1 in");
    expect(by("lotus").variants[0].size).toBe("Bag 7×8 in");
  });
  it("mid-name numbers and colour words split variants", () => {
    expect(by("blossom-window-planter").variants.map((v) => [v.size, v.colour])).toEqual([
      ["30 in", "Colour"],
      ["45 in", "Terracotta"],
      ["50 in", "Colour"],
    ]);
  });
  it("hyphen-glued numbers split", () => {
    expect(by("fox-cup-planter").variants.map((v) => v.size)).toEqual(["10 in", "12 in"]);
  });
  it("number plus colour in parentheses", () => {
    expect(by("hd-bello-square-tray").variants.map((v) => [v.size, v.colour])).toEqual([
      ["20 in", "Black"],
      ["25 in", "White"],
    ]);
  });
  it("set counts stay merged", () => {
    const v = by("sc-bowl-set-white-mix").variants;
    expect(v.length).toBe(1);
    expect(v[0].rawNames.length).toBe(2);
  });
  it("D/H dimensions become sizes", () => {
    expect(by("sunrise-bm-flower-lilly-pot").variants.map((v) => v.size)).toEqual(["D10×H9 in", "D14×H12.5 in"]);
  });
  it("colour splits even when rows carry a size mark", () => {
    expect(by("blossom-hanging-basket").variants.map((v) => [v.size, v.colour])).toEqual([
      ["Small", "Colour"],
      ["Small", "Terracotta"],
    ]);
    expect(by("blossom-bonsai-oval-pot").variants.map((v) => v.colour)).toEqual(["Black", "Terracotta"]);
  });
  it("model codes are never sizes", () => {
    expect(by("fox-cubo-planter").variants.map((v) => v.size)).toEqual(["Standard"]);
    expect(by("falcon-pruning-saw").variants.map((v) => v.size)).toEqual(["Standard"]);
  });
  it("rows missing the number stay Standard while the rest split", () => {
    expect(by("hd-valencia-planter").variants.map((v) => v.size)).toEqual(["Standard", "14 in", "16 in"]);
  });
  it("a code-only row never merges with a same-titled product", () => {
    const roses = build().filter((d) => d.title === "Rose");
    expect(roses.length).toBe(2);
    expect(roses.map((d) => d.status).sort()).toEqual(["draft", "published"]);
  });
});

describe("sizeFamilies", () => {
  const row = (product: string, folder = "pots-planters/ceramic", raw = product): CatalogRow => ({
    sheet: "NT P.xls", excel_row: "1", raw_name: raw, product, folder, photo_file: `${folder}/x.jpg`,
    photo_source: "similar item, not exact", source_url: "", image_url: "", license: "", author: "", notes: "",
  });
  const fam = [
    row("SC Line Round L"), row("SC Line Round XL"),
    row("Sc Peacock", "decor-accessories/miniatures", "Sc Peacock (1)"), row("SC Peacock Big", "decor-accessories/miniatures"), row("SC Peacock Small", "decor-accessories/miniatures"),
    row("Vr Big Railing"), row("Vr Small Railing", "garden-tools/other"),
    row("Neem Oil 100 ml", "soil-fertilizer"),
    row("Blossom Black Pot Big"), row("Blossom Black Pot Small"),
  ];
  const colourGroups = [{ catalog_product: "Blossom Black Pot Big", shop_product: "Blossom Pot", colour: "Black" }];

  it("joins products whose names differ only by a size word, in the same folder", () => {
    expect(sizeFamilies(fam, colourGroups)).toEqual([
      { catalog_product: "SC Line Round L", shop_product: "SC Line Round", colour: "" },
      { catalog_product: "SC Line Round XL", shop_product: "SC Line Round", colour: "" },
      { catalog_product: "SC Peacock Big", shop_product: "Sc Peacock", colour: "" }, // the plain name is the title
      { catalog_product: "SC Peacock Small", shop_product: "Sc Peacock", colour: "" },
      { catalog_product: "Sc Peacock", shop_product: "Sc Peacock", colour: "" },
    ]);
  });

  it("becomes one product with a size each", () => {
    const groups = sizeFamilies(fam, colourGroups);
    const drafts = buildDrafts(fam, groups, new Map());
    const round = drafts.find((d) => d.handle === "sc-line-round")!;
    expect(round.variants.map((v) => v.size)).toEqual(["L", "XL"]);
    expect(drafts.find((d) => d.handle === "sc-peacock")!.variants.map((v) => v.size)).toEqual(["Standard", "Big", "Small"]);
    expect(drafts.some((d) => d.handle === "sc-line-round-l")).toBe(false);
  });
});
