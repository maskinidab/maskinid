import { describe, expect, it } from "vitest";
import {
  isLabelCode,
  isSoleTraderNumber,
  isValidOrgNumber,
  labelCodeFromScan,
  maskPersonalOrgNumber,
  maskSerial,
  normalizeIdentifier,
  normalizeOrgNumber,
} from "./identifiers.ts";

describe("identifiers", () => {
  it("normalises only case, whitespace and hyphens", () => {
    expect(normalizeIdentifier(" vce-ec220e 0O1i ")).toBe("VCEEC220E0O1I");
  });
  it("masks serials to the last three characters", () => {
    expect(maskSerial("VCEC220EV00123K7")).toBe("•••••••••••••3K7");
    expect(maskSerial("AB")).toBe("••");
  });
  it("validates Swedish org numbers", () => {
    expect(normalizeOrgNumber("5560360793")).toBe("556036-0793");
    expect(isValidOrgNumber("556036-0793")).toBe(true);
    expect(isValidOrgNumber("556036-0794")).toBe(false);
    expect(isValidOrgNumber("16556036-0793")).toBe(true);
  });
  it("recognises sole traders and masks their number", () => {
    expect(isSoleTraderNumber("780512-1234")).toBe(true);
    expect(isSoleTraderNumber("556036-0793")).toBe(false);
    expect(maskPersonalOrgNumber("780512-1234")).toBe("19XXXXXX-XXXX");
  });
  it("extracts label codes from QR URLs", () => {
    const code = "a".repeat(11) + "B".repeat(11);
    expect(isLabelCode(code)).toBe(true);
    expect(labelCodeFromScan(`https://maskinid.se/m/${code}`)).toBe(code);
    expect(labelCodeFromScan(`https://maskinid.se/m/${code}?x=1`)).toBe(code);
    expect(labelCodeFromScan("https://evil.example/other")).toBeNull();
  });
});
