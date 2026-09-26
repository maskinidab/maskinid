import { describe, expect, it } from "vitest";
import { machineData, registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

const DPA = "2026-09";

describe("operator admin (SPEC §9 /admin, §2.4)", () => {
  it("only operators reach admin RPCs; support reads, superadmin changes", async () => {
    await tx(async (t) => {
      for (const who of ["owner_a", "dealer", "authority"] as const) {
        await t.as(who);
        expect((await t.rpcError("admin_overview", {})).code).toBe("FORBIDDEN");
        expect((await t.rpcError("admin_support_search", { p_query: "abc" })).code).toBe("FORBIDDEN");
      }
      await t.as("anon");
      expect((await t.rpcError("admin_overview", {})).code).toMatch(/permission denied|NOT_AUTHENTICATED/);
      await t.as("support");
      const o = await t.rpc("admin_overview", {});
      expect(o).toMatchObject({ operator_org: expect.objectContaining({ id: ORGS.operator }), operator_role: "support" });
      expect(await t.rpc("admin_list_config", {})).toEqual(expect.arrayContaining([expect.objectContaining({ key: "FEATURE_MARKET" })]));
      expect((await t.rpcError("admin_set_config", { p_key: "FEATURE_SMS", p_value: true })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("admin_list_audit", {})).code).toBe("FORBIDDEN");
      await t.as("verifier");
      expect((await t.rpcError("admin_set_config", { p_key: "FEATURE_SMS", p_value: true })).code).toBe("FORBIDDEN");
    });
  });

  it("feature flags: superadmin toggles existing keys, booleans stay booleans; logged as event and audit", async () => {
    await tx(async (t) => {
      await t.as("operator");
      expect((await t.rpcError("admin_set_config", { p_key: "NOPE", p_value: true })).code).toBe("NOT_FOUND");
      expect((await t.rpcError("admin_set_config", { p_key: "FEATURE_SMS", p_value: JSON.stringify("yes") })).code).toBe("VALIDATION");
      await t.rpc("admin_set_config", { p_key: "FEATURE_SMS", p_value: true });
      expect(await t.val("select app.flag('FEATURE_SMS')")).toBe(true);
      const audit = await t.rpc<any[]>("admin_list_audit", {});
      expect(audit[0]).toMatchObject({ action: "config.changed", target_id: "FEATURE_SMS" });
      const ev = await t.rpc<any>("admin_list_events", { p_type: "config.changed" });
      expect(JSON.stringify(ev)).toContain("FEATURE_SMS");
    });
  });

  it("organisations: pending queue, narrowing types, approve; sole trader numbers masked for support", async () => {
    await tx(async (t) => {
      await t.as("newcomer");
      const org = await t.rpc("create_org", { p_org_number: "5566778899", p_types: "{dealer,financier}", p_accept_dpa_version: DPA });
      expect(org.status).toBe("pending");
      await t.as("support");
      const pending = await t.rpc<any[]>("admin_list_orgs", { p_status: "pending" });
      expect(pending.map((x) => x.id)).toContain(org.id);
      expect((await t.rpc<any[]>("admin_list_orgs", { p_query: "556677-8899" }))[0].id).toBe(org.id);
      const detail = await t.rpc("admin_get_org", { p_org_id: org.id });
      expect(detail.members[0]).toMatchObject({ role: "admin", status: "active" });
      expect((await t.rpcError("admin_set_org_types", { p_org_id: org.id, p_types: "{dealer}" })).code).toBe("FORBIDDEN");
      await t.as("verifier");
      expect((await t.rpcError("admin_set_org_types", { p_org_id: org.id, p_types: "{operator}" })).code).toBe("VALIDATION");
      expect((await t.rpc("admin_set_org_types", { p_org_id: org.id, p_types: "{dealer}" })).types).toEqual(["dealer"]);
      await t.rpc("approve_org", { p_org_id: org.id });
      await t.as(null);
      expect(await t.val("select count(*)::int from public.operator_audit where action in ('org.search', 'org.view', 'org.types_changed')")).toBe(3);
      // Sole trader (personal number as org number) is masked for support.
      const st = await t.val<string>(`insert into public.organizations (slug, types, name, org_number_hash, org_number_enc, is_sole_trader, status)
        values ('st-test', '{owner}', 'Sven Enskild Firma', app.org_number_hash('800101-1234'),
                extensions.pgp_sym_encrypt('198001011234', app.secret('org_number_key')), true, 'approved') returning id`);
      await t.as("support");
      const [row] = await t.rpc<any[]>("admin_list_orgs", { p_query: "Sven Enskild" });
      expect(row).toMatchObject({ id: st, org_number: "19XXXXXX-XXXX" });
      await t.as("operator");
      expect((await t.rpc<any[]>("admin_list_orgs", { p_query: "Sven Enskild" }))[0].org_number).toBe("198001011234");
    });
  });

  it("label batches: ordered → printed (codes) → shipped; cancel only while ordered; codes are superadmin-only", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      const b = await t.rpc("order_labels", { p_org_id: ORGS.dealer, p_quantity: 10 });
      await t.as("support");
      const list = await t.rpc<any[]>("admin_list_label_batches", { p_status: "ordered" });
      expect(list.find((x) => x.id === b.id)).toMatchObject({ quantity: 10, ordered_by: expect.objectContaining({ id: ORGS.dealer }) });
      expect((await t.rpcError("admin_label_batch_codes", { p_batch_id: b.id })).code).toBe("FORBIDDEN");
      await t.as("operator");
      expect((await t.rpcError("admin_label_batch_codes", { p_batch_id: b.id })).code).toBe("NOT_FOUND");
      expect((await t.rpcError("admin_set_label_batch_status", { p_batch_id: b.id, p_status: "shipped" })).code).toBe("INVALID_STATE");
      await t.rpc("print_label_batch", { p_batch_id: b.id, p_printer_ref: "Tryckeri AB #7" });
      const codes = await t.rpc<string[]>("admin_label_batch_codes", { p_batch_id: b.id });
      expect(codes).toHaveLength(10);
      expect((await t.rpcError("admin_set_label_batch_status", { p_batch_id: b.id, p_status: "cancelled" })).code).toBe("INVALID_STATE");
      expect((await t.rpc("admin_set_label_batch_status", { p_batch_id: b.id, p_status: "shipped" })).status).toBe("shipped");
      await t.as("dealer");
      expect((await t.rpc<any[]>("list_notifications")).map((n) => n.type)).toContain("labels.shipped");
    });
  });

  it("support search finds org, user and machine (reg or serial) and is audited", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.as("support");
      expect((await t.rpcError("admin_support_search", { p_query: "ab" })).code).toBe("VALIDATION");
      const byReg = await t.rpc("admin_support_search", { p_query: m.reg_number.toLowerCase() });
      expect(byReg.machines[0]).toMatchObject({ id: m.id, owner: expect.objectContaining({ id: ORGS.owner_a }) });
      const serial = await t.val<string>("select value from public.machine_identifiers where machine_id = $1 limit 1", [m.id]);
      expect((await t.rpc("admin_support_search", { p_query: serial })).machines[0].id).toBe(m.id);
      const byUser = await t.rpc("admin_support_search", { p_query: "owner_a@test" });
      expect(byUser.users[0].orgs[0]).toMatchObject({ id: ORGS.owner_a });
      await t.as(null);
      expect(await t.val("select count(*)::int from public.operator_audit where action = 'support.search'")).toBe(3);
      await expect(t.q("update public.operator_audit set action = 'x.y.z'")).rejects.toThrow(/AUDIT_APPEND_ONLY/);
    });
  });

  it("API usage, system health and market overview return data for support", async () => {
    await tx(async (t) => {
      await t.as(null);
      await t.q(`insert into public.api_requests (org_id, endpoint, method, status_code, latency_ms) values
        ($1, '/machines/{id}', 'GET', 200, 40), ($1, '/machines/{id}', 'GET', 429, 5), ($1, '/checks', 'POST', 200, 120)`, [ORGS.financier_a]);
      await t.as("support");
      const u = await t.rpc("admin_api_usage", { p_days: 7 });
      expect(u.per_org[0]).toMatchObject({ org: expect.objectContaining({ id: ORGS.financier_a }), requests: 3, errors: 1, rate_limited: 1 });
      expect(u.top_endpoints[0]).toMatchObject({ endpoint: "GET /machines/{id}", requests: 2 });
      const h = await t.rpc("admin_system_health", {});
      expect(h.chain).toMatchObject({ ok: true });
      expect(h.flags).toMatchObject({ FEATURE_MARKET: true });
      const mk = await t.rpc("admin_market_overview", {});
      expect(mk.sources.map((s: any) => s.key)).toEqual(expect.arrayContaining(["mascus", "partner-feed"]));
    });
  });
});
