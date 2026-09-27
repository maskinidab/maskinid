import { describe, expect, it } from "vitest";
import vectors from "../../packages/shared/src/testdata/regnr-vectors.json" with { type: "json" };
import { tx } from "./helpers.ts";

describe("foundation (step 1)", () => {
  it("SQL reg_check_char matches the shared TypeScript vectors", async () => {
    await tx(async (t) => {
      for (const [payload, check] of Object.entries(vectors as Record<string, string>)) {
        expect(await t.val("select app.reg_check_char($1)", [payload])).toBe(check);
      }
    });
  });

  it("generates valid, mixed registration numbers", async () => {
    await tx(async (t) => {
      const regs = await t.q<{ r: string }>("select app.generate_reg_number() r from generate_series(1, 300)");
      for (const { r } of regs) {
        expect(r).toMatch(/^[2-9A-HJ-NP-Z]{7}$/);
        expect(await t.val("select app.is_valid_reg_number($1)", [r])).toBe(true);
        expect(r.slice(0, 3)).toMatch(/[2-9]/);
        expect(r.slice(0, 3)).toMatch(/[A-Z]/);
        expect(r.slice(3)).toMatch(/[2-9]/);
        expect(r.slice(3)).toMatch(/[A-Z]/);
      }
      expect(await t.val("select app.is_valid_reg_number($1)", ["ABC-DEF0"])).toBe(false);
    });
  });

  it("label codes are 22 characters base62", async () => {
    await tx(async (t) => {
      const codes = await t.q<{ c: string }>("select app.generate_label_code() c from generate_series(1, 100)");
      for (const { c } of codes) expect(c).toMatch(/^[0-9A-Za-z]{22}$/);
      expect(new Set(codes.map((x) => x.c)).size).toBe(100);
    });
  });

  it("feature flags are readable by anon, app_config is not writable", async () => {
    await tx(async (t) => {
      await t.as("anon");
      const cfg = await t.rpc<Record<string, unknown>>("get_app_config");
      expect(cfg.DEMO_MODE).toBe(true);
      const err = await t.error(() => t.q("update public.app_config set value = 'false' where key = 'DEMO_MODE'"));
      expect(err.code).toMatch(/permission denied/);
    });
  });
});

describe("events append-only hash chain (SPEC §16 points 6–7)", () => {
  it("chains hashes and verifies end to end", async () => {
    await tx(async (t) => {
      for (let i = 0; i < 5; i++) {
        await t.q("select app.log_event('test.event', null, null, null, $1)", [JSON.stringify({ i })]);
      }
      const rows = await t.q<{ seq: string; prev_hash: string | null; hash: string }>(
        "select seq, prev_hash, hash from public.events order by seq",
      );
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.hash);
      const v = await t.val<{ ok: boolean; checked: number }>("select app.verify_chain()");
      expect(v.ok).toBe(true);
      expect(v.checked).toBe(rows.length);
    });
  });

  it("UPDATE/DELETE/TRUNCATE raise for every role, including service_role and the owner", async () => {
    await tx(async (t) => {
      await t.q("select app.log_event('test.event', null, null, null, '{}')");
      for (const who of [null, "service", "anon"] as const) {
        await t.as(who);
        const u = await t.error(() => t.q("update public.events set payload = '{\"x\":1}'"));
        expect(u.code).toMatch(/EVENTS_APPEND_ONLY|permission denied/);
        const d = await t.error(() => t.q("delete from public.events"));
        expect(d.code).toMatch(/EVENTS_APPEND_ONLY|permission denied/);
      }
      await t.as(null);
      const tr = await t.error(() => t.q("truncate public.events"));
      expect(tr.code).toMatch(/EVENTS_APPEND_ONLY/);
    });
  });

  it("detects a manipulated row", async () => {
    await tx(async (t) => {
      for (let i = 0; i < 4; i++) await t.q("select app.log_event('test.event', null, null, null, $1)", [JSON.stringify({ i })]);
      const target = await t.val<string>("select seq from public.events order by seq desc offset 1 limit 1");
      // Only the table owner can bypass the trigger, and only by disabling it (never done by the app).
      await t.q("alter table public.events disable trigger events_no_update");
      await t.q("update public.events set payload = '{\"i\":999}' where seq = $1", [target]);
      await t.q("alter table public.events enable trigger events_no_update");
      const v = await t.val<{ ok: boolean; bad_seq: number; reason: string }>("select app.verify_chain()");
      expect(v.ok).toBe(false);
      expect(String(v.bad_seq)).toBe(String(target));
      expect(v.reason).toBe("hash_mismatch");
    });
  });

  it("detects a broken link (rehashed row)", async () => {
    await tx(async (t) => {
      for (let i = 0; i < 4; i++) await t.q("select app.log_event('test.event', null, null, null, $1)", [JSON.stringify({ i })]);
      const target = await t.val<string>("select seq from public.events order by seq desc offset 1 limit 1");
      await t.q("alter table public.events disable trigger events_no_update");
      await t.q("update public.events set payload = '{\"i\":999}' where seq = $1", [target]);
      await t.q("update public.events e set hash = app.event_hash(e) where seq = $1", [target]);
      await t.q("alter table public.events enable trigger events_no_update");
      const v = await t.val<{ ok: boolean; bad_seq: number; reason: string }>("select app.verify_chain()");
      expect(v.ok).toBe(false);
      expect(v.reason).toBe("broken_link");
      expect(Number(v.bad_seq)).toBe(Number(target) + 1);
    });
  });

  it("computes and verifies a daily Merkle anchor", async () => {
    await tx(async (t) => {
      for (let i = 0; i < 3; i++) await t.q("select app.log_event('test.event', null, null, null, $1)", [JSON.stringify({ i })]);
      const a = await t.one<{ root_hash: string; event_count: number }>("select * from app.compute_anchor(current_date)");
      expect(a.root_hash).toMatch(/^[0-9a-f]{64}$/);
      await t.as("anon");
      const v = await t.rpc<{ ok: boolean }>("verify_anchor", { p_day: new Date().toISOString().slice(0, 10) });
      expect(v.ok).toBe(true);
    });
  });

  it("anon and authenticated cannot read events without a policy", async () => {
    await tx(async (t) => {
      await t.q("select app.log_event('test.event', null, null, null, '{}')");
      await t.as("anon");
      const e = await t.error(() => t.q("select * from public.events"));
      expect(e.code).toMatch(/permission denied/);
    });
  });
});
