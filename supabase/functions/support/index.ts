// Edge Function: support (step 22) – contact form for people without an account. Rate limited per IP hash.
import { serviceClient } from "../_shared/db.ts";
import { ipHash, json, preflight, rpcError } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });
  const b = await req.json().catch(() => ({}));
  const { data, error } = await serviceClient().rpc("submit_public_support", {
    p_email: String(b.email ?? "").slice(0, 200), p_category: String(b.category ?? "other"), p_subject: String(b.subject ?? "").slice(0, 200),
    p_body: String(b.body ?? "").slice(0, 5000), p_ip_hash: await ipHash(req),
  });
  if (error) return rpcError(error);
  return json(200, data);
});
