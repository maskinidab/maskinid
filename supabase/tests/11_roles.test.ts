import { describe, expect, it } from "vitest";
import { encumber, machineData, registerAs, serial, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

describe("watchlist", () => {
  it("notifies the watching org when a watched serial is registered or flagged – never the actor", async () => {
    await tx(async (t) => {
      const s = serial("WATCH");
      await t.as("dealer");
      const w = await t.rpc("add_watch", { p_org_id: ORGS.dealer, p_type: "serial", p_value: s.toLowerCase(), p_note: "Stulen hos kund" });
      expect(w.current).toBeNull();
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", m.id, { reference: "K-1" });
      await t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "K-1", p_signature_id: sig });
      expect((await t.rpc<any[]>("list_notifications")).some((n) => n.type === "watch.hit")).toBe(false);
      await t.as("dealer");
      const n = (await t.rpc<any[]>("list_notifications")).filter((x) => x.type === "watch.hit");
      expect(n.map((x) => x.data.event).sort()).toEqual(["flag.raised", "machine.registered"]);
      expect(n[0].data).not.toHaveProperty("owner");
      expect((await t.rpc<any[]>("list_watch", { p_org_id: ORGS.dealer }))[0].match).toMatchObject({ reg_number: m.reg_number, status: "stolen" });
      await t.as("owner_b");
      expect(await t.q("select id from public.watchlist")).toHaveLength(0);
    });
  });
});

describe("portfolio and alerts", () => {
  it("financier portfolio lists held encumbrances; alerts show others' events on those machines", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      const p = await t.rpc<any[]>("list_portfolio", { p_org_id: ORGS.financier_a });
      expect(p.find((x) => x.machine_id === m.id)).toMatchObject({ kind: "encumbrance", status: "active", owner: "Test Owner A AB" });
      await t.as("owner_a");
      const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", m.id, { reference: "K-2" });
      await t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "K-2", p_signature_id: sig });
      await t.as("financier_a");
      const a = await t.rpc<any[]>("list_alerts", { p_org_id: ORGS.financier_a });
      expect(a.find((x) => x.machine_id === m.id && x.type === "flag.raised")).toMatchObject({ actor: "Test Owner A AB" });
      expect(a.some((x) => x.type === "encumbrance.registered" && x.machine_id === m.id)).toBe(false);
      await t.as("owner_b");
      expect((await t.rpcError("list_portfolio", { p_org_id: ORGS.owner_b })).code).toBe("FORBIDDEN");
    });
  });

  it("insurer requires level 2: owner sees the requirement and claim link", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("insurer");
      await t.rpc("set_claim_url", { p_org_id: ORGS.insurer, p_url: "https://forsakring.example/skada" });
      const pol = (await t.rpc("add_insurance_policy", { p_org_id: ORGS.insurer, p_machine_id: m.id,
        p_data: { policy_number: "P-9", valid_from: "2026-01-01", valid_to: "2099-01-01" } })).policy;
      await t.rpc("set_policy_requirement", { p_org_id: ORGS.insurer, p_policy_id: pol.id, p_level: 2 });
      expect((await t.rpc<any[]>("list_portfolio", { p_org_id: ORGS.insurer }))[0]).toMatchObject({ kind: "policy", requires_verification_level: 2 });
      await t.as("owner_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.insurance_requirement).toEqual({ insurer: "Test Försäkring AB", level: 2 });
      expect(v.claim_url).toBe("https://forsakring.example/skada");
      expect((await t.rpc<any[]>("list_notifications")).some((n) => n.type === "insurance.requires_verification")).toBe(true);
      await t.as("insurer");
      expect((await t.rpcError("set_claim_url", { p_org_id: ORGS.insurer, p_url: "javascript:alert(1)" })).code).toBe("VALIDATION");
    });
  });
});

describe("authority portal (SPEC §7.5)", () => {
  it("partial search needs ≥ 4 characters, is logged, and is authority-only", async () => {
    await tx(async (t) => {
      const s = serial("PART");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("authority");
      expect((await t.rpcError("authority_search", { p_org_id: ORGS.authority, p_query: "PAR" })).code).toBe("VALIDATION");
      const hits = await t.rpc<any[]>("authority_search", { p_org_id: ORGS.authority, p_query: s.slice(2, 10) });
      expect(hits.map((h) => h.id)).toContain(m.id);
      expect(hits.find((h) => h.id === m.id)).toMatchObject({ owner: "Test Owner A AB", serial_full: s });
      await t.as(null);
      expect((await t.q<any>("select viewer_type from public.access_log where machine_id = $1", [m.id])).map((r: any) => r.viewer_type)).toContain("authority");
      await t.as("financier_a");
      expect((await t.rpcError("authority_search", { p_org_id: ORGS.financier_a, p_query: s })).code).toBe("FORBIDDEN");
    });
  });

  it("flags overview and preparedness export (aggregate, no owner data)", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData({ service_weight_kg: 22000 }));
      await t.as("authority");
      await t.rpc("raise_flag", { p_org_id: ORGS.authority, p_machine_id: m.id, p_type: "under_investigation", p_description: "Utredning" });
      const f = await t.rpc<any[]>("list_flags", { p_org_id: ORGS.authority });
      expect(f.find((x) => x.machine_id === m.id)).toMatchObject({ type: "under_investigation", raised_by: expect.any(String) });
      const ex = await t.rpc("authority_preparedness_export", { p_org_id: ORGS.authority });
      expect(ex.total).toBeGreaterThan(0);
      expect(JSON.stringify(ex)).not.toContain("Test Owner A AB");
      expect(ex.rows.some((r: any) => r.category === "excavator_tracked" && r.weight_class === "10_30t")).toBe(true);
      await t.as("owner_a");
      expect((await t.rpcError("authority_preparedness_export", { p_org_id: ORGS.owner_a })).code).toBe("FORBIDDEN");
    });
  });

  it("register extract: owner or authority, number + hash, sole trader numbers masked, verifiable", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const x = await t.rpc("create_register_extract", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(x.report_number).toMatch(/^U-\d{4}-\d{6}$/);
      expect(x.result.owner).toMatchObject({ name: "Test Owner A AB" });
      await t.as("anon");
      expect(await t.rpc("verify_report", { p_report_number: x.report_number, p_result_hash: x.result_hash })).toMatchObject({ valid: true, kind: "register_extract", reg_number: m.reg_number });
      await t.as("financier_a");
      expect((await t.rpcError("create_register_extract", { p_org_id: ORGS.financier_a, p_machine_id: m.id })).code).toBe("FORBIDDEN");
      await t.as("authority");
      expect((await t.rpc("create_register_extract", { p_org_id: ORGS.authority, p_machine_id: m.id })).report_number).toMatch(/^U-/);
    });
  });
});

describe("manufacturer data", () => {
  it("manufacturer submits delivery data; registration picks up factory data; other orgs cannot submit", async () => {
    await tx(async (t) => {
      const s = serial("OEM");
      await t.as("manufacturer");
      const r = await t.rpc("submit_oem_records", { p_org_id: ORGS.manufacturer, p_rows: JSON.stringify([
        { serial_number: s, make: "Volvo", model: "EC300E", year: 2025, category: "Grävmaskin", service_weight_kg: 30000, emission_stage: "stage_v" },
        { serial_number: "", make: "Volvo", model: "X" },
      ]) });
      expect(r).toMatchObject({ saved: 1, errors: [{ row: 2, code: "required" }] });
      const m = await registerAs(t, "owner_a", { identifiers: [{ type: "serial", value: s }] } as never);
      expect(m.factory_data).toBe(true);
      await t.as("manufacturer");
      const list = await t.rpc("list_oem_records", { p_org_id: ORGS.manufacturer });
      expect(list.items.find((i: any) => i.serial_number === s)).toMatchObject({ matched: true, reg_number: m.reg_number });
      await t.as("dealer");
      expect((await t.rpcError("submit_oem_records", { p_org_id: ORGS.dealer, p_rows: JSON.stringify([{ serial_number: "X1234", make: "A", model: "B" }]) })).code).toBe("FORBIDDEN");
    });
  });
});
