import { describe, expect, it } from "vitest";
import { tx } from "./helpers.ts";

// Every function that anon or authenticated can execute must be deliberate. When a step adds an RPC,
// add it here – a missing entry means a function was exposed (or hidden) by accident.
const ANON = [
  "public.authorize_document_download",
  "public.demo_shortcuts",
  "public.get_app_config",
  "public.list_event_anchors",
  "public.badge_data",
  "public.public_ad_card",
  "public.public_machine_card",
  "public.verify_anchor",
  "public.verify_check_receipt",
  "public.verify_report",
];

const SERVICE_ONLY = [
  "public.anchor_compute", "public.anchor_mark_published", "public.get_share_view", "public.log_public_scan",
  "public.record_company_lookup", "public.record_document_scan", "public.report_sighting",
  "public.record_identity_verification", "public.record_signature", "public.record_vtr_lookup", "public.rate_limit_check", "public.submit_lead", "public.resolve_api_key", "public.log_api_request",
  "public.api_idempotency_get", "public.api_idempotency_put", "public.claim_webhook_deliveries", "public.record_webhook_result",
  "public.start_market_run", "public.finish_market_run", "public.ingest_observations", "public.record_listing_serial", "public.claim_ocr_candidates",
  "public.create_shared_machine_report", "public.claim_email_outbox", "public.record_email_result",
];

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

  it("API parity: service_role can execute everything authenticated can (api-v1 calls the same RPCs)", async () => {
    await tx(async (t) => {
      const rows = await t.q<{ f: string }>(`
        select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('service_role', p.oid, 'execute')`);
      expect(rows.map((r) => r.f)).toEqual([]);
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

describe("authorisation NULL-safety", () => {
  // `if not (x.org_id = actor or …)` is skipped when the comparison yields NULL (e.g. a nullable org column), which
  // silently grants access. Use `if (…) is not true then` instead. Reviewed exceptions (non-null operands) are listed.
  const REVIEWED = new Set(["get_org", "list_org_members", "get_check_receipt"]);
  it("no negated org comparisons in authorisation checks", async () => {
    await tx(async (t) => {
      const rows = await t.q<{ f: string }>(`
        select distinct p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app') and p.prosrc ~ 'if not \\(([^;]*?_org_id[^;]*?)\\) then'`);
      expect(rows.map((r) => r.f).filter((f) => !REVIEWED.has(f))).toEqual([]);
    });
  });
});
