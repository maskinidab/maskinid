import { describe, expect, it } from "vitest";
import { machineData, registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

describe("attachments, operators, daily checks, fuel and climate (step 20)", () => {
  it("attachments: create, mount on own machine (event), move, retire unmounts; other orgs cannot see or mount", async () => {
    await tx(async (t) => {
      const m1 = await registerAs(t, "owner_a", machineData());
      const m2 = await registerAs(t, "owner_a", machineData());
      const other = await registerAs(t, "owner_b", machineData());
      await t.as("owner_a");
      const a = await t.rpc("save_attachment", { p_org_id: ORGS.owner_a, p_data: { type: "tiltrotator", make: "Rototilt", model: "R6", serial: "RT-1234" } });
      expect((await t.rpcError("mount_attachment", { p_org_id: ORGS.owner_a, p_attachment_id: a.id, p_machine_id: other.id })).code).toBe("FORBIDDEN");
      await t.rpc("mount_attachment", { p_org_id: ORGS.owner_a, p_attachment_id: a.id, p_machine_id: m1.id });
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m1.id })).attachments[0]).toMatchObject({ make: "Rototilt" });
      await t.rpc("mount_attachment", { p_org_id: ORGS.owner_a, p_attachment_id: a.id, p_machine_id: m2.id });
      expect((await t.rpc<any[]>("list_attachments", { p_org_id: ORGS.owner_a }))[0].machine.id).toBe(m2.id);
      await t.rpc("save_attachment", { p_org_id: ORGS.owner_a, p_attachment_id: a.id, p_data: { type: "tiltrotator", make: "Rototilt", status: "retired" } });
      expect((await t.rpc<any[]>("list_attachments", { p_org_id: ORGS.owner_a }))[0].machine).toBeNull();
      await t.as(null);
      expect(await t.val("select count(*)::int from public.events where type in ('attachment.mounted', 'attachment.unmounted') and machine_id in ($1, $2)", [m1.id, m2.id])).toBe(4);
      await t.as("owner_b");
      expect(await t.q("select id from public.attachments")).toHaveLength(0);
      expect((await t.rpcError("mount_attachment", { p_org_id: ORGS.owner_b, p_attachment_id: a.id, p_machine_id: other.id })).code).toBe("NOT_FOUND");
    });
  });

  it("operators: admin manages, personal numbers are refused, certificates flag expiry, assignment shows on the machine", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a_readonly");
      expect((await t.rpcError("save_operator", { p_org_id: ORGS.owner_a, p_data: { name: "Olle Förare" } })).code).toBe("FORBIDDEN");
      await t.as("owner_a");
      expect((await t.rpcError("save_operator", { p_org_id: ORGS.owner_a, p_data: { name: "Olle", employee_ref: "19800101-1234" } })).code).toBe("VALIDATION");
      const o = await t.rpc("save_operator", { p_org_id: ORGS.owner_a, p_data: { name: "Olle Förare", employee_ref: "A-17" } });
      const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
      await t.rpc("add_operator_certificate", { p_org_id: ORGS.owner_a, p_operator_id: o.id, p_data: { type: "machine_operator_licence", valid_until: soon } });
      await t.rpc("assign_operator", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_operator_id: o.id });
      const [row] = await t.rpc<any[]>("list_operators", { p_org_id: ORGS.owner_a });
      expect(row.certificates[0]).toMatchObject({ expiring: true, expired: false });
      expect(row.machines[0].id).toBe(m.id);
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).operator.name).toBe("Olle Förare");
      await t.as("owner_b");
      expect(await t.q("select id from public.operators")).toHaveLength(0);
    });
  });

  it("daily check: all items required; failed critical item stops the machine and notifies; clean check releases it", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData({ category: "excavator_tracked" }));
      await t.as("owner_a");
      const [tpl] = await t.rpc<any[]>("list_checklist_templates", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(tpl.builtin).toBe(true);
      const items = tpl.items as { id: string; critical: boolean }[];
      expect((await t.rpcError("submit_daily_check", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_template_id: tpl.id, p_answers: JSON.stringify([{ id: items[0].id, ok: true }]) })).code).toBe("VALIDATION");
      const critical = items.find((i) => i.critical)!;
      const bad = await t.rpc("submit_daily_check", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_template_id: tpl.id, p_hours: 1234,
        p_answers: JSON.stringify(items.map((i) => ({ id: i.id, ok: i.id !== critical.id, note: i.id === critical.id ? "Läcker" : null }))) });
      expect(bad).toMatchObject({ result: "failed", operational_status: "out_of_service", failed_items: [critical.id] });
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.operational.status).toBe("out_of_service");
      expect(v.hour_meter).toBe(1234);
      expect((await t.rpc<any[]>("list_notifications")).map((n) => n.type)).toContain("machine.out_of_service");
      const good = await t.rpc("submit_daily_check", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_template_id: tpl.id,
        p_answers: JSON.stringify(items.map((i) => ({ id: i.id, ok: true }))) });
      expect(good).toMatchObject({ result: "ok", operational_status: "operational" });
      // A manual stop is not lifted by a daily check.
      await t.rpc("set_operational_status", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_status: "out_of_service", p_reason: "Väntar på reservdel" });
      await t.rpc("submit_daily_check", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_template_id: tpl.id, p_answers: JSON.stringify(items.map((i) => ({ id: i.id, ok: true }))) });
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).operational.status).toBe("out_of_service");
      expect(await t.rpc<any[]>("list_daily_checks", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).toHaveLength(3);
      await t.as("owner_b");
      expect((await t.rpcError("submit_daily_check", { p_org_id: ORGS.owner_b, p_machine_id: m.id, p_template_id: tpl.id, p_answers: "[]" })).code).toBe("FORBIDDEN");
    });
  });

  it("custom checklist templates are per org; builtin ones cannot be edited", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const tpl = await t.rpc("save_checklist_template", { p_org_id: ORGS.owner_a, p_data: { name: "Vinterkontroll", categories: ["wheel_loader"],
        items: [{ id: "chains", sv: "Snökedjor hela", critical: false }] } });
      expect((await t.rpcError("save_checklist_template", { p_org_id: ORGS.owner_a, p_data: { name: "X", items: [] } })).code).toBe("VALIDATION");
      const builtin = (await t.rpc<any[]>("list_checklist_templates", { p_org_id: ORGS.owner_a })).find((x) => x.builtin);
      expect((await t.rpcError("save_checklist_template", { p_org_id: ORGS.owner_a, p_template_id: builtin.id, p_data: { name: "Hack", items: [{ id: "a", sv: "b" }] } })).code).toBe("NOT_FOUND");
      await t.as("owner_b");
      expect((await t.rpc<any[]>("list_checklist_templates", { p_org_id: ORGS.owner_b })).map((x) => x.id)).not.toContain(tpl.id);
    });
  });

  it("fuel log feeds the climate report (CO2e with stored factors, fossil-free share) and a verifiable C- snapshot", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      await t.rpc("log_fuel", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_data: { fuel: "diesel", quantity: 100, hours: 500 } });
      await t.rpc("log_fuel", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_data: { fuel: "hvo100", quantity: 300, hours: 520 } });
      await t.rpc("log_fuel", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_data: { fuel: "electricity", quantity: 50 } });
      expect((await t.rpcError("log_fuel", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_data: { fuel: "diesel", quantity: -5 } })).code).toBe("VALIDATION");
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      expect((await t.rpcError("get_climate_report", { p_org_id: ORGS.owner_a, p_from: "2020-01-01", p_to: today })).code).toBe("VALIDATION");
      const r = await t.rpc("get_climate_report", { p_org_id: ORGS.owner_a, p_from: from, p_to: today });
      const f = r.factors;
      expect(r.totals.co2e_kg).toBe(Math.round(100 * f.diesel + 300 * f.hvo100 + 50 * f.electricity));
      expect(r.totals.fossil_free_share).toBe(75);
      expect(r.by_machine[0]).toMatchObject({ reg_number: m.reg_number, quantity_l: 400, kwh: 50, hours: 20 });
      const s = await t.rpc("create_climate_report", { p_org_id: ORGS.owner_a, p_from: from, p_to: today });
      expect(s.report_number).toMatch(/^C-/);
      await t.as("anon");
      expect((await t.rpc("verify_report", { p_report_number: s.report_number, p_result_hash: s.result_hash })).valid).toBe(true);
      await t.as("owner_b");
      expect((await t.rpc("get_climate_report", { p_org_id: ORGS.owner_b, p_from: from, p_to: today })).totals.co2e_kg).toBe(0);
    });
  });
});
