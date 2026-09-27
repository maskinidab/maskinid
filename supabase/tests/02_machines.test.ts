import { describe, expect, it } from "vitest";
import { machineData, registerAs, serial } from "./factories.ts";
import { ORGS, type Tx, USERS, tx } from "./helpers.ts";

describe("register_machine (step 3)", () => {
  it("registers an active level-0 machine with a valid reg number, ownership and event", async () => {
    await tx(async (t) => {
      const r = await registerAs(t, "owner_a");
      expect(r.ok).toBe(true);
      expect(r.status).toBe("active");
      await t.as(null);
      expect(await t.val("select app.is_valid_reg_number($1)", [r.reg_number])).toBe(true);
      const m = await t.one<any>("select * from public.machines where id = $1", [r.id]);
      expect(m).toMatchObject({ verification_level: 0, origin: "retro", owner_org_id: ORGS.owner_a, registered_by_org_id: ORGS.owner_a });
      expect(await t.val("select count(*)::int from public.ownerships where machine_id = $1 and to_date is null", [r.id])).toBe(1);
      const ev = await t.one<any>("select type, machine_id, actor_org_id, actor_user_id from public.events order by seq desc limit 1");
      expect(ev).toMatchObject({ type: "machine.registered", machine_id: r.id, actor_org_id: ORGS.owner_a, actor_user_id: USERS.owner_a });
    });
  });

  it("requires identity verification and a registering org type", async () => {
    await tx(async (t) => {
      await t.as("unverified");
      expect((await t.rpcError("register_machine", { p_org_id: ORGS.owner_a, p_data: machineData() })).code).toBe("IDENTITY_NOT_VERIFIED");
      await t.as("insurer");
      expect((await t.rpcError("register_machine", { p_org_id: ORGS.insurer, p_data: machineData() })).code).toBe("FORBIDDEN");
      await t.as("authority");
      expect((await t.rpcError("register_machine", { p_org_id: ORGS.authority, p_data: machineData() })).code).toBe("FORBIDDEN");
      await t.as("owner_b");
      expect((await t.rpcError("register_machine", { p_org_id: ORGS.owner_a, p_data: machineData() })).code).toBe("FORBIDDEN");
    });
  });

  it("validates identifiers and required fields", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const e1 = await t.rpcError("register_machine", { p_org_id: ORGS.owner_a, p_data: machineData({ identifiers: [] }) });
      expect(e1.code).toBe("VALIDATION");
      const e2 = await t.rpcError("register_machine", {
        p_org_id: ORGS.owner_a,
        p_data: machineData({ identifiers: [{ type: "engine_serial", value: "ENG12345" }] }),
      });
      expect(e2.detail).toMatchObject({ reason: "serial_required" });
      const e3 = await t.rpcError("register_machine", { p_org_id: ORGS.owner_a, p_data: machineData({ category: null }) });
      expect(e3.code).toBe("VALIDATION");
    });
  });

  it("duplicate serial ⇒ new machine disputed + conflict + notifications, never a silent duplicate (SPEC §16.8)", async () => {
    await tx(async (t) => {
      const s = serial("DUP");
      const first = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      const second = await registerAs(t, "owner_b", machineData({ identifiers: [{ type: "serial", value: ` ${s.toLowerCase()} ` }] }));
      expect(second.ok).toBe(true);
      expect(second.status).toBe("disputed");
      expect(second.existing_reg_number).toBe(first.reg_number);
      expect(second.conflict_id).toBeTruthy();
      await t.as(null);
      const c = await t.one<any>("select * from public.conflicts where id = $1", [second.conflict_id]);
      expect(c).toMatchObject({ type: "duplicate_identifier", machine_id: second.id, related_machine_id: first.id, status: "open" });
      expect(await t.val("select count(*)::int from public.machine_identifiers where normalized_value = $1 and unique_active", [s])).toBe(1);
      const n = await t.q<any>("select user_id, type from public.notifications where type in ('conflict.duplicate_identifier', 'conflict.created')");
      expect(n.map((x) => x.user_id)).toEqual(expect.arrayContaining([USERS.owner_a, USERS.operator]));
    });
  });

  it("scrapped machines free their serial for a new registration", async () => {
    await tx(async (t) => {
      const s = serial("SCR");
      const first = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as(null);
      await t.q("update public.machines set status = 'scrapped' where id = $1", [first.id]);
      const again = await registerAs(t, "owner_b", machineData({ identifiers: [{ type: "serial", value: s }] }));
      expect(again.status).toBe("active");
    });
  });

  it("registering for another org by org number creates an unclaimed owner org and invites it", async () => {
    await tx(async (t) => {
      const r = await registerAs(t, "dealer", machineData({ owner_org_number: "556123-4567", owner_email: "boss@kund.se" }));
      await t.as(null);
      const m = await t.one<any>("select owner_org_id, registered_by_org_id from public.machines where id = $1", [r.id]);
      expect(m.registered_by_org_id).toBe(ORGS.dealer);
      const o = await t.one<any>("select name, status from public.organizations where id = $1", [m.owner_org_id]);
      expect(o.status).toBe("pending");
      expect(await t.val("select template from public.email_outbox where to_email = 'boss@kund.se'")).toBe("invite_owner");
      await t.as("dealer");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.dealer, p_machine_id: r.id });
      expect(v.relations).toContain("registered_by");
    });
  });

  it("factory data (oem_records) prefills technical fields and logs factory_data_confirmed", async () => {
    await tx(async (t) => {
      const s = serial("OEM");
      await t.q(
        `insert into public.oem_records (manufacturer_org_id, make, model, year, category, serial_number, normalized_serial,
           emission_stage, engine_power_kw, service_weight_kg, fuel_type, has_lifting_device)
         values ($1, 'Volvo', 'EC220E', 2022, 'excavator_tracked', $2, $2, 'stage_v', 129, 22500, 'diesel', true)`,
        [ORGS.manufacturer, s],
      );
      const r = await registerAs(t, "owner_a", { identifiers: [{ type: "serial", value: s }], category: "excavator_tracked" } as any);
      expect(r.factory_data).toBe(true);
      await t.as(null);
      const m = await t.one<any>("select make, model, emission_stage, service_weight_kg, has_lifting_device from public.machines where id = $1", [r.id]);
      expect(m).toEqual({ make: "Volvo", model: "EC220E", emission_stage: "stage_v", service_weight_kg: 22500, has_lifting_device: true });
      expect(await t.val("select count(*)::int from public.events where machine_id = $1 and type = 'machine.factory_data_confirmed'", [r.id])).toBe(1);
    });
  });

  it("road registration number is looked up in the vehicle register (mock) and mismatch warns", async () => {
    await tx(async (t) => {
      const r = await registerAs(t, "owner_a", machineData({
        identifiers: [{ type: "serial", value: serial() }, { type: "road_reg", value: "ABC 12B" }],
      }));
      await t.as(null);
      const snap = await t.val<any>("select vtr_snapshot from public.machine_identifiers where machine_id = $1 and type = 'road_reg'", [r.id]);
      expect(snap.source).toBe("mock");
      expect(snap).not.toHaveProperty("owner_name");
      expect(Array.isArray(r.warnings)).toBe(true);
    });
  });

  it("drafts autosave, are private and become machines", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const d = await t.rpc("save_machine_draft", { p_org_id: ORGS.owner_a, p_data: { make: "Cat", step: 2 } });
      await t.rpc("save_machine_draft", { p_org_id: ORGS.owner_a, p_draft_id: d.id, p_data: { make: "Cat", model: "320", step: 3 } });
      const drafts = await t.rpc<any[]>("list_machine_drafts", { p_org_id: ORGS.owner_a });
      expect(drafts.find((x) => x.id === d.id).draft_data.step).toBe(3);
      await t.as("owner_b");
      expect(await t.rpc<any[]>("list_machine_drafts", { p_org_id: ORGS.owner_b })).toHaveLength(0);
      await t.as("anon");
      expect((await t.rpc("public_machine_card", { p_reg: "ABC-2345" })).found).toBe(false);
      await t.as("owner_a");
      const r = await t.rpc("register_machine", {
        p_org_id: ORGS.owner_a, p_draft_id: d.id, p_data: machineData({ make: "Cat", model: "320" }),
      });
      expect(r.id).toBe(d.id);
      expect(r.status).toBe("active");
    });
  });
});

describe("machine visibility (SPEC §16.1–2)", () => {
  it("owner B cannot read owner A's machine, identifiers or ownerships", async () => {
    await tx(async (t) => {
      const r = await registerAs(t, "owner_a");
      await t.as("owner_b");
      expect(await t.q("select id from public.machines where id = $1", [r.id])).toHaveLength(0);
      expect(await t.q("select id from public.machine_identifiers where machine_id = $1", [r.id])).toHaveLength(0);
      expect(await t.q("select id from public.ownerships where machine_id = $1", [r.id])).toHaveLength(0);
      expect((await t.rpcError("get_machine", { p_org_id: ORGS.owner_b, p_machine_id: r.id })).code).toBe("NOT_FOUND");
    });
  });

  it("exact lookup: owners get a basic masked view, partners see the owner, authority everything", async () => {
    await tx(async (t) => {
      const s = serial("LK");
      const r = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("owner_b");
      const [basic] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.owner_b, p_query: s });
      expect(basic.access).toBe("basic");
      expect(basic.owner).toBeNull();
      expect(basic.identifiers[0].value).toMatch(/^•+/);
      await t.as("financier_a");
      const [fin] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.financier_a, p_query: r.reg_number });
      expect(fin.access).toBe("partner");
      expect(fin.owner.name).toBe("Test Owner A AB");
      expect(fin.identifiers[0].value).toBe(s);
      await t.as("insurer");
      const [ins] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.insurer, p_query: s });
      expect(ins.identifiers[0].value).toMatch(/^•+/);
      await t.as("authority");
      const rows = await t.q("select id from public.machines where id = $1", [r.id]);
      expect(rows).toHaveLength(1);
      await t.as("owner_b");
      expect(await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.owner_b, p_query: s.slice(0, -2) })).toEqual([]);
    });
  });

  it("anon cannot read machine tables; public card returns exactly the SPEC §5.3 fields", async () => {
    await tx(async (t) => {
      const r = await registerAs(t, "owner_a");
      await t.as("anon");
      for (const table of ["machines", "machine_identifiers", "ownerships", "labels", "conflicts", "oem_records", "machine_models"]) {
        expect((await t.error(() => t.q(`select * from public.${table} limit 1`))).code, table).toMatch(/permission denied/);
      }
      const card = await t.rpc("public_machine_card", { p_reg: r.reg_number.toLowerCase().replace(/^(...)/, "$1-") });
      expect(card.found).toBe(true);
      expect(Object.keys(card.card).sort()).toEqual([
        "category", "has_registered_owner", "inspection_valid_until", "label_status", "make", "model", "primary_photo_path",
        "reg_number", "serial_masked", "status", "verification_level", "year",
      ]);
      expect(card.card.serial_masked).toMatch(/^•+[0-9A-Z]{3}$/);
      expect(JSON.stringify(card)).not.toContain("Test Owner A");
      const bad = await t.rpc("public_machine_card", { p_reg: "ABC-DEFG" });
      expect(bad).toEqual({ found: false, reason: "invalid_reg_number" });
    });
  });
});

describe("labels (SPEC §5.2)", () => {
  async function printedLabels(t: Tx, org: string | null, n = 3): Promise<string[]> {
    await t.as("operator");
    const b = await t.rpc("print_label_batch", { p_quantity: n, p_assigned_org_id: org });
    await t.as(null);
    return (await t.q<{ code: string }>("select code from public.labels where batch_id = $1 order by created_at", [b.id])).map((x) => x.code);
  }

  it("binds a label, shows the card by QR code, blocks reuse with a conflict and handles replacement", async () => {
    await tx(async (t) => {
      const [c1, c2] = await printedLabels(t, ORGS.dealer);
      const m1 = await registerAs(t, "dealer");
      const m2 = await registerAs(t, "dealer");
      const b = await t.rpc("bind_label", { p_org_id: ORGS.dealer, p_machine_id: m1.id, p_code: c1 });
      expect(b.ok).toBe(true);
      await t.as("anon");
      const card = await t.rpc("public_machine_card", { p_code: c1 });
      expect(card.card.reg_number).toBe(m1.reg_number);
      expect(card.card.label_status).toBe("bound");
      await t.as("dealer");
      const reuse = await t.rpc("bind_label", { p_org_id: ORGS.dealer, p_machine_id: m2.id, p_code: c1 });
      expect(reuse).toMatchObject({ ok: false, error: "LABEL_ALREADY_USED" });
      const repl = await t.rpc("bind_label", { p_org_id: ORGS.dealer, p_machine_id: m1.id, p_code: c2 });
      expect(repl.replaced_label_id).toBeTruthy();
      await t.as("anon");
      const old = await t.rpc("public_machine_card", { p_code: c1 });
      expect(old.card.label_status).toBe("replaced");
      expect(old.card.reg_number).toBe(m1.reg_number);
    });
  });

  it("labels assigned to another org cannot be bound; owners cannot bind to foreign machines", async () => {
    await tx(async (t) => {
      const [c1] = await printedLabels(t, ORGS.dealer, 1);
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      expect((await t.rpcError("bind_label", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_code: c1 })).code).toBe("LABEL_ASSIGNED_TO_OTHER_ORG");
      const [free] = await printedLabels(t, null, 1);
      await t.as("owner_b");
      expect((await t.rpcError("bind_label", { p_org_id: ORGS.owner_b, p_machine_id: m.id, p_code: free })).code).toBe("FORBIDDEN");
      await t.as("owner_a");
      expect((await t.rpc("bind_label", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_code: free })).ok).toBe(true);
    });
  });

  it("dealers order labels; only operators print", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      const b = await t.rpc("order_labels", { p_org_id: ORGS.dealer, p_quantity: 50 });
      expect(b.status).toBe("ordered");
      expect((await t.rpcError("print_label_batch", { p_batch_id: b.id })).code).toBe("FORBIDDEN");
      await t.as("operator");
      const p = await t.rpc("print_label_batch", { p_batch_id: b.id });
      expect(p.status).toBe("printed");
      await t.as("dealer");
      const l = await t.rpc("list_labels", { p_org_id: ORGS.dealer });
      expect(l.labels.filter((x: any) => x.status === "assigned")).toHaveLength(50);
    });
  });
});

describe("other machine RPCs", () => {
  it("check_identifier reports duplicates for the live SerialInput", async () => {
    await tx(async (t) => {
      const s = serial("CHK");
      await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("owner_a");
      expect(await t.rpc("check_identifier", { p_org_id: ORGS.owner_a, p_type: "serial", p_value: s })).toMatchObject({ exists: true, is_mine: true });
      await t.as("owner_b");
      const r = await t.rpc("check_identifier", { p_org_id: ORGS.owner_b, p_type: "serial", p_value: s });
      expect(r).toMatchObject({ exists: true, is_mine: false, machine_id: null });
    });
  });

  it("update_machine: owner only, hour meter never decreases", async () => {
    await tx(async (t) => {
      const r = await registerAs(t, "owner_a", machineData({ hour_meter: 100 }));
      await t.as("owner_a");
      const v = await t.rpc("update_machine", { p_org_id: ORGS.owner_a, p_machine_id: r.id, p_patch: { hour_meter: 150 } });
      expect(v.hour_meter).toBe(150);
      expect((await t.rpcError("update_machine", { p_org_id: ORGS.owner_a, p_machine_id: r.id, p_patch: { hour_meter: 10 } })).code).toBe("VALIDATION");
      expect((await t.rpcError("update_machine", { p_org_id: ORGS.owner_a, p_machine_id: r.id, p_patch: { owner_org_id: ORGS.owner_b } })).code).toBe("VALIDATION");
      await t.as("owner_b");
      expect((await t.rpcError("update_machine", { p_org_id: ORGS.owner_b, p_machine_id: r.id, p_patch: { color: "x" } })).code).toBe("FORBIDDEN");
    });
  });

  it("list_machines returns the org's machines", async () => {
    await tx(async (t) => {
      await registerAs(t, "owner_b");
      await registerAs(t, "owner_b");
      await t.as("owner_b");
      const l = await t.rpc("list_machines", { p_org_id: ORGS.owner_b });
      expect(l.total).toBeGreaterThanOrEqual(2);
      await t.as("owner_a");
      const l2 = await t.rpc("list_machines", { p_org_id: ORGS.owner_a, p_query: "zzz-nothing" });
      expect(l2.total).toBe(0);
    });
  });
});
