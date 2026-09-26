import { describe, expect, it } from "vitest";
import { registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

// Regressions found while building the step 10 frontend flows.
describe("frontend flows", () => {
  it("perform_check with type any matches a MaskinID registration number and identifiers", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const serial = (await t.q<{ value: string }>("select value from public.machine_identifiers where machine_id = $1 limit 1", [m.id]))[0]!.value;
      await t.as("financier_a");
      const byReg = await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { type: "any", value: m.reg_number } });
      expect(byReg.result).toMatchObject({ found: true, reg_number: m.reg_number });
      const formatted = `${m.reg_number.slice(0, 3)}-${m.reg_number.slice(3)}`.toLowerCase();
      expect((await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { type: "any", value: formatted } })).result.found).toBe(true);
      expect((await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { type: "any", value: serial } })).result.found).toBe(true);
    });
  });
});

describe("receipt verification", () => {
  it("confirms a genuine receipt only with the matching checksum, also anonymously", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("financier_a");
      const r = await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: m.reg_number } });
      await t.as("anon");
      const ok = await t.rpc("verify_check_receipt", { p_receipt_number: r.receipt_number.toLowerCase(), p_result_hash: r.result_hash.toUpperCase() });
      expect(ok).toMatchObject({ valid: true, receipt_number: r.receipt_number, performed_by: "Test Finans A AB", reg_number: m.reg_number, has_active_financing: false });
      expect(await t.rpc("verify_check_receipt", { p_receipt_number: r.receipt_number, p_result_hash: "0".repeat(64) })).toEqual({ valid: false });
    });
  });
});
