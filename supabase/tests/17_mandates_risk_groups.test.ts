import { describe, expect, it } from "vitest";
import { encumber, machineData, NEXT_YEAR, registerAs, sign, TODAY } from "./factories.ts";
import { ORGS, tx, type Tx } from "./helpers.ts";

async function grant(t: Tx, kind: string, machineId: string | null, scopes: string[], agent: string = ORGS.dealer, validTo = NEXT_YEAR) {
  await t.as("owner_a");
  const sorted = [...new Set(scopes)].sort();
  const sig = await sign(t, ORGS.owner_a, "grant_mandate", ORGS.owner_a,
    { agent_org_id: agent, machine_id: machineId ?? "", scopes: sorted.join(", "), valid_to: validTo });
  return t.rpc("grant_mandate", { p_org_id: ORGS.owner_a, p_agent_org_id: agent, p_kind: kind, p_machine_id: machineId,
    p_scopes: `{${sorted.join(",")}}`, p_valid_to: validTo, p_signature_id: sig });
}

describe("mandates: fullmakt and kommission (step 21)", () => {
  it("consignment: signed grant, dealer accepts, machine in dealer stock, dealer sells with the owner as seller of record", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      expect((await t.rpcError("grant_mandate", { p_org_id: ORGS.owner_a, p_agent_org_id: ORGS.dealer, p_kind: "consignment", p_machine_id: m.id,
        p_scopes: "{sell,view}", p_valid_to: NEXT_YEAR })).code).toBe("SIGNATURE_REQUIRED");
      expect((await t.rpcError("grant_mandate", { p_org_id: ORGS.owner_a, p_agent_org_id: ORGS.financier_a, p_kind: "consignment", p_machine_id: m.id,
        p_scopes: "{sell}", p_valid_to: NEXT_YEAR })).code).toBe("VALIDATION");
      const d = await grant(t, "consignment", m.id, ["sell", "view"]);
      expect(d.status).toBe("pending");
      await t.as("dealer");
      expect((await t.rpcError("initiate_transfer", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_to_org_id: ORGS.owner_b })).code).toBe("FORBIDDEN");
      await t.rpc("respond_mandate", { p_org_id: ORGS.dealer, p_mandate_id: d.id, p_accept: true });
      const stock = await t.rpc("list_machines", { p_org_id: ORGS.dealer, p_scope: "stock" });
      expect(stock.items.find((x: any) => x.id === m.id).consignment).toMatchObject({ mandate_id: d.id });
      expect((await t.rpc("get_machine", { p_org_id: ORGS.dealer, p_machine_id: m.id })).relations).toContain("agent");
      const r = await t.rpc("sell_machine", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_buyer: { org_id: ORGS.owner_b } });
      expect(r.transfer.from.id).toBe(ORGS.owner_a);
      await t.as("owner_a");
      expect((await t.rpc<any[]>("list_notifications")).map((n) => n.type)).toContain("mandate.sale_started");
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "accept_transfer", r.transfer.id);
      await t.rpc("accept_transfer", { p_org_id: ORGS.owner_b, p_transfer_id: r.transfer.id, p_signature_id: sig });
      await t.as(null);
      expect(await t.val("select status from public.mandates where id = $1", [d.id])).toBe("completed");
    });
  });

  it("revoked mandate removes the agent's rights; fleet scope allows hours, other scopes do not", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      const poa = await grant(t, "power_of_attorney", null, ["fleet"]);
      await t.as("dealer");
      await t.rpc("respond_mandate", { p_org_id: ORGS.dealer, p_mandate_id: poa.id, p_accept: true });
      await t.rpc("record_hours", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_hours: 5000 });
      expect((await t.rpcError("initiate_transfer", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_to_org_id: ORGS.owner_b })).code).toBe("FORBIDDEN");
      await t.as("owner_a");
      await t.rpc("revoke_mandate", { p_org_id: ORGS.owner_a, p_mandate_id: poa.id, p_reason: "Avslutat samarbete" });
      await t.as("dealer");
      expect((await t.rpcError("record_hours", { p_org_id: ORGS.dealer, p_machine_id: m.id, p_hours: 5100 })).code).toBe("FORBIDDEN");
      expect((await t.rpc<any[]>("list_mandates", { p_org_id: ORGS.dealer }))[0]).toMatchObject({ direction: "received", status: "revoked" });
      await t.as("owner_b");
      expect(await t.q("select id from public.mandates")).toHaveLength(0);
    });
  });
});

describe("risk signals and monitoring after a check (step 21)", () => {
  it("check result lists risk signals; watch after check notifies on a new encumbrance until it expires", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("financier_a");
      const c = await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: m.reg_number } });
      expect(c.result.risk_signals.map((s: any) => s.code)).toContain("new_unverified_registration");
      await t.as("dealer");
      await t.rpc("perform_check", { p_org_id: ORGS.dealer, p_query: { reg: m.reg_number } });
      await t.as("financier_b");
      await t.rpc("perform_check", { p_org_id: ORGS.financier_b, p_query: { reg: m.reg_number } });
      await t.as("insurer");
      const c3 = await t.rpc("perform_check", { p_org_id: ORGS.insurer, p_query: { reg: m.reg_number } });
      expect(c3.result.risk_signals.map((s: any) => s.code)).toContain("many_recent_checks");
      await t.as("financier_a");
      expect((await t.rpcError("watch_after_check", { p_org_id: ORGS.financier_a, p_receipt_id: c.id, p_days: 45 })).code).toBe("VALIDATION");
      const w = await t.rpc("watch_after_check", { p_org_id: ORGS.financier_a, p_receipt_id: c.id, p_days: 30 });
      expect(w.watch.expires_at).toBeTruthy();
      await t.as("dealer");
      expect((await t.rpcError("watch_after_check", { p_org_id: ORGS.dealer, p_receipt_id: c.id, p_days: 30 })).code).toBe("NOT_FOUND");
      await encumber(t, "financier_b", m.id);
      await t.as("financier_a");
      const hits = (await t.rpc<any[]>("list_notifications")).filter((n) => n.type === "watch.hit");
      expect(hits[0].data).toMatchObject({ event: "encumbrance.registered", after_check: true });
      // Expired watches stay quiet.
      await t.as(null);
      await t.q("update public.watchlist set expires_at = now() - interval '1 day' where org_id = $1", [ORGS.financier_a]);
      await t.q("delete from public.notifications where user_id in (select user_id from public.memberships where org_id = $1)", [ORGS.financier_a]);
      await t.as("owner_a");
      const sig = await sign(t, ORGS.owner_a, "raise_flag_stolen", m.id, { reference: "K-1" });
      await t.rpc("raise_flag", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_type: "stolen", p_reference: "K-1", p_signature_id: sig });
      await t.as("financier_a");
      expect((await t.rpc<any[]>("list_notifications")).filter((n) => n.type === "watch.hit")).toHaveLength(0);
      // A stolen flag is a high risk signal in the next check.
      const c2 = await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: m.reg_number } });
      expect(c2.result.risk_signals[0]).toMatchObject({ code: "active_flag", severity: "high" });
    });
  });
});

describe("groups and departments (step 21)", () => {
  it("subsidiary links to a parent; parent reads the subsidiary fleet but cannot write; one level only; unlinking ends access", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      await t.as("owner_b");
      const l = await t.rpc("request_group_link", { p_org_id: ORGS.owner_b, p_parent_org_id: ORGS.owner_a });
      await t.as("owner_a");
      expect(await t.rpc<any[]>("list_group_machines", { p_org_id: ORGS.owner_a })).toEqual([]);
      await t.rpc("decide_group_link", { p_org_id: ORGS.owner_a, p_link_id: l.id, p_accept: true });
      const g = await t.rpc<any[]>("list_group_machines", { p_org_id: ORGS.owner_a });
      expect(g.map((x) => x.id)).toContain(m.id);
      expect((await t.rpc("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).relations).toContain("group");
      expect((await t.rpcError("update_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_patch: { color: "gul" } })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_hours: 9000 })).code).toBe("FORBIDDEN");
      await t.as("dealer");
      expect((await t.rpcError("request_group_link", { p_org_id: ORGS.dealer, p_parent_org_id: ORGS.owner_b })).code).toBe("VALIDATION");
      await t.as("owner_b");
      await t.rpc("end_group_link", { p_org_id: ORGS.owner_b, p_link_id: l.id });
      await t.as("owner_a");
      expect((await t.rpcError("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).code).toMatch(/NOT_FOUND|FORBIDDEN/);
    });
  });

  it("departments group an org's machines and show in the machine list", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      const d = await t.rpc("save_department", { p_org_id: ORGS.owner_a, p_name: "Anläggning Syd", p_code: "AS" });
      expect((await t.rpcError("save_department", { p_org_id: ORGS.owner_a, p_name: "Anläggning Syd" })).code).toBe("VALIDATION");
      await t.rpc("set_machine_department", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_department_id: d.id });
      expect((await t.rpc<any[]>("list_departments", { p_org_id: ORGS.owner_a }))[0].machines).toBe(1);
      const list = await t.rpc("list_machines", { p_org_id: ORGS.owner_a, p_scope: "owned" });
      expect(list.items.find((x: any) => x.id === m.id).department).toMatchObject({ name: "Anläggning Syd" });
      await t.as("owner_b");
      const other = await registerAs(t, "owner_b", machineData());
      await t.as("owner_b");
      expect((await t.rpcError("set_machine_department", { p_org_id: ORGS.owner_b, p_machine_id: other.id, p_department_id: d.id })).code).toBe("NOT_FOUND");
    });
  });
});
