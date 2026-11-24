import { describe, expect, it } from "vitest";
import { classify, defaultSizeLabel, extractSize } from "./size";

describe("extractSize", () => {
  const cases: [string, string | null][] = [
    ["Aclifa Mix 7x8", "7x8"],
    ["Lotus 7X8", "7X8"],
    ["Lotus 7*8", "7*8"],
    ["Karanj 15X16", "15X16"],
    ['Aspidisra 12"', '12"'],
    ["Remalia 12''", "12''"],
    ["Fountain 12'", "12'"],
    ['Yucca 12 "', '12 "'],
    ["Yucca 12”", "12”"],
    ["Neem Shield 25kg", "25kg"],
    ["Varmicompost Khad 50 kg", "50 kg"],
    ["RE Sprayer 3 L", "3 L"],
    ["Sprayer 5 Ltr", "5 Ltr"],
    ["Sprayer 5ltr", "5ltr"],
    ["Bottle 100ml", "100ml"],
    ["Drain 4ft", "4ft"],
    ["Pot Small", "Small"],
    ["Pot Med.", "Med."],
    ["G S Luca Medium 17", "Medium"],
    ["SC Fiber Big", "Big"],
    ["Pot XL", "XL"],
    ["Pot XXL", "XXL"],
    ["Pot L", "L"],
    ["Poly Bags 25x25 (25kg)", "25x25"],
    ["Ap Austin Pot 2414", null],
    ["FOX GK-14", null],
    ["Mi Squareplanter111", null],
    ["MI SQPLANTNO20", null],
    ["SF-018", null],
    ["Ring Cutter 2pcs FPRC - 100", null],
    ["PM Flower Bed 200 Gsm 20.50*1*1 Blue", null],
    ["BM Flower Lotus (D8 - H7)", null],
    ["Rose", null],
  ];
  it.each(cases)("%s -> %s", (name, expected) => {
    expect(extractSize(name)).toBe(expected);
  });
});

describe("defaultSizeLabel", () => {
  const cases: [string | null, string][] = [
    ["7x8", "Bag 7×8 in"],
    ["7X8", "Bag 7×8 in"],
    ["7*8", "Bag 7×8 in"],
    ['12"', "12 in"],
    ["12''", "12 in"],
    ["12 '", "12 in"],
    ["12”", "12 in"],
    ["25kg", "25 kg"],
    ["2Kg", "2 kg"],
    ["5 Ltr", "5 L"],
    ["5ltr", "5 L"],
    ["2 L", "2 L"],
    ["100ml", "100 ml"],
    ["4ft", "4 ft"],
    ["Small", "Small"],
    ["Med.", "Medium"],
    ["Med", "Medium"],
    ["Medium", "Medium"],
    ["BIG", "Big"],
    ["L", "L"],
    ["XL", "XL"],
    ["XXL", "XXL"],
    [null, "Standard"],
  ];
  it.each(cases)("%s -> %s", (raw, label) => {
    expect(defaultSizeLabel(raw)).toBe(label);
  });
});

describe("classify", () => {
  const cases: [string, string][] = [
    ["naturetouch.co.in", "exact"],
    ["brand site", "exact"],
    ["free licence (credit needed)", "exact"],
    ["similar item, not exact", "lookalike"],
    ["other website (copyright - replace later)", "copied"],
    ["NO PHOTO - take in shop", "none"],
    ["skipped - code only, take in shop", "code"],
    ["skipped - not for sale", "excluded"],
  ];
  it.each(cases)("%s -> %s", (src, cls) => {
    expect(classify(src)).toBe(cls);
  });
  it("rejects unknown sources", () => {
    expect(() => classify("mystery")).toThrow();
  });
});
