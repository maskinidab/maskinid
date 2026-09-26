import { describe, expect, it } from "vitest";
import { NEXT_YEAR, TODAY, encParams, encumber, machineData, registerAs, serial, sign } from "./factories.ts";
import { ORGS, USERS, tx } from "./helpers.ts";

describe("encumbrances (SPEC §16 points 3–5)", () => {
  it("financier registers an active encumbrance with a signature; owner is notified", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const r = await encumber(t, "financier_a", m.id);
      expect(r.ok).toBe(true);
      expect(r.encumbrance.status).toBe("active");
      await t.as("owner_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.financing.has_active).toBe(true);
      expect(v.financing.active.holder.name).toBe("Test Finans A AB");
      const n = await t.rpc<any[]>("list_notifications");
      expect(n.some((x) => x.type === "encumbrance.registered")).toBe(true);
    });
  });

  it("requires a signature; signatures are single use and bound to what was signed", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("financier_a");
      const base = { p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "X1", p_start_date: TODAY, p_end_date: NEXT_YEAR };
      expect((await t.rpcError("register_encumbrance", base)).code).toBe("SIGNATURE_REQUIRED");
      const sig = await sign(t, ORGS.financier_a, "register_encumbrance", m.id, encParams("leasing", "OTHER", TODAY, NEXT_YEAR));
      expect((await t.rpcError("register_encumbrance", { ...base, p_signature_id: sig })).code).toBe("SIGNATURE_PARAMS_MISMATCH");
      const pending = await t.rpc("start_signature", {
        p_org_id: ORGS.financier_a, p_action: "register_encumbrance", p_subject_id: m.id, p_params: encParams("leasing", "X1", TODAY, NEXT_YEAR),
      });
      expect(pending.signed_text).toMatch(/Jag registrerar leasing på maskin/);
      expect((await t.rpcError("register_encumbrance", { ...base, p_signature_id: pending.id })).code).toBe("SIGNATURE_REQUIRED");
      await t.rpc("complete_mock_signature", { p_signature_id: pending.id });
      expect((await t.rpc("register_encumbrance", { ...base, p_signature_id: pending.id })).ok).toBe(true);
      const m2 = await registerAs(t, "owner_b");
      await t.as("financier_b");
      expect((await t.rpcError("register_encumbrance", { ...base, p_machine_id: m2.id, p_org_id: ORGS.financier_b, p_signature_id: pending.id })).code).toBe("SIGNATURE_INVALID");
    });
  });

  it("ownership reservation requires an end date", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const e = await t.error(() => encumber(t, "financier_a", m.id, "ownership_reservation", null));
      expect(e.detail).toMatchObject({ reason: "required_for_ownership_reservation" });
    });
  });

  it("second financier ⇒ ACTIVE_ENCUMBRANCE_EXISTS, conflict row, notifications and webhook, no partial write (§16.4)", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      await t.as(null);
      await t.q("insert into public.webhooks (org_id, url, secret, event_types) values ($1, 'https://hooks.example/a', 's', '{encumbrance.conflict}')", [ORGS.financier_a]);
      const r = await encumber(t, "financier_b", m.id, "ownership_reservation");
      expect(r).toMatchObject({ ok: false, error: "ACTIVE_ENCUMBRANCE_EXISTS", holder: "Test Finans A AB" });
      await t.as(null);
      expect(await t.val("select count(*)::int from public.encumbrances where machine_id = $1", [m.id])).toBe(1);
      const c = await t.one<any>("select * from public.conflicts where id = $1", [r.conflict_id]);
      expect(c.type).toBe("double_encumbrance");
      const notified = await t.q<any>("select user_id, severity from public.notifications where type like 'encumbrance.conflict%'");
      expect(notified).toEqual(expect.arrayContaining([
        { user_id: USERS.financier_a, severity: "critical" },
        { user_id: USERS.owner_a, severity: "warning" },
      ]));
      const d = await t.one<any>("select event_type, payload from public.webhook_deliveries order by created_at desc limit 1");
      expect(d.event_type).toBe("encumbrance.conflict");
      expect(d.payload.machine.reg_number).toBe(m.reg_number);
      // The failed attempt did not consume financier B's signature
      expect(await t.val("select count(*)::int from public.signatures where signer_user_id = $1 and consumed_at is not null", [USERS.financier_b])).toBe(0);
    });
  });

  it("the unique index is the last line of defence", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      await t.as(null);
      const e = await t.error(() => t.q(
        "insert into public.encumbrances (machine_id, type, holder_org_id, status) values ($1, 'ownership_reservation', $2, 'active')",
        [m.id, ORGS.financier_b]));
      expect(e.sqlstate).toBe("23505");
    });
  });

  it("only the holder may release (FORBIDDEN otherwise, §16.5)", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const r = await encumber(t, "financier_a", m.id);
      const id = r.encumbrance.id;
      for (const who of ["financier_b", "owner_a"] as const) {
        await t.as(who);
        const e = await t.rpcError("release_encumbrance", { p_org_id: ORGS[who], p_encumbrance_id: id });
        expect(e.code, who).toBe("FORBIDDEN");
      }
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "release_encumbrance", id);
      const rel = await t.rpc("release_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: id, p_signature_id: sig });
      expect(rel.encumbrance.status).toBe("released");
      expect((await encumber(t, "financier_b", m.id)).ok).toBe(true);
    });
  });

  it("insurers and unrelated owners see yes/no or nothing; financiers see the holder name but not contract details (§16.3, §2.6)", async () => {
    await tx(async (t) => {
      const s = serial("FIN");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await encumber(t, "financier_a", m.id);
      await t.as("insurer");
      const [ins] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.insurer, p_query: s });
      expect(ins.financing.has_active).toBe(true);
      expect(ins.financing.active).toBeNull();
      expect(await t.q("select id from public.encumbrances where machine_id = $1", [m.id])).toHaveLength(0);
      await t.as("owner_b");
      const [own] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.owner_b, p_query: s });
      expect(own.financing).toBeUndefined();
      await t.as("financier_b");
      const [fb] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.financier_b, p_query: s });
      expect(fb.financing.has_active).toBe(true);
      expect(fb.financing.active.holder.name).toBe("Test Finans A AB");
      expect(fb.financing.active.contract_ref).toBeUndefined();
      expect(await t.q("select id from public.encumbrances where machine_id = $1", [m.id])).toHaveLength(0);
    });
  });

  it("owner requests financing (pending), holder confirms; confirm is blocked if another is active", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const req = await t.rpc("request_encumbrance", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing", p_end_date: NEXT_YEAR,
      });
      expect(req.encumbrance.status).toBe("pending");
      await t.as("financier_b");
      expect((await t.rpcError("confirm_encumbrance", { p_org_id: ORGS.financier_b, p_encumbrance_id: req.encumbrance.id })).code).toBe("FORBIDDEN");
      const other = await encumber(t, "financier_b", m.id);
      expect(other.error).toBe("ACTIVE_ENCUMBRANCE_EXISTS");
      await t.as("financier_a");
      const c = await t.rpc("confirm_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: req.encumbrance.id });
      expect(c.encumbrance.status).toBe("active");
    });
  });

  it("holder transfers the encumbrance to another financier; both sign", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const r = await encumber(t, "financier_a", m.id);
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "transfer_encumbrance_holder", r.encumbrance.id, { new_holder_org_id: ORGS.financier_b });
      const tr = await t.rpc("transfer_encumbrance_holder", {
        p_org_id: ORGS.financier_a, p_encumbrance_id: r.encumbrance.id, p_new_holder_org_id: ORGS.financier_b, p_signature_id: sig,
      });
      await t.as("financier_b");
      const sig2 = await sign(t, ORGS.financier_b, "accept_encumbrance_transfer", tr.new_encumbrance_id);
      const acc = await t.rpc("accept_encumbrance_transfer", { p_org_id: ORGS.financier_b, p_encumbrance_id: tr.new_encumbrance_id, p_signature_id: sig2 });
      expect(acc.encumbrance.status).toBe("active");
      await t.as(null);
      expect(await t.val("select status from public.encumbrances where id = $1", [r.encumbrance.id])).toBe("transferred");
    });
  });
});

describe("transfers (SPEC §6.7, §16.9)", () => {
  it("applies the 10-day rule to the effective date", async () => {
    await tx(async (t) => {
      expect(await t.val("select app.transfer_effective_date('2026-09-01', '2026-09-11 12:00+02')")).toEqual(new Date("2026-09-01"));
      expect(await t.val("select app.transfer_effective_date('2026-09-01', '2026-09-12 12:00+02')")).toEqual(new Date("2026-09-12"));
    });
  });

  it("seller initiates, buyer accepts with signature; ownership moves; seller keeps read-only history", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b, p_sale_date: TODAY });
      expect(init.transfer.status).toBe("awaiting_buyer");
      await t.as("owner_b");
      const tid = init.transfer.id;
      expect((await t.rpcError("accept_transfer", { p_org_id: ORGS.owner_b, p_transfer_id: tid })).code).toBe("SIGNATURE_REQUIRED");
      const sig = await sign(t, ORGS.owner_b, "accept_transfer", tid);
      const acc = await t.rpc("accept_transfer", { p_org_id: ORGS.owner_b, p_transfer_id: tid, p_signature_id: sig });
      expect(acc.transfer.status).toBe("completed");
      expect(acc.machine.owner.id).toBe(ORGS.owner_b);
      await t.as(null);
      const own = await t.q<any>("select owner_org_id, to_date from public.ownerships where machine_id = $1 order by created_at", [m.id]);
      expect(own.map((o) => o.owner_org_id)).toEqual([ORGS.owner_a, ORGS.owner_b]);
      expect(own[0].to_date).not.toBeNull();
      await t.as("owner_a");
      const prev = await t.rpc("list_machines", { p_org_id: ORGS.owner_a, p_scope: "previous" });
      expect(prev.items.map((x: any) => x.id)).toContain(m.id);
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.access).toBe("previous_owner");
      expect((await t.rpcError("update_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_patch: { color: "röd" } })).code).toBe("FORBIDDEN");
    });
  });

  it("mock signatures are rejected outside DEMO_MODE (§16.9)", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b });
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "accept_transfer", init.transfer.id);
      await t.as(null);
      await t.q("update public.app_config set value = 'false' where key = 'DEMO_MODE'");
      await t.as("owner_b");
      const e = await t.rpcError("accept_transfer", { p_org_id: ORGS.owner_b, p_transfer_id: init.transfer.id, p_signature_id: sig });
      expect(e.code).toBe("SIGNATURE_PROVIDER_NOT_ALLOWED");
    });
  });

  it("active financing ⇒ awaiting_financier; holder releases; buyer then accepts", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.dealer, p_is_trade_in: true });
      expect(init.transfer.status).toBe("awaiting_financier");
      // Dealer at trade-in sees the holder (SPEC §2.6 footnote)
      await t.as("dealer");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.dealer, p_machine_id: m.id });
      expect(v.financing.active.holder.name).toBe("Test Finans A AB");
      expect((await t.rpcError("accept_transfer", { p_org_id: ORGS.dealer, p_transfer_id: init.transfer.id, p_signature_id: null })).code)
        .toBe("TRANSFER_NOT_AWAITING_BUYER");
      await t.as("financier_a");
      const fsig = await sign(t, ORGS.financier_a, "approve_transfer_financier", init.transfer.id, { decision: "release" });
      const ap = await t.rpc("approve_transfer_financier", { p_org_id: ORGS.financier_a, p_transfer_id: init.transfer.id, p_decision: "release", p_signature_id: fsig });
      expect(ap.transfer.status).toBe("awaiting_buyer");
      await t.as("dealer");
      const sig = await sign(t, ORGS.dealer, "accept_transfer", init.transfer.id);
      const acc = await t.rpc("accept_transfer", { p_org_id: ORGS.dealer, p_transfer_id: init.transfer.id, p_signature_id: sig });
      expect(acc.machine.stock_status).toBe("trade_in");
      expect(acc.machine.financing.has_active).toBe(false);
    });
  });

  it("financier can carry the encumbrance over to the buyer", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const enc = await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b });
      await t.as("financier_a");
      const fsig = await sign(t, ORGS.financier_a, "approve_transfer_financier", init.transfer.id, { decision: "transfer_to_buyer" });
      await t.rpc("approve_transfer_financier", { p_org_id: ORGS.financier_a, p_transfer_id: init.transfer.id, p_decision: "transfer_to_buyer", p_signature_id: fsig });
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "accept_transfer", init.transfer.id);
      await t.rpc("accept_transfer", { p_org_id: ORGS.owner_b, p_transfer_id: init.transfer.id, p_signature_id: sig });
      await t.as(null);
      const e = await t.one<any>("select status, counterparty_org_id from public.encumbrances where id = $1", [enc.encumbrance.id]);
      expect(e).toEqual({ status: "active", counterparty_org_id: ORGS.owner_b });
    });
  });

  it("buyer by e-mail accepts with the invite token after creating an org; new financing becomes pending", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_email: "newcomer@acme-test.se",
        p_new_financing: { holder_org_id: ORGS.financier_b, type: "ownership_reservation", end_date: NEXT_YEAR },
      });
      await t.as(null);
      const mail = await t.one<any>("select data from public.email_outbox where template = 'transfer_invite' order by created_at desc limit 1");
      await t.as("newcomer");
      const org = await t.rpc("create_org", { p_org_number: "556677-3333", p_types: "{owner}", p_accept_dpa_version: "2026-09" });
      expect((await t.rpcError("accept_transfer", { p_org_id: org.id, p_transfer_id: init.transfer.id })).code).toBe("FORBIDDEN");
      const sig = await sign(t, org.id, "accept_transfer", init.transfer.id);
      const acc = await t.rpc("accept_transfer", { p_org_id: org.id, p_transfer_id: init.transfer.id, p_signature_id: sig, p_token: mail.data.token });
      expect(acc.transfer.status).toBe("completed");
      await t.as(null);
      expect(await t.val("select status from public.encumbrances where machine_id = $1 and holder_org_id = $2", [m.id, ORGS.financier_b])).toBe("pending");
    });
  });

  it("seller can cancel before acceptance; only one open transfer per machine", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b });
      expect((await t.rpcError("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.dealer })).code).toBe("TRANSFER_ALREADY_OPEN");
      await t.as("owner_b");
      expect((await t.rpcError("initiate_transfer", { p_org_id: ORGS.owner_b, p_machine_id: m.id, p_to_org_id: ORGS.dealer })).code).toBe("FORBIDDEN");
      await t.as("owner_a");
      const c = await t.rpc("cancel_transfer", { p_org_id: ORGS.owner_a, p_transfer_id: init.transfer.id });
      expect(c.transfer.status).toBe("cancelled");
    });
  });

  it("dealer trade-in: dealer requests, owner approves, dealer accepts", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("dealer");
      const req = await t.rpc("request_trade_in", { p_org_id: ORGS.dealer, p_machine_id: m.id });
      expect(req.transfer.status).toBe("draft");
      await t.as("owner_a");
      const ap = await t.rpc("approve_trade_in", { p_org_id: ORGS.owner_a, p_transfer_id: req.transfer.id });
      expect(ap.transfer.status).toBe("awaiting_buyer");
      await t.as("dealer");
      const sig = await sign(t, ORGS.dealer, "accept_transfer", req.transfer.id);
      const acc = await t.rpc("accept_transfer", { p_org_id: ORGS.dealer, p_transfer_id: req.transfer.id, p_signature_id: sig });
      expect(acc.machine.owner.id).toBe(ORGS.dealer);
    });
  });
});

describe("flags (SPEC §6.8, §16.10)", () => {
  async function stolen(t: any, machineId: string) {
    await t.as("owner_a");
    const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", machineId, { reference: "5000-K123-26" });
    return t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: machineId, p_type: "stolen", p_reference: "5000-K123-26", p_signature_id: sig });
  }

  it("stolen: status, public card, blocks transfer and encumbrance, can be cleared", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      expect((await t.rpcError("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "5000-K123-26" })).code).toBe("SIGNATURE_REQUIRED");
      const f = await stolen(t, m.id);
      expect(f.status).toBe("stolen");
      await t.as("anon");
      expect((await t.rpc("public_machine_card", { p_reg: m.reg_number })).card.status).toBe("stolen");
      await t.as("owner_a");
      expect((await t.rpcError("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b })).code).toBe("MACHINE_STOLEN");
      const e = await t.error(() => encumber(t, "financier_a", m.id));
      expect(e.code).toBe("MACHINE_STOLEN");
      await t.as("owner_b");
      expect((await t.rpcError("clear_flag", { p_org_id: ORGS.owner_b, p_flag_id: f.flag.id, p_reason: "x" })).code).toBe("FORBIDDEN");
      await t.as("owner_a");
      const c = await t.rpc("clear_flag", { p_org_id: ORGS.owner_a, p_flag_id: f.flag.id, p_reason: "Återfunnen" });
      expect(c.status).toBe("active");
    });
  });

  it("stolen blocks accepting a transfer initiated before the theft", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const init = await t.rpc("initiate_transfer", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_to_org_id: ORGS.owner_b });
      await stolen(t, m.id);
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "accept_transfer", init.transfer.id);
      expect((await t.rpcError("accept_transfer", { p_org_id: ORGS.owner_b, p_transfer_id: init.transfer.id, p_signature_id: sig })).code).toBe("MACHINE_STOLEN");
    });
  });

  it("who may raise what: seized only authority, blocked authority/operator, stolen by holder", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("owner_a");
      expect((await t.rpcError("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "seized" })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "blocked" })).code).toBe("FORBIDDEN");
      await t.as("authority");
      const s = await t.rpc("raise_flag", { p_org_id: ORGS.authority, p_machine_id: m.id, p_type: "seized", p_reference: "BESLAG-1" });
      expect(s.status).toBe("blocked");
      await t.as("owner_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(v.flags[0].type).toBe("seized");
      const m2 = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m2.id);
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "raise_flag_stolen", m2.id, { reference: "P-9" });
      expect((await t.rpc("raise_flag", { p_org_id: ORGS.financier_a, p_machine_id: m2.id, p_type: "stolen", p_reference: "P-9", p_signature_id: sig })).status).toBe("stolen");
    });
  });
});

describe("deregistration (SPEC §6.9)", () => {
  it("requires a signature, revokes labels, frees the serial, blocked by others' financing", async () => {
    await tx(async (t) => {
      const s = serial("DER");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await t.as("operator");
      const b = await t.rpc("print_label_batch", { p_quantity: 1, p_assigned_org_id: ORGS.owner_a });
      await t.as(null);
      const code = await t.val<string>("select code from public.labels where batch_id = $1", [b.id]);
      await t.as("owner_a");
      await t.rpc("bind_label", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_code: code });
      await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      const params = { reason: "scrapped", label_disposition: "destroyed" };
      const sig = await sign(t, ORGS.owner_a, "deregister_machine", m.id, params);
      expect((await t.rpcError("deregister_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_reason: "scrapped", p_label_disposition: "destroyed", p_signature_id: sig })).code)
        .toBe("ENCUMBRANCE_BLOCKS_DEREGISTRATION");
      await t.as("financier_a");
      const fsig = await sign(t, ORGS.financier_a, "deregister_machine", m.id, params);
      const d = await t.rpc("deregister_machine", { p_org_id: ORGS.financier_a, p_machine_id: m.id, p_reason: "scrapped", p_label_disposition: "destroyed", p_signature_id: fsig });
      expect(d).toMatchObject({ ok: true, status: "scrapped", labels_revoked: 1 });
      await t.as("anon");
      expect((await t.rpc("public_machine_card", { p_code: code })).card).toMatchObject({ status: "scrapped", label_status: "replaced" });
      const again = await registerAs(t, "owner_b", machineData({ identifiers: [{ type: "serial", value: s }] }));
      expect(again.status).toBe("active");
    });
  });
});

describe("checks with receipts (SPEC §6.6)", () => {
  it("financier check creates a receipt, grants 24 h visibility and is logged as an event", async () => {
    await tx(async (t) => {
      const s = serial("CHECK");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await encumber(t, "financier_a", m.id);
      await t.as("financier_b");
      expect(await t.q("select id from public.machines where id = $1", [m.id])).toHaveLength(0);
      const r = await t.rpc("perform_check", { p_org_id: ORGS.financier_b, p_query: { type: "serial", value: s.toLowerCase() } });
      expect(r.receipt_number).toMatch(/^K-\d{4}-\d{6}$/);
      expect(r.result).toMatchObject({ found: true, has_active_financing: true, owner_org_name: "Test Owner A AB", financing: { holder: "Test Finans A AB" } });
      expect(await t.q("select id from public.machines where id = $1", [m.id])).toHaveLength(1);
      expect((await t.rpc("get_check_receipt", { p_receipt_number: r.receipt_number })).result_hash).toBe(r.result_hash);
      await t.as("financier_a");
      expect((await t.rpcError("get_check_receipt", { p_receipt_number: r.receipt_number })).code).toBe("NOT_FOUND");
      await t.as("dealer");
      const d = await t.rpc("perform_check", { p_org_id: ORGS.dealer, p_query: { reg: m.reg_number } });
      expect(d.result.has_active_financing).toBe(true);
      expect(d.result.financing).toBeNull();
      await t.as("owner_b");
      expect((await t.rpcError("perform_check", { p_org_id: ORGS.owner_b, p_query: { reg: m.reg_number } })).code).toBe("FORBIDDEN");
    });
  });

  it("not found still gives a receipt; invalid reg number is rejected; batch max 500", async () => {
    await tx(async (t) => {
      await t.as("financier_a");
      const r = await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { type: "serial", value: "NOPE-NOT-HERE-1" } });
      expect(r.result.found).toBe(false);
      expect((await t.rpcError("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: "ABC-DEF0" } })).code).toBe("VALIDATION");
      const batch = await t.rpc<any[]>("perform_check_batch", { p_org_id: ORGS.financier_a, p_queries: JSON.stringify([{ serial: "A1B2C3" }, { reg: "bad" }]) });
      expect(batch).toHaveLength(2);
      expect(batch[1].error).toBeTruthy();
      const big = JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ serial: `S${i}XX` })));
      expect((await t.rpcError("perform_check_batch", { p_org_id: ORGS.financier_a, p_queries: big })).code).toBe("VALIDATION");
    });
  });

  it("private BankID user sees yes/no only", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await encumber(t, "financier_a", m.id);
      await t.as("newcomer");
      const r = await t.rpc("private_financing_status", { p_reg: m.reg_number });
      expect(r.has_active_financing).toBe(true);
      expect(JSON.stringify(r)).not.toContain("Test Finans");
    });
  });
});
