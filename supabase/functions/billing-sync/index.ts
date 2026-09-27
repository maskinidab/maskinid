// Edge Function: billing-sync (step 23, ADR 0020) – scheduled (CRON_SECRET or service key).
// Day 1 of the month it closes the previous period (close_billing_period is idempotent), then it pushes open invoices
// of customers with a Stripe customer id to Stripe for collection and stores the provider id and hosted URL.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { lineDescription, type InvoiceLine } from "../_shared/shared/billing.ts";
import { translator } from "../_shared/shared/i18n/index.ts";
import { envRecord, serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("billing-sync", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const svc = serviceClient();
  const { payments } = createAdapters(envRecord());
  const closed = await svc.rpc("close_billing_period", {});
  const { data: pending, error } = await svc.rpc("billing_pending_invoices");
  if (error) return json(500, { code: "LIST_FAILED" });
  const t = translator("sv");
  let pushed = 0;
  const failed: string[] = [];
  for (const inv of (pending ?? []) as { id: string; number: string; customer_id: string | null; lines: InvoiceLine[]; due_date: string }[]) {
    if (!inv.customer_id || payments.name !== "stripe") continue;
    try {
      const days = Math.max(1, Math.round((Date.parse(inv.due_date) - Date.now()) / 86_400_000));
      const r = await payments.createInvoice({
        customerId: inv.customer_id, invoiceId: inv.id, number: inv.number, daysUntilDue: days,
        lines: inv.lines.map((l) => ({ description: lineDescription(l, t), amountOre: l.amount_ore })),
      });
      await svc.rpc("billing_set_invoice_provider", { p_invoice_id: inv.id, p_provider_invoice_id: r.providerInvoiceId, p_url: r.url });
      pushed++;
    } catch {
      failed.push(inv.number);
    }
  }
  return json(200, { closed: closed.data ?? null, pushed, failed });
}));
