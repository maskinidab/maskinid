import { describe, expect, it } from "vitest";
import { registerAs } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

describe("event access and history (step 4)", () => {
  it("owner sees its machine's events; owner B does not (SPEC §16.2)", async () => {
    await tx(async (t) => {
      const r = await registerAs(t, "owner_a");
      await t.as("owner_a");
      const h = await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: r.id });
      expect(h[0]).toMatchObject({ type: "machine.registered", actor_org: { id: ORGS.owner_a } });
      expect(h[0].actor_name).toBe("Olle Owner A");
      expect(await t.q("select seq from public.events where machine_id = $1", [r.id])).toHaveLength(1);
      await t.as("owner_b");
      expect(await t.q("select seq from public.events where machine_id = $1", [r.id])).toHaveLength(0);
      expect((await t.rpcError("get_machine_history", { p_org_id: ORGS.owner_b, p_machine_id: r.id })).code).toBe("NOT_FOUND");
      await t.as("authority");
      expect(await t.q("select seq from public.events where machine_id = $1", [r.id])).toHaveLength(1);
    });
  });

  it("org events are visible to members only", async () => {
    await tx(async (t) => {
      await t.as("owner_a");
      await t.rpc("update_org", { p_org_id: ORGS.owner_a, p_patch: { phone: "0701234567" } });
      const own = await t.rpc<any[]>("list_org_events", { p_org_id: ORGS.owner_a });
      expect(own[0].type).toBe("org.updated");
      await t.as("owner_b");
      expect(await t.q("select seq from public.events where org_id = $1 and type = 'org.updated'", [ORGS.owner_a])).toHaveLength(0);
    });
  });

  it("operators can verify the chain; others cannot", async () => {
    await tx(async (t) => {
      await registerAs(t, "owner_a");
      await t.as("support");
      expect((await t.rpc("admin_verify_chain")).ok).toBe(true);
      await t.as("owner_a");
      expect((await t.rpcError("admin_verify_chain")).code).toBe("FORBIDDEN");
    });
  });

  it("anchor_compute refuses to anchor a broken chain and alerts operators", async () => {
    await tx(async (t) => {
      await registerAs(t, "owner_a");
      await t.as(null);
      const seq = await t.val<string>("select max(seq) from public.events");
      await t.q("alter table public.events disable trigger events_no_update");
      await t.q("update public.events set payload = '{}' where seq = $1", [seq]);
      await t.q("alter table public.events enable trigger events_no_update");
      await t.as("service");
      const today = new Date().toISOString().slice(0, 10);
      const e = await t.rpcError("anchor_compute", { p_day: today });
      expect(e.code).toBe("CHAIN_BROKEN");
    });
  });

  it("anchor is computed, published once and verifiable by anyone", async () => {
    await tx(async (t) => {
      await registerAs(t, "owner_a");
      await t.as("service");
      const today = new Date().toISOString().slice(0, 10);
      const a = await t.rpc("anchor_compute", { p_day: today });
      expect(a.event_count).toBeGreaterThan(0);
      await t.rpc("anchor_mark_published", { p_day: today, p_external_ref: "https://github.com/x/anchors/commit/abc" });
      expect((await t.rpcError("anchor_mark_published", { p_day: today, p_external_ref: "again" })).code).toBe("NOT_FOUND");
      await t.as("anon");
      const v = await t.rpc("verify_anchor", { p_day: today });
      expect(v).toMatchObject({ ok: true, external_ref: "https://github.com/x/anchors/commit/abc" });
      const list = await t.rpc<any[]>("list_event_anchors");
      expect(list[0].day).toBe(today);
    });
  });
});
