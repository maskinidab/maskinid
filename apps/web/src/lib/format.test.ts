import { describe, expect, it } from "vitest";
import { formatDate, formatDateIso, formatDateTime, formatNumber, formatReg } from "./format";

describe("format", () => {
  it("Swedish dates follow the profile", () => {
    expect(formatDate("2026-09-26T12:05:00Z", "sv")).toBe("26 sep 2026");
    expect(formatDateIso("2026-09-26T23:30:00Z")).toBe("2026-09-27");
    expect(formatDateTime("2026-09-26T12:05:00Z", "sv")).toBe("26 sep 2026 kl. 14.05");
    expect(formatDateTime("2026-09-26T12:05:00Z", "en")).toBe("26 Sep 2026 14:05");
  });
  it("plain dates are not shifted by time zones", () => {
    expect(formatDate("2026-01-01", "sv")).toBe("1 jan 2026");
  });
  it("numbers and reg numbers", () => {
    expect(formatNumber(2450, "sv")).toMatch(/^2\s450$/);
    expect(formatReg("AB3CD4E")).toBe("AB3-CD4E");
  });
});
