import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Same rule as packages/shared isValidOrgNumber (Luhn over the 10 digits), inlined to keep this project self-contained.
function isValidOrgNumber(n: string): boolean {
  const d = n.replace(/\D/g, "");
  if (d.length !== 10) return false;
  const sum = [...d].reduce((s, ch, i) => {
    const v = Number(ch) * (i % 2 === 0 ? 2 : 1);
    return s + (v > 9 ? v - 9 : v);
  }, 0);
  return sum % 10 === 0;
}

describe("demo seed", () => {
  it("uses valid, unique organisation numbers so demo lookups work in the UI", () => {
    const sql = readFileSync(new URL("../seed/00_orgs.sql", import.meta.url), "utf8");
    const numbers = [...sql.matchAll(/seed\.company\('(\d{6}-\d{4})'/g)].map((m) => m[1]!);
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.filter((n) => !isValidOrgNumber(n))).toEqual([]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
