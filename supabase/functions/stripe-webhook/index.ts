// Edge Function: stripe-webhook (step 23, ADR 0020) – Stripe calls this with a signed event. The signature is verified
// by the Payments adapter; the event is stored idempotently and applied by billing_record_event (service role).
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, serviceClient } from "../_shared/db.ts";
import { json, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("stripe-webhook", async (req) => {
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });
  const { payments } = createAdapters(envRecord());
  if (payments.name !== "stripe") return json(404, { code: "NOT_FOUND" });
  const body = await req.text();
  let event;
  try {
    event = await payments.verifyWebhook(body, req.headers.get("stripe-signature"));
  } catch {
    return json(400, { code: "SIGNATURE_INVALID" });
  }
  const { data, error } = await serviceClient().rpc("billing_record_event", {
    p_provider: "stripe", p_event_id: event.id, p_type: event.type, p_payload: event.payload,
  });
  if (error) return rpcError(error);
  return json(200, data);
}));
