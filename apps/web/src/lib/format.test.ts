import { describe, expect, it } from "vitest";
import { formatDate, formatDateIso, formatDateTime, formatSek, formatTime } from "./format";

const NBSP = " ";

describe("format enligt profilens tonalitet", () => {
  it("datum i löptext: 26 sep 2026", () => {
    expect(formatDate("2026-09-26T12:05:00Z")).toBe(`26${NBSP}sep${NBSP}2026`);
  });
  it("datum i tabeller: 2026-09-26", () => {
    expect(formatDateIso("2026-09-26T12:05:00Z")).toBe("2026-09-26");
  });
  it("tid: kl. 14.05 (svensk tid)", () => {
    expect(formatTime("2026-09-26T12:05:00Z")).toBe(`kl.${NBSP}14.05`);
    expect(formatDateTime("2026-09-26T12:05:00Z")).toBe(`26${NBSP}sep${NBSP}2026 kl.${NBSP}14.05`);
  });
  it("belopp med hårt mellanslag: 1 250 000 kr", () => {
    expect(formatSek(1250000)).toBe(`1${NBSP}250${NBSP}000${NBSP}kr`);
    expect(formatSek(980)).toBe(`980${NBSP}kr`);
  });
});
