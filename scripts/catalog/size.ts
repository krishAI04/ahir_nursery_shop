export type PhotoClass = "exact" | "lookalike" | "copied" | "none" | "code" | "excluded";

const CLASSES: Record<string, PhotoClass> = {
  "naturetouch.co.in": "exact",
  "brand site": "exact",
  "free licence (credit needed)": "exact",
  "similar item, not exact": "lookalike",
  "other website (copyright - replace later)": "copied",
  "NO PHOTO - take in shop": "none",
  "skipped - code only, take in shop": "code",
  "skipped - not for sale": "excluded",
};

export function classify(photoSource: string): PhotoClass {
  const c = CLASSES[photoSource.trim()];
  if (!c) throw new Error(`Unknown photo_source: "${photoSource}"`);
  return c;
}

// A size must not be glued to a model code (word characters or a dot just before it).
const START = String.raw`(?<![\w.*])`;
const NUM = String.raw`\d+(?:\.\d+)?`;
const RULES: RegExp[] = [
  // bag 7x8, 7X8, 7*8 (not part of a longer a*b*c measurement)
  new RegExp(String.raw`${START}\d+\s*[xX*]\s*\d+(?![\d.]|\s*[xX*]\s*\d)`),
  // inch marks: " '' ' ” ″
  new RegExp(START + NUM + String.raw`\s*(?:"|''|'|”|″)`),
  // kg, Ltr, L, ml, ft
  new RegExp(START + NUM + String.raw`\s*(?:kg|ltr|ml|ft|l)(?![A-Za-z0-9])`, "i"),
  // size words
  /(?<![A-Za-z0-9])(?:Small|Medium|Med\.?|Big|XXL|XL)(?![A-Za-z0-9])/i,
  /(?<![A-Za-z0-9])L(?![A-Za-z0-9])/,
];

export function extractSize(rawName: string): string | null {
  for (const re of RULES) {
    const m = re.exec(rawName);
    if (m) return m[0].trim();
  }
  return null;
}

const WORDS: Record<string, string> = {
  small: "Small",
  med: "Medium",
  "med.": "Medium",
  medium: "Medium",
  big: "Big",
  l: "L",
  xl: "XL",
  xxl: "XXL",
};

export function defaultSizeLabel(raw: string | null): string {
  if (raw === null) return "Standard";
  const bag = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(raw);
  if (bag) return `Bag ${bag[1]}×${bag[2]} in`;
  const inch = /^(\d+(?:\.\d+)?)\s*["'”″]+$/.exec(raw);
  if (inch) return `${inch[1]} in`;
  const unit = /^(\d+(?:\.\d+)?)\s*(kg|ltr|ml|ft|l)$/i.exec(raw);
  if (unit) {
    const u = unit[2].toLowerCase();
    return `${unit[1]} ${u === "ltr" || u === "l" ? "L" : u}`;
  }
  return WORDS[raw.toLowerCase()] ?? raw;
}
