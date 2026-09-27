import { describe, expect, it } from "vitest";
import vectors from "./testdata/regnr-vectors.json" with { type: "json" };
import {
  REG_ALPHABET,
  formatRegNumber,
  generateRegNumber,
  hasMixedGroups,
  normalizeRegNumber,
  regCheckChar,
  validateRegNumber,
} from "./regnr.ts";

describe("regnr", () => {
  it("alphabet has 32 characters without 0/O/1/I", () => {
    expect(REG_ALPHABET).toHaveLength(32);
    expect(new Set(REG_ALPHABET).size).toBe(32);
    for (const c of "0O1I") expect(REG_ALPHABET).not.toContain(c);
  });

  it("matches shared check-character vectors (also used by the SQL test)", () => {
    for (const [payload, check] of Object.entries(vectors as Record<string, string>)) {
      expect(regCheckChar(payload)).toBe(check);
    }
  });

  it("generates valid, mixed numbers", () => {
    for (let i = 0; i < 2000; i++) {
      const r = generateRegNumber();
      expect(r).toMatch(/^[2-9A-HJ-NP-Z]{7}$/);
      expect(validateRegNumber(r).ok).toBe(true);
      expect(hasMixedGroups(r)).toBe(true);
    }
  });

  it("detects every single-character substitution", () => {
    const reg = generateRegNumber();
    for (let pos = 0; pos < 7; pos++) {
      for (const c of REG_ALPHABET) {
        if (c === reg[pos]) continue;
        const bad = reg.slice(0, pos) + c + reg.slice(pos + 1);
        expect(validateRegNumber(bad).ok).toBe(false);
      }
    }
  });

  it("detects adjacent transpositions in almost all cases", () => {
    let detected = 0;
    let total = 0;
    for (let i = 0; i < 500; i++) {
      const reg = generateRegNumber();
      for (let pos = 0; pos < 6; pos++) {
        if (reg[pos] === reg[pos + 1]) continue;
        total++;
        const swapped = reg.slice(0, pos) + reg[pos + 1] + reg[pos] + reg.slice(pos + 2);
        if (!validateRegNumber(swapped).ok) detected++;
      }
    }
    expect(detected / total).toBeGreaterThan(0.95);
  });

  it("accepts hyphens, spaces and lower case; rejects wrong length and characters", () => {
    const reg = generateRegNumber();
    const pretty = formatRegNumber(reg);
    expect(pretty).toMatch(/^.{3}-.{4}$/);
    expect(validateRegNumber(` ${pretty.toLowerCase()} `)).toEqual({ ok: true, value: reg });
    expect(normalizeRegNumber("ab c-d")).toBe("ABCD");
    expect(validateRegNumber("ABC")).toEqual({ ok: false, reason: "length" });
    expect(validateRegNumber("ABCDEF0")).toEqual({ ok: false, reason: "characters" });
  });
});
