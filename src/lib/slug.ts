/** "Bag 12×12 in" -> "bag-12x12-in". Shared by product handles and SKUs. */
export function slug(text: string): string {
  const s = text
    .replace(/×/g, "x")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "item";
}
