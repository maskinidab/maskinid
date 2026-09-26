import { describe, expect, it } from "vitest";
import { detectIdentifierKind, identifierKey, normalizeIdentifier, validateLookupQuery } from "./identifier";

describe("identifierare", () => {
  it("normaliserar till versaler utan mellanslag", () => {
    expect(normalizeIdentifier(" 7kx0 l2t4 003198 ")).toBe("7KX0L2T4003198");
    expect(identifierKey("mid-2026-0048812")).toBe("MID20260048812");
  });
  it("känner igen registernummer och PIN", () => {
    expect(detectIdentifierKind("MID-2026-0048812")).toBe("registernummer");
    expect(detectIdentifierKind("7KX0L2T4003198")).toBe("pin");
    expect(detectIdentifierKind("LX-4003")).toBe("serienummer");
  });
  it("validerar sökningen", () => {
    expect(validateLookupQuery("")).toMatch(/Skriv/);
    expect(validateLookupQuery("12")).toMatch(/för kort/);
    expect(validateLookupQuery("ABC$123")).toMatch(/bara innehålla/);
    expect(validateLookupQuery("7KX0L2T4003198")).toBeNull();
  });
});
