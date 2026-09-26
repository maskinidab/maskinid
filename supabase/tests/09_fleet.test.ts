import { describe, expect, it } from "vitest";
import { machineData, registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

const lifting = () => machineData({ has_lifting_device: true, service_weight_kg: 22000 });

describe("fleet (SPEC §7.1)", () => {
  it("hour meter only goes up unless marked as a correction; every reading is an event", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.rpc("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 1200 });
      expect((await t.rpcError("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 1100 })).detail).toMatchObject({ reason: "lower_than_current" });
      await t.rpc("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 1100, p_correction: true });
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.hour_meter).toBe(1100);
      const h = await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(h.filter((e) => e.type === "machine.hours_reported")).toHaveLength(2);
      await t.as("owner_b");
      expect((await t.rpcError("record_hours", { p_org_id: ORGS.owner_b, p_machine_id: m.id, p_hours: 2000 })).code).toBe("FORBIDDEN");
    });
  });

  it("service with next due creates one reminder that the next service replaces; hours-based reminders fire", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.rpc("add_maintenance", { p_org_id: ORGS.owner_a, p_machine_id: m.id,
        p_entry: { type: "service", performed_at: "2026-01-10", hours: 1000, performed_by_text: "Verkstan AB", next_due_hours: 1500 } });
      await t.rpc("add_maintenance", { p_org_id: ORGS.owner_a, p_machine_id: m.id,
        p_entry: { type: "service", performed_at: "2026-06-10", hours: 1490, next_due_hours: 2000, next_due_at: "2027-06-10" } });
      let r = await t.rpc<any[]>("list_reminders", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(r.map((x) => [x.type, x.due_hours])).toEqual([["service", 2000]]);
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).hour_meter).toBe(1490);
      const res = await t.rpc("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 1990 });
      expect(res.due).toHaveLength(1);
      await t.rpc("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 2001 });
      await t.as(null);
      expect(await t.val("select app.run_reminder_notifications()")).toBeGreaterThanOrEqual(1);
      await t.as("owner_a");
      const n = await t.rpc<any[]>("list_notifications");
      expect(n.some((x) => x.type === "reminder.due" && x.data.reg_number === m.reg_number)).toBe(true);
      r = await t.rpc<any[]>("list_reminders", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(r[0].overdue).toBe(true);
      await t.rpc("update_reminder", { p_org_id: ORGS.owner_a, p_reminder_id: r[0].id, p_action: "done" });
      expect(await t.rpc<any[]>("list_reminders", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).toEqual([]);
    });
  });

  it("inspection body records directly; owner needs the protocol; badge public only by choice; history follows the machine", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", lifting());
      await t.as("inspector");
      await t.rpc("record_inspection", { p_org_id: ORGS.inspector, p_machine_id: m.id,
        p_data: { type: "periodic", performed_at: "2026-09-01", result: "approved", valid_until: "2027-09-01", certificate_no: "B-123" } });
      await t.as("owner_a");
      expect((await t.rpcError("record_inspection", { p_org_id: ORGS.owner_a, p_machine_id: m.id,
        p_data: { performed_at: "2026-09-02", result: "approved", valid_until: "2027-09-02" } })).detail).toMatchObject({ reason: "protocol_required" });
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.inspection_valid_until).toBe("2027-09-01");
      expect((await t.rpc<any[]>("list_notifications")).some((x) => x.type === "inspection.recorded")).toBe(true);
      expect((await t.rpc<any[]>("list_reminders", { p_org_id: ORGS.owner_a })).some((x) => x.type === "inspection" && x.due_at === "2027-09-01")).toBe(true);
      await t.as("anon");
      expect((await t.rpc("public_machine_card", { p_reg: m.reg_number })).card.inspection_valid_until).toBeNull();
      await t.as("owner_a");
      await t.rpc("set_public_inspection_badge", { p_org_id: ORGS.owner_a, p_show: true });
      await t.as("anon");
      expect((await t.rpc("public_machine_card", { p_reg: m.reg_number })).card.inspection_valid_until).toBe("2027-09-01");
      await t.as("owner_b");
      expect((await t.rpcError("list_inspections", { p_org_id: ORGS.owner_b, p_machine_id: m.id })).code).toBe("NOT_FOUND");
      expect(await t.q("select id from public.inspections where machine_id = $1", [m.id])).toHaveLength(0);
    });
  });

  it("projects, assignment and the fleet report; share link and client grant are read-only projections", async () => {
    await tx(async (t) => {
      const a = await registerAs(t, "owner_a", machineData({ emission_stage: "stage_v", fuel_type: "hvo" }));
      const b = await registerAs(t, "owner_a", machineData({ emission_stage: "stage_iiib", fuel_type: "diesel" }));
      const p = (await t.rpc("save_project", { p_org_id: ORGS.owner_a, p_data: { name: "E4 Förbifart", site_address: "Stockholm" } })).project;
      await t.rpc("assign_machine", { p_org_id: ORGS.owner_a, p_machine_id: a.id, p_project_id: p.id });
      const all = await t.rpc("get_fleet_report", { p_org_id: ORGS.owner_a });
      expect(all.summary.count).toBeGreaterThanOrEqual(2);
      const proj = await t.rpc("get_fleet_report", { p_org_id: ORGS.owner_a, p_project_id: p.id });
      expect(proj.machines.map((x: any) => x.reg_number)).toEqual([a.reg_number]);
      expect(proj.summary).toMatchObject({ count: 1, stage_v_or_zero: 1, hvo: 1 });
      expect(proj.machines[0]).not.toHaveProperty("owner");
      const snap = await t.rpc("create_fleet_report", { p_org_id: ORGS.owner_a, p_project_id: p.id });
      expect(snap.report_number).toMatch(/^F-\d{4}-\d{6}$/);
      await t.as("anon");
      expect((await t.rpc("verify_report", { p_report_number: snap.report_number, p_result_hash: snap.result_hash })).valid).toBe(true);
      await t.as("owner_a");
      const link = await t.rpc("create_share_link", { p_org_id: ORGS.owner_a, p_machine_id: null, p_scope: "project_list", p_days: 30, p_params: { project_id: p.id } });
      await t.as("service");
      const view = await t.rpc("get_share_view", { p_token: link.token });
      expect(view.data.machines.map((x: any) => x.reg_number)).toEqual([a.reg_number]);
      expect(view.data.machines[0]).not.toHaveProperty("emission_stage");
      await t.as("owner_a");
      expect((await t.rpcError("grant_report_access", { p_org_id: ORGS.owner_a, p_client_org_id: ORGS.owner_b })).code).toBe("VALIDATION");
      const g = (await t.rpc("grant_report_access", { p_org_id: ORGS.owner_a, p_client_org_id: ORGS.client, p_project_id: p.id })).grant;
      await t.as("client");
      const list = await t.rpc<any[]>("list_report_grants", { p_org_id: ORGS.client });
      expect(list[0]).toMatchObject({ direction: "in", owner: { name: "Test Owner A AB" }, project: { name: "E4 Förbifart" } });
      expect((await t.rpc("get_client_report", { p_org_id: ORGS.client, p_grant_id: g.id })).machines).toHaveLength(1);
      expect(await t.q("select id from public.machines where id = $1", [a.id])).toHaveLength(0);
      await t.as("owner_a");
      await t.rpc("revoke_report_access", { p_org_id: ORGS.owner_a, p_grant_id: g.id });
      await t.as("client");
      expect((await t.rpcError("get_client_report", { p_org_id: ORGS.client, p_grant_id: g.id })).code).toBe("NOT_FOUND");
      expect(b.id).toBeTruthy();
    });
  });

  it("insurer registers a policy and gets the insurer relation; the badge is hidden from others", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("insurer");
      await t.rpc("add_insurance_policy", { p_org_id: ORGS.insurer, p_machine_id: m.id,
        p_data: { policy_number: "P-1", valid_from: "2026-01-01", valid_to: "2099-12-31", coverage: "full" } });
      const v = await t.rpc("get_machine", { p_org_id: ORGS.insurer, p_machine_id: m.id });
      expect(v.relations).toContain("insurer");
      expect(v.insured).toBe(true);
      await t.as("financier_a");
      const [f] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.financier_a, p_query: m.reg_number });
      expect(f.access).toBe("partner");
      expect(f.insured).toBeUndefined();
      await t.as("owner_a");
      expect((await t.rpc<any[]>("list_insurance_policies", { p_org_id: ORGS.owner_a, p_machine_id: m.id }))[0].insurer_name).toBe("Test Försäkring AB");
    });
  });

  it("rental: owner rents out, no overlap, lessee sees it, return releases the rental right; never financing", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const today = new Date().toISOString().slice(0, 10);
      const r = (await t.rpc("create_rental", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_lessee_org_id: ORGS.owner_b, p_from: today, p_to: "2099-01-31" })).rental;
      expect(r.status).toBe("active");
      expect((await t.rpcError("create_rental", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_lessee_org_id: ORGS.dealer, p_from: today, p_to: today })).code).toBe("RENTAL_OVERLAP");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.financing.has_active).toBe(false);
      expect(v.rental).toMatchObject({ status: "active", lessee: "Test Owner B AB" });
      await t.as("owner_b");
      expect((await t.rpc<any[]>("list_rentals", { p_org_id: ORGS.owner_b }))[0]).toMatchObject({ direction: "in", lessor: "Test Owner A AB" });
      const lv = await t.rpc("get_machine", { p_org_id: ORGS.owner_b, p_machine_id: m.id });
      expect(lv.relations).toContain("lessee");
      expect(lv.financing).toBeUndefined();
      await t.as("owner_a");
      await t.rpc("return_rental", { p_org_id: ORGS.owner_a, p_rental_id: r.id });
      expect((await t.q<any>("select status from public.encumbrances where id = $1", [r.encumbrance_id]))[0].status).toBe("released");
    });
  });
});

describe("partner directory", () => {
  it("lists approved orgs of partner types only, never owners", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const f = await t.rpc<any[]>("list_partner_orgs", { p_type: "financier" });
      expect(f.map((o) => o.name)).toEqual(expect.arrayContaining(["Test Finans A AB", "Test Finans B AB"]));
      expect((await t.rpcError("list_partner_orgs", { p_type: "owner" })).code).toBe("VALIDATION");
      await t.as("anon");
      expect((await t.rpcError("list_partner_orgs", { p_type: "financier" })).code).not.toBe("");
    });
  });
});
