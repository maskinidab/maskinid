// Edge Function: webhook-dispatch (SPEC §12) – run every minute by the scheduler (CRON_SECRET or service key).
// Signs each delivery: header MaskinID-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>.
// Retries 5 times with backoff (recorded by record_webhook_result); redirects are not followed (SSRF).
import { serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}

Deno.serve(withSentry("webhook-dispatch", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const svc = serviceClient();
  const { data, error } = await svc.rpc("claim_webhook_deliveries", { p_limit: 50 });
  if (error) return json(500, { code: "CLAIM_FAILED" });
  let ok = 0;
  let failed = 0;
  await Promise.all((data as { id: string; url: string; secret: string; event_type: string; payload: unknown }[]).map(async (d) => {
    const body = JSON.stringify(d.payload);
    try {
      const res = await fetch(d.url, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "User-Agent": "MaskinID-Webhooks/1", "MaskinID-Event": d.event_type,
          "MaskinID-Delivery": d.id, "MaskinID-Signature": await signPayload(d.secret, body) },
        body,
      });
      const success = res.status >= 200 && res.status < 300;
      await svc.rpc("record_webhook_result", { p_delivery_id: d.id, p_ok: success, p_status: res.status, p_error: success ? null : `HTTP ${res.status}` });
      success ? ok++ : failed++;
    } catch (e) {
      await svc.rpc("record_webhook_result", { p_delivery_id: d.id, p_ok: false, p_status: null, p_error: (e as Error).name });
      failed++;
    }
  }));
  return json(200, { delivered: ok, failed });
}));
