// Edge Function: telematics-sync (step 25, ADR 0022) – scheduled every 15 minutes (CRON_SECRET or service key).
// For each due connection it fetches the ISO 15143-3 fleet snapshot (CareTrack, Komtrax, Trackunit) or the demo mock
// and hands the normalised readings to telematics_ingest, which matches the org's own machines only.
import { telematicsFor, type TelematicsConnection } from "../_shared/shared/adapters/telematics.ts";
import { serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const svc = serviceClient();
  const { data, error } = await svc.rpc("telematics_due_connections", { p_limit: 20 });
  if (error) return json(500, { code: "LIST_FAILED" });
  const results: Record<string, unknown>[] = [];
  for (const c of (data ?? []) as (TelematicsConnection & { id: string })[]) {
    try {
      const readings = await telematicsFor(c).fetch(c);
      const r = await svc.rpc("telematics_ingest", { p_connection_id: c.id, p_readings: readings });
      results.push({ id: c.id, ...(r.data ?? {}) });
    } catch (e) {
      await svc.rpc("telematics_ingest", { p_connection_id: c.id, p_readings: [], p_error: String((e as Error).message ?? e).slice(0, 200) });
      results.push({ id: c.id, error: true });
    }
  }
  return json(200, { synced: results.length, results });
});
