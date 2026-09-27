// Edge Function: billing (step 23, ADR 0020) – called by a signed-in org admin.
//   { action: "checkout", org_id, plan }  ⇒ Stripe Checkout (test mode) or, with the mock, activates the plan at once
//   { action: "portal", org_id }          ⇒ Stripe customer portal (card, cancellation)
// Authorisation is done by the RPC billing_checkout_context running as the user; the service key is only used to apply
// the mock subscription.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { APP_BASE_URL } from "../_shared/shared/config.ts";
import { envRecord, serviceClient, userClient } from "../_shared/db.ts";
import { json, preflight, rpcError } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("billing", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });
  const b = await req.json().catch(() => ({}));
  const { payments } = createAdapters(envRecord());
  const base = Deno.env.get("PUBLIC_APP_URL") ?? APP_BASE_URL;
  const user = userClient(req);

  if (b.action === "checkout") {
    const { data: ctx, error } = await user.rpc("billing_checkout_context", { p_org_id: b.org_id, p_plan_key: b.plan });
    if (error) return rpcError(error);
    const back = `${base}/o/${ctx.org_slug}/settings?tab=billing`;
    const s = await payments.createCheckout({
      orgId: ctx.org_id, planKey: ctx.plan.key, email: ctx.email, customerId: ctx.customer_id, successUrl: back, cancelUrl: back,
    });
    if (payments.name === "mock") {
      const { error: e2 } = await serviceClient().rpc("billing_apply_subscription", {
        p_org_id: ctx.org_id, p_plan_key: ctx.plan.key, p_status: "active", p_provider: "mock",
        p_customer_id: `cus_mock_${ctx.org_id.slice(0, 8)}`, p_subscription_id: s.sessionId, p_period_end: null,
      });
      if (e2) return rpcError(e2);
    }
    return json(200, { url: s.url, provider: payments.name });
  }

  if (b.action === "portal") {
    const { data: bill, error } = await user.rpc("get_billing", { p_org_id: b.org_id });
    if (error) return rpcError(error);
    const { data: ctx } = await serviceClient().from("subscriptions").select("provider_customer_id").eq("org_id", b.org_id).maybeSingle();
    const slug = (await serviceClient().from("organizations").select("slug").eq("id", b.org_id).single()).data?.slug;
    const back = `${base}/o/${slug}/settings?tab=billing`;
    if (!bill || !ctx?.provider_customer_id) return json(409, { code: "NO_PAYMENT_METHOD" });
    return json(200, await payments.createPortal(ctx.provider_customer_id, back));
  }
  return json(400, { code: "VALIDATION" });
}));
