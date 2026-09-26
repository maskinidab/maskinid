import { describe, expect, it } from "vitest";
import { totp, totpVerify } from "./totp";

describe("totp", () => {
  // RFC 6238 test vector (SHA-1): secret "12345678901234567890" at T=59 s ⇒ 94287082 (8 digits) ⇒ 287082 (6 digits)
  it("matches the RFC 6238 vector", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(await totp(secret, 59_000)).toBe("287082");
    expect(await totpVerify(secret, "287082", 59_000)).toBe(true);
    expect(await totpVerify(secret, "000000", 59_000)).toBe(false);
  });
});
