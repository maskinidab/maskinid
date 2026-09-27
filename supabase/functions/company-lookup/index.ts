// Edge Function: company-lookup (SPEC §2.2, §6.2). Looks up an organisation number with Roaring (Bolagsverket data)
// and caches the result; the lookup_company RPC then reads the cache. Signatories' personal numbers are hashed by the
// database (used to prove the right to claim an org, ADR 0009). DEMO_MODE: the database answers with mock data itself.
import { isValidOrgNumber, normalizeOrgNumber } from "../_shared/shared/identifiers.ts";
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, serviceClient, userClient } from "../_shared/db.ts";
import { json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("company-lookup", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const ctx = await userClient(req).rpc("my_context");
  if (ctx.error || !ctx.data) return json(401, { code: "NOT_AUTHENTICATED" });
  const body = await req.json().catch(() => ({}));
  if (!isValidOrgNumber(String(body.org_number ?? ""))) return json(422, { code: "VALIDATION", detail: { field: "org_number" } });
  const n = normalizeOrgNumber(String(body.org_number))!;
  const { company } = createAdapters(envRecord());
  if (company.name === "mock") return json(200, { cached: false, provider: "mock" });
  const svc = serviceClient();
  // Throttle per user: the lookup costs money and could be used to enumerate companies.
  const rl = await svc.rpc("rate_limit_check", { p_key: `company_lookup:${ctx.data.user_id}`, p_limit: 60, p_window_seconds: 3600 });
  if (rl.data === false) return json(429, { code: "RATE_LIMITED" });
  try {
    const info = await company.lookup(n);
    if (!info) return json(404, { code: "NOT_FOUND" });
    const { error } = await svc.rpc("record_company_lookup", {
      p_org_number: n,
      p_result: { name: info.name, city: info.city ?? null, address: info.address ?? null, is_sole_trader: info.isSoleTrader, source: info.source },
      p_signatories: info.signatories,
    });
    if (error) return rpcError(error);
    return json(200, { cached: true, provider: company.name });
  } catch (e) {
    console.error("company-lookup failed", (e as Error).message);
    return json(502, { code: "LOOKUP_UNAVAILABLE" });
  }
}));
