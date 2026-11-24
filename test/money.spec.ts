import { describe, expect, it } from "vitest";
import { formatRupees, MoneyError, parseRupees } from "../src/lib/money";

describe("parseRupees", () => {
  it.each([
    ["150", 15000],
    ["150.5", 15050],
    ["150.50", 15050],
    ["1,250", 125000],
    ["₹ 99", 9900],
    ["₹1,00,000", 10000000],
    ["1,000,000", 100000000],
    [" 150 ", 15000],
    ["0.29", 29],
    ["19.99", 1999],
    ["1,00,000.50", 10000050],
  ])("parses %s", (input, paise) => {
    expect(parseRupees(input)).toBe(paise);
  });

  it.each(["", "  ", "abc", "-5", "0", "0.00", "1.234", "12.", "1e3", "150,50", "15,0", "1 5 0", "1.2.3", "₹", ".5", "+5"])("rejects %j", (input) => {
    expect(() => parseRupees(input)).toThrow(MoneyError);
    expect(() => parseRupees(input)).toThrow("Enter a price like 150 or 150.50");
  });
});

describe("formatRupees", () => {
  it.each([
    [125000, "₹1,250"],
    [125050, "₹1,250.50"],
    [10000000, "₹1,00,000"],
    [9900, "₹99"],
    [50, "₹0.50"],
    [1000000000, "₹1,00,00,000"],
    [0, "₹0"],
    [1, "₹0.01"],
    [99, "₹0.99"],
  ])("formats %d", (paise, text) => {
    expect(formatRupees(paise)).toBe(text);
  });
});

describe("formatRupees input", () => {
  it.each([-150, 12.5, Number.NaN])("throws for %d", (paise) => {
    expect(() => formatRupees(paise)).toThrow(MoneyError);
  });
  it("names the error class", () => {
    expect(new MoneyError("x").name).toBe("MoneyError");
  });
});
