import { describe, expect, it } from "vitest";
import { encumber, machineData, registerAs, serial } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

describe("statistics (step 24)", () => {
  it("public statistics are aggregates with small cells suppressed; operators see exact numbers", async () => {
    await tx(async (t) => {
      await registerAs(t, "owner_a", machineData({ fuel_type: "hydrogen" }));
      await t.as("anon");
      const s = await t.rpc<any>("public_statistics", {});
      expect(s.suppressed).toBe(true);
      expect(s.totals.machines).toBeGreaterThan(0);
      const cells = [...s.by_category, ...s.by_fuel, ...s.by_county, ...s.by_emission_stage];
      expect(cells.every((c: any) => c.n === null || c.n >= 5)).toBe(true);
      expect(s.environment.every((c: any) => c.n >= 5)).toBe(true);
      expect(s.registrations_by_month).toHaveLength(12);
      expect(JSON.stringify(s)).not.toMatch(/owner_org|org_number|Test Owner/);

      await t.as("verifier");
      const a = await t.rpc<any>("admin_statistics", {});
      expect(a.suppressed).toBe(false);
      expect(a.by_fuel.find((c: any) => c.key === "hydrogen")?.n).toBeGreaterThanOrEqual(1);
      expect(a.checks_by_month).toHaveLength(12);
      await t.as("owner_a");
      expect((await t.rpcError("admin_statistics", {})).code).toBe("FORBIDDEN");
    });
  });

  it("the daily snapshot is written by the service role only", async () => {
    await tx(async (t) => {
      await t.as("operator");
      expect((await t.rpcError("refresh_statistics", {})).code).toMatch(/FORBIDDEN|permission/i);
      await t.as("service");
      await t.rpc("refresh_statistics", {});
      await t.as("anon");
      expect((await t.rpc<any>("public_statistics", {})).generated_at).toBeTruthy();
      expect(await t.q("select * from public.statistics_snapshots")).toEqual([]);
    });
  });
});

describe("data export (step 24)", () => {
  it("an org admin exports the org's own data without secrets; others cannot", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData());
      await t.rpc("create_api_key", { p_org_id: ORGS.owner_a, p_name: "ERP", p_scopes: ["machines:read"] });
      const x = await t.rpc<any>("export_org_data", { p_org_id: ORGS.owner_a });
      expect(x.format).toBe("maskinid-export/1");
      expect(x.machines.map((r: any) => r.id)).toContain(m.id);
      expect(x.machine_identifiers.some((i: any) => i.machine_id === m.id)).toBe(true);
      expect(x.api_keys.length).toBeGreaterThan(0);
      const text = JSON.stringify(x);
      expect(text).not.toMatch(/key_hash|"secret"|token_hash|personal_number_hash|org_number_enc/);
      expect(x.machines.every((r: any) => r.owner_org_id === ORGS.owner_a)).toBe(true);
      expect(await t.val("select count(*)::int from public.events where type = 'org.data_exported' and org_id = $1", [ORGS.owner_a])).toBe(1);

      await t.as("owner_a_readonly");
      expect((await t.rpcError("export_org_data", { p_org_id: ORGS.owner_a })).code).toBe("FORBIDDEN");
      await t.as("owner_b");
      expect((await t.rpcError("export_org_data", { p_org_id: ORGS.owner_a })).code).toBe("FORBIDDEN");
    });
  });

  it("a person exports their own data; the BankID hash is never included", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      const x = await t.rpc<any>("export_my_data", {});
      expect(x.profile.email).toBeTruthy();
      expect(x.profile).not.toHaveProperty("personal_number_hash");
      expect(x.memberships.length).toBeGreaterThan(0);
      await t.as("anon");
      expect((await t.rpcError("export_my_data", {})).code).toMatch(/NOT_AUTHENTICATED|permission/i);
    });
  });
});

describe("web push (step 24)", () => {
  const sub = { p_endpoint: "https://push.example.com/send/abc123", p_p256dh: "B".repeat(87), p_auth: "a".repeat(22), p_ua_family: "Chrome" };

  it("a warning notification is queued to the user's devices; info is not by default; results update the queue", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      await t.rpc("save_push_subscription", sub);
      expect((await t.rpc<any[]>("list_my_push_subscriptions", {}))[0]).toMatchObject({ endpoint_host: "push.example.com", ua_family: "Chrome" });
      await t.as(null);
      const uid = await t.val<string>("select user_id from public.push_subscriptions where endpoint = $1", [sub.p_endpoint]);
      await t.q("select app.notify_user($1, $2, 'flag.stolen', '{\"reg_number\":\"ABC\"}', '/machines/x', 'warning')", [uid, ORGS.owner_a]);
      await t.q("select app.notify_user($1, $2, 'machine.verified', '{}', '/machines/x', 'info')", [uid, ORGS.owner_a]);
      await t.as("service");
      const claimed = await t.rpc<any[]>("claim_push_outbox", { p_limit: 10 });
      const mine = claimed.filter((c) => c.endpoint === sub.p_endpoint);
      expect(mine.map((c) => c.type)).toEqual(["flag.stolen"]);
      expect(mine[0]).toMatchObject({ p256dh: sub.p_p256dh, auth: sub.p_auth, locale: expect.any(String) });
      await t.rpc("record_push_result", { p_id: mine[0].id, p_ok: false, p_gone: false, p_error: "503" });
      expect(await t.val("select status from public.push_outbox where id = $1", [mine[0].id])).toBe("pending");
      await t.q("update public.push_outbox set next_attempt_at = now() where id = $1", [mine[0].id]);
      const again = (await t.rpc<any[]>("claim_push_outbox", { p_limit: 10 })).find((c) => c.id === mine[0].id);
      await t.rpc("record_push_result", { p_id: again.id, p_ok: false, p_gone: true });
      expect(await t.val("select count(*)::int from public.push_subscriptions where endpoint = $1", [sub.p_endpoint])).toBe(0);
    });
  });

  it("users manage only their own devices; service functions are closed", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      await t.rpc("save_push_subscription", sub);
      expect((await t.rpcError("save_push_subscription", { ...sub, p_endpoint: "http://insecure.example.com/x" })).code).toBe("VALIDATION");
      expect((await t.rpc<any>("send_test_push", {})).queued).toBe(1);
      await t.as("owner_b");
      expect((await t.rpc<any>("delete_push_subscription", { p_endpoint: sub.p_endpoint })).deleted).toBe(false);
      expect(await t.rpc<any[]>("list_my_push_subscriptions", {})).toEqual([]);
      expect((await t.rpcError("claim_push_outbox", {})).code).toMatch(/FORBIDDEN|permission/i);
      expect(await t.q("select * from public.push_subscriptions")).toEqual([]);
      await t.as("owner_a");
      expect((await t.rpc<any>("delete_push_subscription", { p_endpoint: sub.p_endpoint })).deleted).toBe(true);
    });
  });
});

describe("notification preferences 'all' (fix in step 24)", () => {
  it("event_types ['*'] sends every notification by e-mail and push, not none", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      await t.rpc("set_notification_preferences", { p_org_id: ORGS.owner_a, p_channel: "email", p_event_types: ["*"], p_digest: "instant", p_enabled: true });
      await t.as(null);
      const uid = await t.val<string>("select user_id from public.memberships where org_id = $1 and role = 'admin' and status = 'active' limit 1", [ORGS.owner_a]);
      const before = await t.val<number>("select count(*)::int from public.email_outbox where user_id = $1", [uid]);
      await t.q("select app.notify_user($1, $2, 'machine.verified', '{}', '/machines/x', 'info')", [uid, ORGS.owner_a]);
      expect(await t.val("select count(*)::int from public.email_outbox where user_id = $1", [uid])).toBe(before + 1);
    });
  });
});

describe("API sandbox (step 24)", () => {
  it("requests with a sandbox key are logged but never billed", async () => {
    await tx(async (t) => {
      await t.as("financier_a");
      const live = await t.rpc<any>("create_api_key", { p_org_id: ORGS.financier_a, p_name: "live", p_scopes: ["machines:read"] });
      const test = await t.rpc<any>("create_api_key", { p_org_id: ORGS.financier_a, p_name: "test", p_scopes: ["machines:read"], p_sandbox: true });
      await t.as("service");
      await t.q("insert into public.api_requests (api_key_id, org_id, endpoint, method, status_code) values ($1, $3, '/x', 'GET', 200), ($2, $3, '/x', 'GET', 200)",
        [live.id, test.id, ORGS.financier_a]);
      expect(await t.val("select count(*)::int from public.usage_records where org_id = $1 and metric = 'api_call'", [ORGS.financier_a])).toBe(1);
    });
  });
});

describe("partial search (step 24)", () => {
  it("professional roles find candidates from part of a serial, masked, without owner or financing", async () => {
    await tx(async (t) => {
      const s = serial("PX");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: s }] }));
      await encumber(t, "financier_b", m.id);
      await t.as("financier_a");
      const part = s.slice(3, 10);
      const r = await t.rpc<any[]>("partial_search", { p_org_id: ORGS.financier_a, p_query: part.toLowerCase() });
      const hit = r.find((x) => x.id === m.id);
      expect(hit).toMatchObject({ reg_number: m.reg_number, match_type: "serial" });
      expect(hit.match).toContain(part);
      expect(hit.match).toContain("•");
      expect(JSON.stringify(hit)).not.toMatch(/owner|financ|holder/);
      expect((await t.rpcError("partial_search", { p_org_id: ORGS.financier_a, p_query: "AB12" })).code).toBe("VALIDATION");
      await t.as("owner_b");
      expect((await t.rpcError("partial_search", { p_org_id: ORGS.owner_b, p_query: part })).code).toBe("FORBIDDEN");
    });
  });
});

describe("merge duplicate records (step 24)", () => {
  it("the operator merges a duplicate into the kept machine: data moves, the old record points to it, history follows", async () => {
    await tx(async (t) => {
      const keep = await registerAs(t, "owner_a", machineData());
      const dup = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: serial("DP") }, { type: "pin", value: serial("PIN") }] }));
      await t.rpc("record_hours", { p_org_id: ORGS.owner_a, p_machine_id: dup.id, p_hours: 4321 });
      await t.as("owner_b");
      expect((await t.rpcError("admin_merge_machines", { p_keep_id: keep.id, p_merge_id: dup.id, p_note: "x" })).code).toBe("FORBIDDEN");
      await t.as("verifier");
      expect((await t.rpcError("admin_merge_machines", { p_keep_id: keep.id, p_merge_id: dup.id, p_note: " " })).code).toBe("VALIDATION");
      const r = await t.rpc<any>("admin_merge_machines", { p_keep_id: keep.id, p_merge_id: dup.id, p_note: "Samma maskin registrerad två gånger" });
      expect(r.moved.machine_identifiers).toBe(2);
      await t.as("owner_a");
      const k = await t.rpc<any>("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: keep.id });
      expect(k.hour_meter).toBe(4321);
      expect(k.identifiers.length).toBe(3);
      const d = await t.rpc<any>("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: dup.id });
      expect(d.status).toBe("deregistered");
      expect(d.merged_into).toEqual({ id: keep.id, reg_number: keep.reg_number });
      const h = await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: keep.id });
      expect(h.some((e) => e.type === "machine.merged")).toBe(true);
      expect(h.some((e) => e.from_merged_record === dup.reg_number && e.type === "machine.registered")).toBe(true);
      await t.as("verifier");
      expect((await t.rpcError("admin_merge_machines", { p_keep_id: keep.id, p_merge_id: dup.id, p_note: "igen" })).code).toBe("VALIDATION");
    });
  });

  it("refuses to merge machines of different owners or with two active financings", async () => {
    await tx(async (t) => {
      const a = await registerAs(t, "owner_a", machineData());
      const b = await registerAs(t, "owner_b", machineData());
      const c = await registerAs(t, "owner_a", machineData());
      await encumber(t, "financier_a", a.id);
      await encumber(t, "financier_b", c.id);
      await t.as("verifier");
      expect((await t.rpcError("admin_merge_machines", { p_keep_id: a.id, p_merge_id: b.id, p_note: "x" })).code).toBe("VALIDATION");
      expect((await t.rpcError("admin_merge_machines", { p_keep_id: a.id, p_merge_id: c.id, p_note: "x" })).code).toBe("ACTIVE_ENCUMBRANCE_EXISTS");
    });
  });
});
