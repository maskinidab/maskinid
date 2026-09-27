import { describe, expect, it } from "vitest";
import { matchRoute, openApiDocument, ROUTES, SCOPES, statusForCode } from "./routes";

describe("API route table", () => {
  it("matches paths with parameters and methods", () => {
    expect(matchRoute("GET", "/machines/lookup")?.route.rpc).toBe("lookup_machine");
    expect(matchRoute("GET", "/machines/abc")).toMatchObject({ route: { rpc: "get_machine" }, params: { id: "abc" } });
    expect(matchRoute("POST", "/encumbrances/e1/release")).toMatchObject({ route: { rpc: "release_encumbrance" }, params: { id: "e1" } });
    expect(matchRoute("DELETE", "/machines/abc")).toBeNull();
  });
  it("every route uses a known scope and has a unique method+path", () => {
    expect(ROUTES.every((r) => SCOPES.includes(r.scope))).toBe(true);
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("maps error codes to HTTP statuses (conflict ⇒ 409)", () => {
    expect(statusForCode("ACTIVE_ENCUMBRANCE_EXISTS")).toBe(409);
    expect(statusForCode("FORBIDDEN")).toBe(403);
    expect(statusForCode("VALIDATION")).toBe(422);
  });
  it("builds an OpenAPI 3.1 document covering every route", () => {
    const doc = openApiDocument("https://api.example/v1");
    expect(doc.openapi).toBe("3.1.0");
    const ops = Object.values(doc.paths).flatMap((p) => Object.keys(p));
    expect(ops).toHaveLength(ROUTES.length);
  });
});
