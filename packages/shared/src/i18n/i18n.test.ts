import { describe, expect, it } from "vitest";
import { FORBIDDEN_PRODUCT_NAMES } from "../config.ts";
import { en, flatten, sv, translator } from "./index.ts";

const fsv = flatten(sv as Record<string, unknown>);
const fen = flatten(en as Record<string, unknown>);
const vars = (s: string) => [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();

describe("i18n resources", () => {
  it("sv and en have exactly the same keys", () => {
    expect(Object.keys(fen).sort()).toEqual(Object.keys(fsv).sort());
  });
  it("interpolation variables match between languages", () => {
    for (const k of Object.keys(fsv)) expect(vars(fen[k]!), k).toEqual(vars(fsv[k]!));
  });
  it("no forbidden product names (CLAUDE.md rule 9)", () => {
    for (const [k, v] of [...Object.entries(fsv), ...Object.entries(fen)]) {
      for (const bad of FORBIDDEN_PRODUCT_NAMES) expect(v.toLowerCase(), k).not.toContain(bad);
    }
  });
  it("Swedish copy follows the profile's tone: no exclamation marks", () => {
    for (const [k, v] of Object.entries(fsv)) expect(v, k).not.toContain("!");
  });
  it("no empty English strings where Swedish has text", () => {
    for (const k of Object.keys(fsv)) if (fsv[k]) expect(fen[k], k).not.toBe("");
  });
  it("translator interpolates nested variables", () => {
    const t = translator("sv");
    expect(t("errors.ACTIVE_ENCUMBRANCE_EXISTS", { holder: "Demo Bank" })).toContain("Demo Bank");
    expect(t("notifications.machine.stolen_scanned.body", { reg_number: "ABC-1234", at: "12:00", location: { city: "Uppsala" } })).toContain("Uppsala");
  });
});
