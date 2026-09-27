import { describe, expect, it } from "vitest";
import { FORBIDDEN_PRODUCT_NAMES } from "../config.ts";
import { HELP_ARTICLES } from "./articles.ts";

describe("help articles", () => {
  it("exist in both languages with unique slugs and follow the tone rules", () => {
    expect(new Set(HELP_ARTICLES.map((a) => a.slug)).size).toBe(HELP_ARTICLES.length);
    for (const a of HELP_ARTICLES) {
      for (const l of [a.sv, a.en]) {
        expect(l.title.length, a.slug).toBeGreaterThan(3);
        expect(l.body.length, a.slug).toBeGreaterThan(100);
        const all = `${l.title} ${l.summary} ${l.body}`.toLowerCase();
        for (const bad of FORBIDDEN_PRODUCT_NAMES) expect(all, a.slug).not.toContain(bad);
      }
      expect(a.sv.body, a.slug).not.toContain("!");
    }
  });
});
