// Edge Function: lead (SPEC §7.2 "Leads") – "Kontakta säljare" on a dealer's ad page. Public, rate-limited per IP hash;
// the lead (name, contact, message – with consent) is only visible to the selling dealer.
import { serviceClient } from "../_shared/db.ts";
import { ipHash, json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("lead", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });
  const b = await req.json().catch(() => ({}));
  const { data, error } = await serviceClient().rpc("submit_lead", {
    p_reg: String(b.reg ?? ""), p_name: String(b.name ?? "").slice(0, 200), p_contact: String(b.contact ?? "").slice(0, 200),
    p_message: b.message ? String(b.message).slice(0, 2000) : null, p_consent: b.consent === true, p_ip_hash: await ipHash(req),
  });
  if (error) return rpcError(error);
  return json(200, data);
}));
