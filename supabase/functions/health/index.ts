// Edge Function: health (step 26, ADR 0023) – for uptime monitoring. GET ⇒ 200 when the database answers and no
// scheduled job has failed three times in a row, else 503. No register data; only counts and job names.
import { serviceClient } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("health", async () => {
  const started = Date.now();
  try {
    const { data, error } = await serviceClient().rpc("health_check");
    if (error) return json(503, { ok: false, db: false }, { "Cache-Control": "no-store" });
    return json(data.ok ? 200 : 503, { ...data, latency_ms: Date.now() - started }, { "Cache-Control": "no-store" });
  } catch {
    return json(503, { ok: false, db: false }, { "Cache-Control": "no-store" });
  }
}));
