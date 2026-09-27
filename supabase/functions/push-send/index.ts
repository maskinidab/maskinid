// Edge Function: push-send (step 24, ADR 0021) – run every minute by the scheduler (CRON_SECRET or service key).
// Claims queued push messages, renders the texts in the user's language and sends them with the PushSender adapter
// (Web Push with VAPID, or the mock in DEMO_MODE). Expired subscriptions (404/410) are removed by record_push_result.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { renderPush } from "../_shared/shared/email/render.ts";
import { envRecord, serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

interface Claimed { id: string; type: string; data: Record<string, unknown>; link: string | null; severity: string; endpoint: string; p256dh: string; auth: string; locale: string }

Deno.serve(withSentry("push-send", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const svc = serviceClient();
  const { push } = createAdapters(envRecord());
  const { data, error } = await svc.rpc("claim_push_outbox", { p_limit: 200 });
  if (error) return json(500, { code: "CLAIM_FAILED" });
  let sent = 0;
  let failed = 0;
  for (const m of (data ?? []) as Claimed[]) {
    const msg = renderPush({ type: m.type, data: m.data, link: m.link, locale: m.locale });
    try {
      const r = await push.send({ endpoint: m.endpoint, p256dh: m.p256dh, auth: m.auth }, { ...msg, severity: m.severity },
        { urgency: m.severity === "critical" ? "high" : "normal" });
      await svc.rpc("record_push_result", { p_id: m.id, p_ok: r.ok, p_gone: r.gone, p_error: r.ok ? null : `HTTP ${r.status}` });
      if (r.ok) sent++; else failed++;
    } catch (e) {
      failed++;
      await svc.rpc("record_push_result", { p_id: m.id, p_ok: false, p_gone: false, p_error: String(e).slice(0, 200) });
    }
  }
  return json(200, { sent, failed });
}));
