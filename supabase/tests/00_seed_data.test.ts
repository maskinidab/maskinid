import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isValidOrgNumber } from "../../packages/shared/src/identifiers.ts";

describe("demo seed", () => {
  it("uses valid, unique organisation numbers so demo lookups work in the UI", () => {
    const sql = readFileSync(new URL("../seed/00_orgs.sql", import.meta.url), "utf8");
    const numbers = [...sql.matchAll(/seed\.company\('(\d{6}-\d{4})'/g)].map((m) => m[1]!);
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.filter((n) => !isValidOrgNumber(n))).toEqual([]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
