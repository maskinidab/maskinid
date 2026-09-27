import { describe, expect, it } from "vitest";
import { APP_NAME, FORBIDDEN_PRODUCT_NAMES, resolveFlags } from "./config.ts";

describe("config", () => {
  it("APP_NAME is not a forbidden name", () => {
    for (const bad of FORBIDDEN_PRODUCT_NAMES) expect(APP_NAME.toLowerCase()).not.toContain(bad);
  });
  it("resolves flags from env", () => {
    const f = resolveFlags({ VITE_DEMO_MODE: "false", FEATURE_MARKET: "0", FEATURE_SMS: "1" });
    expect(f.DEMO_MODE).toBe(false);
    expect(f.FEATURE_MARKET).toBe(false);
    expect(f.FEATURE_SMS).toBe(true);
    expect(f.FEATURE_PAYMENTS).toBe(false);
  });
});
