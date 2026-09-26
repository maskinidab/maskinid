// Edge Function: email-send (SPEC §13) – run every minute by the scheduler (CRON_SECRET or service key).
// Claims due messages from email_outbox, renders them with the shared sv/en templates and sends them through the
// Email adapter (Resend, or console in DEMO_MODE). Failures back off (record_email_result); unknown templates are skipped.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { renderEmail } from "../_shared/shared/email/render.ts";
import { APP_BASE_URL } from "../_shared/shared/config.ts";
import { envRecord, serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight } from "../_shared/http.ts";

interface Claimed { id: string; to_email: string; template: string; locale: string; data: Record<string, unknown>; attachments: unknown[] }

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const svc = serviceClient();
  const { email } = createAdapters(envRecord());
  const baseUrl = Deno.env.get("PUBLIC_APP_URL") ?? APP_BASE_URL;
  const { data, error } = await svc.rpc("claim_email_outbox", { p_limit: 50 });
  if (error) return json(500, { code: "CLAIM_FAILED" });
  let sent = 0, failed = 0, skipped = 0;
  for (const m of data as Claimed[]) {
    const r = renderEmail({ template: m.template, locale: m.locale, data: m.data }, { baseUrl });
    // SMS has no provider adapter yet (FEATURE_SMS, docs/OPEN_QUESTIONS.md) – recorded as skipped, never retried.
    if (!r || m.template === "sms") {
      await svc.rpc("record_email_result", { p_id: m.id, p_ok: false, p_error: r ? "sms_provider_missing" : "unknown_template", p_skip: true });
      skipped++;
      continue;
    }
    try {
      await email.send({ to: m.to_email, subject: r.subject, html: r.html, text: r.text });
      await svc.rpc("record_email_result", { p_id: m.id, p_ok: true });
      sent++;
    } catch (e) {
      await svc.rpc("record_email_result", { p_id: m.id, p_ok: false, p_error: (e as Error).message });
      failed++;
    }
  }
  return json(200, { sent, failed, skipped });
});
