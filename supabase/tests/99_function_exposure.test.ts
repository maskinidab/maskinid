import { describe, expect, it } from "vitest";
import { tx } from "./helpers.ts";

// Every function that anon or authenticated can execute must be deliberate. When a step adds an RPC,
// add it here – a missing entry means a function was exposed (or hidden) by accident.
const ANON = [
  "public.get_app_config",
  "public.list_event_anchors",
  "public.verify_anchor",
];

const SERVICE_ONLY = ["public.record_company_lookup", "public.record_identity_verification"];

describe("function exposure", () => {
  it("anon can execute exactly the public RPCs", async () => {
    await tx(async (t) => {
      const rows = await t.q<{ f: string }>(`
        select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
      expect(rows.map((r) => r.f).filter((f, i, a) => a.indexOf(f) === i)).toEqual([...ANON].sort());
    });
  });

  it("service-only RPCs are not executable by authenticated", async () => {
    await tx(async (t) => {
      for (const f of SERVICE_ONLY) {
        const rows = await t.q<{ ok: boolean }>(`
          select has_function_privilege('authenticated', p.oid, 'execute') ok from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = $1`, [f]);
        expect(rows.length, f).toBeGreaterThan(0);
        for (const r of rows) expect(r.ok, f).toBe(false);
      }
    });
  });

  it("every public function is security definer with a fixed search_path", async () => {
    await tx(async (t) => {
      const rows = await t.q<{ f: string }>(`
        select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and (not p.prosecdef or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))`);
      expect(rows.map((r) => r.f)).toEqual([]);
    });
  });
});
