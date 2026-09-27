// Edge Function: theft-sync (step 25, SPEC §19.7, ADR 0022) – scheduled every 10 minutes (CRON_SECRET or service key).
// Pushes stolen/recovered flags to the theft register (Larmtjänst adapter, mock in DEMO_MODE) and pulls the register's
// new reports for matching. External reports never flag a machine automatically.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import type { TheftReport } from "../_shared/shared/adapters/types.ts";
import { envRecord, serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const svc = serviceClient();
  const { theftRegistry } = createAdapters(envRecord());
  const { data } = await svc.rpc("claim_theft_sync", { p_limit: 50 });
  let pushed = 0;
  for (const q of (data ?? []) as { id: string; report: TheftReport }[]) {
    try {
      const r = await theftRegistry.push(q.report);
      await svc.rpc("record_theft_sync_result", { p_id: q.id, p_ok: true, p_external_ref: r.externalRef });
      pushed++;
    } catch (e) {
      await svc.rpc("record_theft_sync_result", { p_id: q.id, p_ok: false, p_error: String((e as Error).message ?? e).slice(0, 200) });
    }
  }
  const since = new URL(req.url).searchParams.get("since") ?? new Date(Date.now() - 2 * 86_400_000).toISOString();
  let pulled = 0;
  try {
    const reports = await theftRegistry.pull(since);
    const r = await svc.rpc("ingest_external_theft_reports", { p_source: theftRegistry.name, p_reports: reports });
    pulled = (r.data as { new?: number } | null)?.new ?? 0;
  } catch (e) {
    console.error("theft-sync pull failed", (e as Error).message);
  }
  return json(200, { pushed, pulled });
});
