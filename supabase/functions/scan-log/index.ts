// Edge Function: scan-log (SPEC §5.3, §11.3, §16.11)
//
// Public, rate-limited entry point for /m/:code and /r/:reg. Returns only the public card, logs the access
// (viewer_type public, via scan), and – for stolen machines – notifies owner and flagger with the consented location.
// Rate limit: 30/min and 300/day per IP (hashed) ⇒ 429. Also handles "Jag har sett maskinen" (POST {sighting:true}).
//
//   GET  /scan-log?code=<label code>   or   ?reg=<reg number>
//   POST /scan-log  { code | reg, location?: {lat,lng,city}, sighting?: true, message?, contact?, nfc_uid? }
// With nfc_uid (Web NFC chip serial, step 25) the response also carries nfc: match | mismatch | unknown.
import { serviceClient } from "../_shared/db.ts";
import { ipHash, json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

function uaFamily(ua: string | null): string {
  if (!ua) return "unknown";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "other";
}

Deno.serve(withSentry("scan-log", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const code = (body.code ?? url.searchParams.get("code")) || null;
  const reg = (body.reg ?? url.searchParams.get("reg")) || null;
  if (!code && !reg) return json(400, { code: "VALIDATION" });
  const db = serviceClient();
  const ip = await ipHash(req);
  const location = body.location && typeof body.location === "object" ? body.location : null;
  const { data, error } = body.sighting
    ? await db.rpc("report_sighting", { p_code: code, p_reg: reg, p_ip_hash: ip, p_location: location, p_message: body.message ?? null, p_contact: body.contact ?? null })
    : await db.rpc("log_public_scan", { p_code: code, p_reg: reg, p_ip_hash: ip, p_user_agent_family: uaFamily(req.headers.get("user-agent")), p_location: location });
  if (error) {
    const res = rpcError(error);
    if (res.status === 429) res.headers.set("Retry-After", "60");
    return res;
  }
  let nfc: string | undefined;
  if (code && typeof body.nfc_uid === "string") {
    const r = await db.rpc("check_nfc_tag", { p_code: code, p_uid: body.nfc_uid, p_ip_hash: ip });
    nfc = (r.data as { result?: string } | null)?.result;
  }
  return json(200, nfc ? { ...(data as Record<string, unknown>), nfc } : data, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
}));
