// Edge Function: tip (step 22) – public tips about machines ("jag har sett maskinen", suspicious listing or sale).
// Rate limited per IP hash; a tip about a stolen machine reaches the owner and the flagging organisation at once.
import { serviceClient } from "../_shared/db.ts";
import { ipHash, json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("tip", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });
  const b = await req.json().catch(() => ({}));
  const { data, error } = await serviceClient().rpc("submit_tip", {
    p_kind: String(b.kind ?? "other"), p_reg_or_serial: b.reg_or_serial ? String(b.reg_or_serial).slice(0, 64) : null,
    p_message: String(b.message ?? "").slice(0, 2000), p_location: b.location && typeof b.location === "object" ? b.location : null,
    p_listing_url: b.listing_url ? String(b.listing_url).slice(0, 500) : null, p_contact: b.contact ? String(b.contact).slice(0, 200) : null,
    p_ip_hash: await ipHash(req),
  });
  if (error) return rpcError(error);
  return json(200, data);
}));
