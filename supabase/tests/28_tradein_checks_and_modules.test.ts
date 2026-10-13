import { describe, expect, it } from "vitest";
import { machineData, registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

/**
 * The dealer's view (ADR 0031): Inbytestest of its own, and the four fleet modules a dealer does not get.
 */

/** Every item answered, optionally failing one by id. */
async function answers(t: any, template: string, fail?: string) {
  const items = (await t.val("select items from public.checklist_templates where id = $1", [template])) as { id: string }[];
  return items.map((i) => ({ id: i.id, ok: i.id !== fail }));
}

async function builtinTemplate(t: any, name = "Daglig kontroll – grundmaskin"): Promise<string> {
  return (await t.val("select id::text from public.checklist_templates where org_id is null and name = $1", [name])) as string;
}

describe("Inbytestest: the dealer's own check of a machine it does not own (ADR 0031)", () => {
  it("a dealer can check a machine it has no relation to, and the owner's machine is untouched", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      await t.rpc("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 5000 });

      await t.as(null);
      // The setup submit_daily_check cannot handle: the dealer owns and uses nothing here.
      expect(await t.val<string[]>("select app.machine_relations($1, array[$2]::uuid[])", [m.id, ORGS.dealer])).toEqual([]);

      await t.as("dealer");
      const tpl = await builtinTemplate(t);
      const r = await t.rpc<any>("submit_tradein_check", {
        p_org_id: ORGS.dealer, p_template_id: tpl, p_answers: await answers(t, tpl, "leaks"),
        p_machine_id: m.id, p_hours: 4800, p_note: "Prisavdrag 40 000",
      });
      expect(r.result).toBe("failed");          // 'leaks' is a critical item
      expect(r.failed_items).toEqual(["leaks"]);

      // A dealer appraising someone else's machine must not take it out of service or write in its hour meter.
      await t.as(null);
      const after = await t.one<{ operational_status: string; hour_meter: number }>(
        "select operational_status, hour_meter from public.machines where id = $1", [m.id]);
      expect(after.operational_status).toBe("operational");
      expect(after.hour_meter).toBe(5000);
      // The dealer's own reading is on the check row instead.
      expect(await t.val("select hours from public.tradein_checks where machine_id = $1", [m.id])).toBe(4800);
      // And the serial is captured, so the row still means something if the machine is later merged or removed.
      expect(await t.val("select serial_text is not null from public.tradein_checks where machine_id = $1", [m.id])).toBe(true);
    });
  });

  it("a machine that is not in the register can still be appraised", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      const tpl = await builtinTemplate(t);
      const r = await t.rpc<any>("submit_tradein_check", {
        p_org_id: ORGS.dealer, p_template_id: tpl, p_answers: await answers(t, tpl),
        p_serial: "OKAND-SERIE-1", p_hours: 900,
      });
      expect(r.result).toBe("ok");
      await t.as(null);
      const row = await t.one<{ machine_id: string | null; serial_text: string }>(
        "select machine_id, serial_text from public.tradein_checks where serial_text = 'OKAND-SERIE-1'");
      expect(row.machine_id).toBeNull();
      expect(row.serial_text).toBe("OKAND-SERIE-1");
      // Neither a machine nor a serial is not a check.
      await t.as("dealer");
      expect((await t.rpcError("submit_tradein_check", {
        p_org_id: ORGS.dealer, p_template_id: tpl, p_answers: await answers(t, tpl),
      })).code).toBe("VALIDATION");
    });
  });

  it("every item must be answered, as in the daily check", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      const tpl = await builtinTemplate(t);
      const all = await answers(t, tpl);
      expect((await t.rpcError("submit_tradein_check", {
        p_org_id: ORGS.dealer, p_template_id: tpl, p_answers: all.slice(0, 3), p_serial: "HALV-1",
      })).code).toBe("VALIDATION");
    });
  });

  it("only a dealer may submit one, and only the dealer that made it may read it", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("dealer");
      const tpl = await builtinTemplate(t);
      await t.rpc("submit_tradein_check", {
        p_org_id: ORGS.dealer, p_template_id: tpl, p_answers: await answers(t, tpl),
        p_machine_id: m.id, p_note: "Vår bedömning",
      });

      // The machine's own owner is not a dealer, so it cannot make one – and must not read the dealer's notes.
      for (const who of ["owner_a", "financier_a", "insurer", "authority"] as const) {
        await t.as(who);
        expect((await t.rpcError("submit_tradein_check", {
          p_org_id: ORGS[who], p_template_id: tpl, p_answers: await answers(t, tpl), p_machine_id: m.id,
        })).code, who).toBe("FORBIDDEN");
        expect((await t.rpcError("list_tradein_checks", { p_org_id: ORGS[who] })).code, who).toBe("FORBIDDEN");
      }
      // Reading the table directly is blocked by RLS for the owner too: an appraisal is the dealer's own.
      await t.as("owner_a");
      expect(await t.q("select * from public.tradein_checks")).toEqual([]);
      await t.as("dealer");
      expect((await t.rpc<any[]>("list_tradein_checks", { p_org_id: ORGS.dealer })).length).toBe(1);
    });
  });

  it("the appraisal is logged without appearing in the owner's machine history", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("dealer");
      const tpl = await builtinTemplate(t);
      await t.rpc("submit_tradein_check", {
        p_org_id: ORGS.dealer, p_template_id: tpl, p_answers: await answers(t, tpl), p_machine_id: m.id,
      });
      await t.as(null);
      // Rule 3 is satisfied – there is an event – but it carries no machine_id. app.can_read_event returns true
      // for the owner on every event that has one, so logging it against the machine would show the owner
      // "Nordmaskin inbytestestade din maskin" before any offer was made.
      const ev = await t.one<{ machine_id: string | null; org_id: string; payload: any }>(
        "select machine_id, org_id, payload from public.events where type = 'dealer.tradein_check'");
      expect(ev.machine_id).toBeNull();
      expect(ev.org_id).toBe(ORGS.dealer);
      expect(ev.payload.serial).toBeTruthy();
      await t.as("owner_a");
      expect((await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: m.id }))
        .map((h) => h.type)).not.toContain("dealer.tradein_check");
    });
  });

  it("the daily check still works for the owner, and still stops a machine", async () => {
    // The point of a separate RPC is that neither behaviour changed.
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      const tpl = await builtinTemplate(t);
      const r = await t.rpc<any>("submit_daily_check", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_template_id: tpl, p_answers: await answers(t, tpl, "brakes"),
      });
      expect(r.result).toBe("failed");
      expect(r.operational_status).toBe("out_of_service");
    });
  });
});

describe("per-organisation fleet modules (ADR 0031)", () => {
  it("a dealer has the four off by default and an owner has them on", async () => {
    await tx(async (t) => {
      const module = (org: string, name: string) => t.val<boolean>("select app.org_module($1, $2)", [org, name]);
      for (const name of ["daily_check", "rentals", "climate", "operators"]) {
        expect(await module(ORGS.dealer, name), `dealer ${name}`).toBe(false);
        expect(await module(ORGS.owner_a, name), `owner ${name}`).toBe(true);
      }
      // Redskap was not part of the request, and nobody else is affected.
      expect(await module(ORGS.dealer, "attachments")).toBe(true);
      expect(await module(ORGS.financier_a, "rentals")).toBe(true);
    });
  });

  it("a module that is off refuses the write, whatever the client renders", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "dealer", machineData());
      await t.as("dealer");
      const tpl = await builtinTemplate(t);
      // Renting out: the dealer owns the machine, so only the module stands in the way.
      expect((await t.rpcError("create_rental", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_lessee_org_id: ORGS.owner_b,
        p_from: "2026-10-20", p_to: "2026-11-20",
      })).code).toBe("FEATURE_DISABLED");
      // A daily check on its own stock machine passes require_fleet_access, so without the module guard the
      // dealer could still do it by typing the address.
      expect((await t.rpcError("submit_daily_check", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_template_id: tpl, p_answers: await answers(t, tpl),
      })).code).toBe("FEATURE_DISABLED");
      expect((await t.rpcError("log_fuel", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_data: { quantity: 100, fuel: "diesel" },
      })).code).toBe("FEATURE_DISABLED");
      expect((await t.rpcError("save_operator", { p_org_id: ORGS.dealer, p_data: { name: "Test Testsson" } })).code)
        .toBe("FEATURE_DISABLED");
      // Inbytestest is never a module: it is what replaces the daily check in this view.
      expect((await t.rpc<any>("submit_tradein_check", {
        p_org_id: ORGS.dealer, p_template_id: tpl, p_answers: await answers(t, tpl), p_machine_id: m.id,
      })).ok).toBe(true);
      // And the built-in templates must stay readable, or Inbytestest has no checklist to show.
      expect((await t.rpc<any[]>("list_checklist_templates", { p_org_id: ORGS.dealer })).length).toBeGreaterThan(0);
    });
  });

  it("the organisation's own admin can switch a module on, and only a known name", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "dealer", machineData());
      await t.as("dealer");
      await t.rpc("update_org", { p_org_id: ORGS.dealer, p_patch: { settings: { modules: { rentals: true } } } });
      expect(await t.val("select app.org_module($1, 'rentals')", [ORGS.dealer])).toBe(true);
      expect((await t.rpc<any>("create_rental", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_lessee_org_id: ORGS.owner_b,
        p_from: "2026-10-20", p_to: "2026-11-20",
      })).ok).toBe(true);
      // Turning it off again sticks, because a stored key overrides the type-derived default either way.
      await t.rpc("update_org", { p_org_id: ORGS.dealer, p_patch: { settings: { modules: { rentals: false } } } });
      expect(await t.val("select app.org_module($1, 'rentals')", [ORGS.dealer])).toBe(false);
      // An owner can switch one off as well – the default is only a default.
      await t.as("owner_a");
      await t.rpc("update_org", { p_org_id: ORGS.owner_a, p_patch: { settings: { modules: { climate: false } } } });
      expect(await t.val("select app.org_module($1, 'climate')", [ORGS.owner_a])).toBe(false);

      await t.as("dealer");
      for (const patch of [{ bogus: true }, { rentals: "yes" }, { rentals: 1 }]) {
        expect((await t.rpcError("update_org", { p_org_id: ORGS.dealer, p_patch: { settings: { modules: patch } } })).code,
          JSON.stringify(patch)).toBe("VALIDATION");
      }
      // A member who is not an admin cannot change them.
      expect((await t.rpcError("update_org", { p_org_id: ORGS.owner_a, p_patch: { settings: { modules: { rentals: true } } } })).code)
        .toBe("FORBIDDEN");
    });
  });

  it("the operator can set them too, and it is audited", async () => {
    await tx(async (t) => {
      await t.as("operator");
      const r = await t.rpc<any>("admin_set_org_modules", { p_org_id: ORGS.dealer, p_modules: { rentals: true, climate: true } });
      expect(r.modules).toMatchObject({ rentals: true, climate: true });
      expect((await t.rpcError("admin_set_org_modules", { p_org_id: ORGS.dealer, p_modules: { bogus: true } })).code).toBe("VALIDATION");
      await t.as("dealer");
      expect((await t.rpcError("admin_set_org_modules", { p_org_id: ORGS.dealer, p_modules: { rentals: false } })).code).toBe("FORBIDDEN");
      await t.as(null);
      expect(await t.val("select count(*)::int from public.operator_audit where action = 'org.modules_changed'")).toBe(1);
    });
  });

  it("my_context tells the client the effective modules, not the stored ones", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      const before = await t.rpc<any>("my_context", {});
      const dealerMembership = (c: any) => c.memberships.find((x: any) => x.org.id === ORGS.dealer);
      // Nothing is stored yet, and the client still gets a complete answer.
      expect(dealerMembership(before).modules).toEqual({
        daily_check: false, rentals: false, climate: false, operators: false, attachments: true,
      });
      await t.rpc("update_org", { p_org_id: ORGS.dealer, p_patch: { settings: { modules: { rentals: true } } } });
      expect(dealerMembership(await t.rpc<any>("my_context", {})).modules.rentals).toBe(true);
    });
  });
});
