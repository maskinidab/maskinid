import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { machineData, registerAs, serial } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("API keys (SPEC §12)", () => {
  it("admin creates a scoped key shown once; resolve by hash; revoke", async () => {
    await tx(async (t) => {
      await t.as("financier_a");
      expect((await t.rpcError("create_api_key", { p_org_id: ORGS.financier_a, p_name: "X", p_scopes: ["root"] })).code).toBe("VALIDATION");
      const k = await t.rpc("create_api_key", { p_org_id: ORGS.financier_a, p_name: "Kreditsystem", p_scopes: ["checks:write", "machines:read"] });
      expect(k.key).toMatch(/^mk_live_[0-9a-f]{48}$/);
      const list = await t.rpc<any[]>("list_api_keys", { p_org_id: ORGS.financier_a });
      expect(JSON.stringify(list)).not.toContain(k.key);
      await t.as("service");
      const r = await t.rpc("resolve_api_key", { p_key_hash: sha(k.key) });
      expect(r).toMatchObject({ ok: true, org_id: ORGS.financier_a, scopes: ["checks:write", "machines:read"] });
      expect((await t.rpc("resolve_api_key", { p_key_hash: sha("mk_live_wrong") })).ok).toBe(false);
      await t.as("financier_a");
      await t.rpc("revoke_api_key", { p_org_id: ORGS.financier_a, p_api_key_id: k.id });
      await t.as("service");
      expect((await t.rpc("resolve_api_key", { p_key_hash: sha(k.key) })).error).toBe("NOT_AUTHENTICATED");
      await t.as("owner_a_readonly");
      expect((await t.rpcError("create_api_key", { p_org_id: ORGS.owner_a, p_name: "X", p_scopes: ["machines:read"] })).code).toBe("FORBIDDEN");
    });
  });

  it("a key acts as its org through the same RPCs, limited by scopes; encumbrance conflict is a 409 code", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: serial("API") }] }));
      await t.as("financier_a");
      const k = await t.rpc("create_api_key", { p_org_id: ORGS.financier_a, p_name: "K", p_scopes: ["checks:write"] });
      await t.as("service", { apiKeyId: k.id });
      const c = await t.rpc("perform_check", { p_org_id: ORGS.financier_a, p_query: { reg: m.reg_number } });
      expect(c.result.found).toBe(true);
      expect((await t.rpcError("register_encumbrance", { p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: "leasing", p_end_date: "2030-01-01" })).code).toBe("FORBIDDEN");
      expect((await t.rpcError("perform_check", { p_org_id: ORGS.financier_b, p_query: { reg: m.reg_number } })).code).toBe("FORBIDDEN");
      await t.as(null);
      const ev = await t.q<any>("select actor_type, payload from public.events where type = 'machine.checked' and machine_id = $1", [m.id]);
      expect(ev[0]).toMatchObject({ actor_type: "api", payload: { api_key_id: k.id } });
    });
  });

  it("rate limit per key and minute", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      const k = await t.rpc("create_api_key", { p_org_id: ORGS.dealer, p_name: "K", p_scopes: ["machines:read"] });
      await t.as(null);
      await t.q("update public.api_keys set rate_limit_per_min = 2 where id = $1", [k.id]);
      await t.as("service");
      const h = sha(k.key);
      expect((await t.rpc("resolve_api_key", { p_key_hash: h })).ok).toBe(true);
      expect((await t.rpc("resolve_api_key", { p_key_hash: h })).ok).toBe(true);
      expect((await t.rpc("resolve_api_key", { p_key_hash: h })).error).toBe("RATE_LIMITED");
    });
  });
});

describe("webhooks (SPEC §12)", () => {
  it("https-only, no private addresses; events create deliveries with retry and backoff; redeliver", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      for (const url of ["http://x.example/hook", "https://localhost/h", "https://127.0.0.1/h", "https://10.1.2.3/h", "https://192.168.1.1/h", "https://[::1]/h"]) {
        expect((await t.rpcError("create_webhook", { p_org_id: ORGS.owner_a, p_url: url })).code, url).toBe("VALIDATION");
      }
      const w = await t.rpc("create_webhook", { p_org_id: ORGS.owner_a, p_url: "https://hooks.example.se/maskinid", p_event_types: ["machine.registered"] });
      expect(w.secret).toMatch(/^whsec_/);
      expect(JSON.stringify(await t.rpc("list_webhooks", { p_org_id: ORGS.owner_a }))).not.toContain(w.secret);
      const ping = await t.rpc("test_webhook", { p_org_id: ORGS.owner_a, p_webhook_id: w.id });
      expect(ping.delivery_id).toBeTruthy();
      await t.as(null);
      await t.q("delete from public.webhook_deliveries where id = $1", [ping.delivery_id]);
      await t.as("owner_a");
      await registerAs(t, "owner_a");
      await t.as("service");
      let claimed = await t.rpc<any[]>("claim_webhook_deliveries", { p_limit: 10 });
      const mine = claimed.filter((c) => c.url === "https://hooks.example.se/maskinid");
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ event_type: "machine.registered", attempt: 1, secret: w.secret, payload: { type: "machine.registered", machine: { reg_number: expect.any(String) } } });
      await t.rpc("record_webhook_result", { p_delivery_id: mine[0].id, p_ok: false, p_status: 500, p_error: "boom" });
      expect(await t.rpc<any[]>("claim_webhook_deliveries", { p_limit: 10 })).toEqual([]);
      await t.as(null);
      await t.q("update public.webhook_deliveries set attempt = 5, next_retry_at = now() where id = $1", [mine[0].id]);
      await t.as("service");
      claimed = await t.rpc<any[]>("claim_webhook_deliveries", { p_limit: 10 });
      await t.rpc("record_webhook_result", { p_delivery_id: claimed[0].id, p_ok: false, p_status: 500, p_error: "boom" });
      await t.as("owner_a");
      const d = await t.rpc<any[]>("list_webhook_deliveries", { p_org_id: ORGS.owner_a });
      expect(d[0]).toMatchObject({ status: "failed", response_code: 500 });
      await t.rpc("redeliver_webhook", { p_org_id: ORGS.owner_a, p_delivery_id: d[0].id });
      expect((await t.rpc<any[]>("list_webhook_deliveries", { p_org_id: ORGS.owner_a }))[0]).toMatchObject({ status: "pending", attempt: 0 });
      await t.as("owner_b");
      expect((await t.rpcError("redeliver_webhook", { p_org_id: ORGS.owner_b, p_delivery_id: d[0].id })).code).toBe("NOT_FOUND");
    });
  });

  it("badge data is public and minimal", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      await t.as("anon");
      expect(await t.rpc("badge_data", { p_reg: m.reg_number })).toEqual({ found: true, reg_number: m.reg_number, status: "active", verification_level: 0, stolen: false });
      expect(await t.rpc("badge_data", { p_reg: "ZZZZZZZ" })).toEqual({ found: false });
    });
  });
});
