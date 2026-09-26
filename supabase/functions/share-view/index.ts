// Edge Function: share-view (SPEC §6.10) – public, rate-limited view of a share link (/s/:token).
import { serviceClient } from "../_shared/db.ts";
import { ipHash, json, preflight, rpcError } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const token = new URL(req.url).searchParams.get("token");
  if (!token || token.length > 128) return json(400, { code: "VALIDATION" });
  // ?report=1 issues a numbered machine report (R-…) for a buyer_report link; the PDF is rendered by the client.
  if (new URL(req.url).searchParams.get("report") === "1") {
    const { data, error } = await serviceClient().rpc("create_shared_machine_report", { p_token: token, p_ip_hash: await ipHash(req) });
    if (error) return rpcError(error);
    return json(200, data, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
  }
  const { data, error } = await serviceClient().rpc("get_share_view", { p_token: token, p_ip_hash: await ipHash(req) });
  if (error) return rpcError(error);
  return json(data.ok ? 200 : 404, data, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
});
