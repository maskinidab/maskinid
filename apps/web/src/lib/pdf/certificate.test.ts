import { translator } from "@maskinid/shared/i18n/index.ts";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { certificatePdf, machineReportPdf } from "./certificate";

const meta = { report_number: "B-2026-000042", result_hash: "a".repeat(64) };
const machine = { reg_number: "C9XK4F", make: "Caterpillar", model: "950 GC", variant: null, year: 2018, category: "wheel_loader", status: "active",
  verification_level: 2, technical: { service_weight_kg: 18800, engine_power_kw: 168 } };

describe("formal PDFs render in both languages (WinAnsi-safe)", () => {
  for (const locale of ["sv", "en"] as const) {
    const t = translator(locale) as unknown as TFunction;
    it(`certificate ${locale}`, async () => {
      const bytes = await certificatePdf({
        generated_at: "2026-09-26T10:00:00Z", org_name: "Bergs Schakt & Entreprenad AB", machine,
        identifiers: [{ type: "serial", value: "CAT0950GC78397", verified: true }],
        owner: { name: "Bergs Schakt & Entreprenad AB", org_number: "556701-2009", city: "Västerås" }, owner_since: "2024-03-01", owner_ordinal: 2,
        label_code: "30FvK4Isszkn41GIssvOTO", financing: { has_active: true, type: "ownership_reservation", holder: "Demo Bank Finans AB" }, first_sale_dealer: "Nordmaskin AB",
      }, meta, t);
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    });
    it(`machine report ${locale} with long history (multi-page)`, async () => {
      const bytes = await machineReportPdf({
        generated_at: "2026-09-26T10:00:00Z", org_name: "Bergs Schakt & Entreprenad AB",
        machine: { ...machine, hour_meter: 2656, owner_ordinal: 2, serial_masked: "•••••••••••397",
          financing: { has_active: false, holder: null, type: null }, flags: [],
          history: Array.from({ length: 60 }, (_, i) => ({ type: i % 2 ? "machine.registered" : "ownership.transferred", created_at: "2026-01-01T00:00:00Z", actor_org: "Nordmaskin AB" })),
          documents: [{ type: "invoice", filename: "faktura-åäö.pdf", created_at: "2026-01-01T00:00:00Z" }],
          maintenance: [{ performed_at: "2026-05-01", type: "service", hours: 2500, performed_by_text: "Verkstad Öst" }],
          inspections: [{ performed_at: "2026-04-01", type: "annual", result: "approved", valid_until: "2027-04-01", inspection_body_name: "Kontroll AB" }] },
      }, { ...meta, report_number: "R-2026-000001" }, t);
      expect(bytes.byteLength).toBeGreaterThan(2000);
    });
  }
});

describe("climate report PDF", () => {
  it("renders with factors and machines", async () => {
    const { climatePdf } = await import("./climate");
    const t = translator("sv") as unknown as TFunction;
    const bytes = await climatePdf({ from: "2026-01-01", to: "2026-09-26", org_name: "Bergs", generated_at: "2026-09-26T10:00:00Z",
      factors: { diesel: 2.95, hvo100: 0.52, electricity: 0.04 }, totals: { co2e_kg: 12345, entries: 3, fossil_free_share: 75 },
      by_fuel: [{ fuel: "hvo100", unit: "l", quantity: 300, co2e_kg: 156 }],
      by_machine: [{ reg_number: "C9XK4F", make: "Volvo", model: "EC220E", category: "excavator_tracked", emission_stage: "stage_v", quantity_l: 400, kwh: null, co2e_kg: 451, hours: 20 }],
      by_project: [{ project: "E18", co2e_kg: 451 }] }, { report_number: "C-2026-000001", result_hash: "b".repeat(64) }, t);
    expect(bytes.byteLength).toBeGreaterThan(1500);
  });
});
