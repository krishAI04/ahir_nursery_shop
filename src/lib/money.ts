export class MoneyError extends Error {
  override name = "MoneyError";
}

const BAD_PRICE = "Enter a price like 150 or 150.50";

/** "₹1,250.50" -> 125050 (paise). Throws MoneyError for anything not a positive price. */
export function parseRupees(input: string): number {
  const text = input.trim().replace(/^₹\s*/, "");
  const match = /^(\d+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new MoneyError(BAD_PRICE);
  const paise = Number(match[1].replace(/,/g, "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new MoneyError(BAD_PRICE);
  return paise;
}

/** 10000000 -> "₹1,00,000" (Indian grouping). */
export function formatRupees(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new MoneyError("Invalid amount");
  const rupees = String(Math.floor(paise / 100));
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ",");
  const grouped = rupees.length > 3 ? `${rest},${rupees.slice(-3)}` : rupees;
  const rem = paise % 100;
  return `₹${grouped}${rem ? "." + String(rem).padStart(2, "0") : ""}`;
}
