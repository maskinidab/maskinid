import { describe, expect, it } from "vitest";
import { parseDsn, scrubText } from "./scrub.ts";

describe("error-report scrubbing", () => {
  it("removes identifiers, personal numbers, e-mail and tokens", () => {
    const s = scrubText("NOT_FOUND for CAT0950GC78397 by anna@berg.se pnr 19800101-1234 org 556677-8899 Bearer eyJhbGciOi.x.y key mk_live_0123abcd");
    expect(s).not.toMatch(/CAT0950|anna@|19800101|556677|eyJ|mk_live_0123/);
    expect(s).toContain("NOT_FOUND");
  });
  it("parses a DSN", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/42")).toEqual({ url: "https://o1.ingest.sentry.io/api/42/envelope/",
      auth: "Sentry sentry_version=7, sentry_key=abc123, sentry_client=maskinid/1.0" });
    expect(parseDsn("nonsense")).toBeNull();
  });
});
