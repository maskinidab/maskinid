import { describe, expect, it } from "vitest";
import { isBlockedRecipient } from "./recipients.ts";

describe("e-mail recipients that must never be mailed (ADR 0036)", () => {
  it("blocks the made-up addresses of the demo seed and the tests, subdomains included", () => {
    for (const e of ["berg@demo.se", "platschef@berg.demo.se", "saljare@nordmaskin.demo.se", "pilot-1@e2e.se",
      "newcomer@acme-test.se", "a@example.com", "x@shop.example", "y@host.invalid", "z@site.test", "BERG@DEMO.SE"]) {
      expect(isBlockedRecipient(e), e).toBe(true);
    }
  });

  it("lets real addresses through, including ones that only look similar", () => {
    for (const e of ["maskinidab@gmail.com", "rikard@maskinid.se", "someone@demosweden.se", "a@notdemo.se"]) {
      expect(isBlockedRecipient(e), e).toBe(false);
    }
  });

  it("treats anything that is not an address as blocked, and takes extra domains", () => {
    expect(isBlockedRecipient("no-at-sign")).toBe(true);
    expect(isBlockedRecipient("@demo.se")).toBe(true);
    expect(isBlockedRecipient("kund@testbolag.se", ["testbolag.se"])).toBe(true);
  });
});
