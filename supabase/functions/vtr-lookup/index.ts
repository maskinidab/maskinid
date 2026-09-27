// Edge Function: vtr-lookup (step 25, SPEC §4.2) – looks up a road registration number (tractors, motorredskap) at
// Transportstyrelsen through the VehicleRegistryLookup adapter and caches it; lookup_vehicle_registry then reads the
// cache. Personal data (owner name/number/address) is dropped by the adapter and again by record_vtr_lookup.
// DEMO_MODE: the database answers with mock data itself.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, serviceClient, userClient } from "../_shared/db.ts";
import { json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("vtr-lookup", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const user = userClient(req);
  const ctx = await user.rpc("my_context");
  if (ctx.error || !ctx.data) return json(401, { code: "NOT_AUTHENTICATED" });
  const body = await req.json().catch(() => ({}));
  const reg = String(body.road_reg ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z]{3}[0-9]{2}[0-9A-Z]$/.test(reg)) return json(422, { code: "VALIDATION", detail: { field: "road_reg" } });
  const { vehicleRegistry } = createAdapters(envRecord());
  if (vehicleRegistry.name !== "mock") {
    const svc = serviceClient();
    const rl = await svc.rpc("rate_limit_check", { p_key: `vtr_lookup:${ctx.data.user_id}`, p_limit: 60, p_window_seconds: 3600 });
    if (rl.data === false) return json(429, { code: "RATE_LIMITED" });
    try {
      const snap = await vehicleRegistry.lookup(reg);
      if (!snap) return json(404, { code: "NOT_FOUND" });
      const { error } = await svc.rpc("record_vtr_lookup", { p_road_reg: reg, p_snapshot: snap });
      if (error) return rpcError(error);
    } catch (e) {
      console.error("vtr-lookup failed", (e as Error).message);
      return json(502, { code: "LOOKUP_UNAVAILABLE" });
    }
  }
  const { data, error } = await user.rpc("lookup_vehicle_registry", { p_road_reg: reg });
  if (error) return rpcError(error);
  return json(200, data);
}));
