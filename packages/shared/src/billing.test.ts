import { describe, expect, it } from "vitest";
import { formatSek, lineDescription, vatOf } from "./billing.ts";
import { translator } from "./i18n/index.ts";

describe("billing helpers", () => {
  it("formats öre as kronor with decimals only when needed", () => {
    expect(formatSek(99000).replace(/\s/g, " ")).toBe("990 kr");
    expect(formatSek(490000).replace(/\s/g, " ")).toBe("4 900 kr");
    expect(formatSek(20)).toBe("0,20 kr");
    expect(formatSek(99000, "en")).toBe("SEK 990");
  });

  it("adds 25 % VAT separately with rounding", () => {
    expect(vatOf(99000, 0.25)).toEqual({ vat: 24750, total: 123750 });
    expect(vatOf(5, 0.25)).toEqual({ vat: 1, total: 6 });
  });

  it("describes invoice lines in both languages", () => {
    const sv = translator("sv");
    expect(lineDescription({ kind: "plan", item: "dealer", quantity: 1, unit_price_ore: 99000, amount_ore: 99000 }, sv)).toMatch(/Handlare/);
    const en = translator("en");
    expect(lineDescription({ kind: "usage", item: "check", quantity: 20, used: 520, included: 500, unit_price_ore: 1500, amount_ore: 30000 }, en))
      .toMatch(/520.*500/);
  });
});
