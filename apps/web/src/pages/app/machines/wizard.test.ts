import { describe, expect, it } from "vitest";
import { parseBatch } from "../check/CheckPage";
import { toRegisterData, validateStep, type WizardData } from "./RegisterWizard";

const base: WizardData = {
  step: 1, id_type: "serial", serial: "VCE0EC220E00012345", engine_serial: "", road_reg: "", make: "Volvo", model: "EC220E", model_id: "", variant: "",
  year: "2021", category: "excavator_tracked", hour_meter: "4 250", color: "", service_weight_kg: "22500", engine_power_kw: "128,5", fuel_type: "diesel",
  emission_stage: "stage_v", has_lifting_device: false, registration_type: "permanent", valid_until: "", origin_country: "", owner: "self",
  owner_org_number: "", owner_email: "", owner_name: "", financing: false, fin_holder: "", fin_type: "ownership_reservation", fin_ref: "", fin_end: "",
  label_code: "", nameplate_doc: "", photo_doc: "", ocr_fields: ["serial"],
};

describe("register wizard", () => {
  it("builds the register payload: identifiers, numbers, owner only when another org", () => {
    const d = toRegisterData({ ...base, road_reg: "ABC123", owner_org_number: "556701-1001", label_code: "mid-abcd" });
    expect(d.identifiers).toEqual([
      { type: "serial", value: "VCE0EC220E00012345", source: "nameplate_ocr" },
      { type: "road_reg", value: "ABC123", external_system: "transportstyrelsen" },
    ]);
    expect(d).toMatchObject({ year: 2021, hour_meter: 4250, engine_power_kw: 128.5, service_weight_kg: 22500, owner_org_number: null, label_code: "MID-ABCD",
      valid_until: null, origin_country: null });
    expect(toRegisterData({ ...base, owner: "other", owner_org_number: "556701-1001" }).owner_org_number).toBe("556701-1001");
  });

  it("validates each step", () => {
    expect(validateStep({ ...base, serial: "ab" }, 1, null)).toHaveProperty("serial");
    expect(validateStep(base, 1, { exists: true, reg_number: "ABC1234" })).toEqual({ serial: "wizard.err_duplicate" });
    expect(validateStep({ ...base, make: "", category: "" }, 2, null)).toMatchObject({ make: "common.required", category: "common.required" });
    expect(validateStep({ ...base, year: "1890" }, 2, null)).toHaveProperty("year");
    expect(validateStep({ ...base, registration_type: "temporary", origin_country: "Germany" }, 2, null)).toMatchObject({ valid_until: "common.required", origin_country: "wizard.err_country" });
    expect(validateStep({ ...base, owner: "other" }, 3, null)).toHaveProperty("owner_org_number");
    expect(validateStep({ ...base, financing: true, fin_holder: "x" }, 3, null)).toEqual({ fin_end: "actions.encumbrance.end_required" });
    expect(validateStep({ ...base, financing: true, fin_holder: "x", fin_type: "leasing" }, 3, null)).toEqual({});
  });
});

describe("check batch parsing", () => {
  it("reads one value per line, optional type prefix, skips headers, max 500", () => {
    expect(parseBatch("typ;värde\nreg;ABC-123X\n\nVCE0EC220E00012345\npin,\"XYZ\"")).toEqual([
      { type: "reg", value: "ABC-123X" }, { type: "any", value: "VCE0EC220E00012345" }, { type: "pin", value: "XYZ" },
    ]);
    expect(parseBatch(Array.from({ length: 600 }, (_, i) => `S${i}`).join("\n"))).toHaveLength(500);
  });
});
