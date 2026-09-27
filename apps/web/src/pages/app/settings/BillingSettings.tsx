import { formatSek } from "@maskinid/shared/billing.ts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import { backend } from "../../../lib/backend";
import { formatDate, formatMonth, formatMonthName } from "../../../lib/format";
import { invoicePdf, type InvoiceDetail } from "../../../lib/pdf/invoice";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { currentLocale } from "../../../i18n";
import { PlanCard, type Plan } from "../../public/PricingPage";

interface UsageRow { metric: string; used: number; included: number; billable: number; unit_price_ore: number; amount_ore: number }
interface InvoiceRow { id: string; number: string; period: string; total_ore: number; subtotal_ore: number; status: "open" | "paid" | "void"; due_date: string;
  overdue: boolean; provider: string | null; provider_url: string | null }
interface Billing {
  plan: Plan; subscription: { status: string; provider: string | null; has_payment_method: boolean; cancel_at_period_end: boolean } | null;
  billing_email: string | null; invoice_reference: string | null; period: string; usage: UsageRow[];
  estimate: { subtotal_ore: number; vat_ore: number; total_ore: number; vat_rate: number }; available_plans: Plan[]; invoices: InvoiceRow[];
  payments_enabled: boolean; demo: boolean;
}

const INVOICE_KIND = { open: "vantar", paid: "verifierad", void: "neutral" } as const;

export function InvoiceStatus({ inv }: { inv: Pick<InvoiceRow, "status" | "overdue"> }) {
  const { t } = useTranslation();
  if (inv.overdue) return <StatusBadge kind="sparr">{t("billing.overdue")}</StatusBadge>;
  return <StatusBadge kind={INVOICE_KIND[inv.status]}>{t(`billing.invoice_status.${inv.status}`)}</StatusBadge>;
}

export async function downloadInvoice(orgId: string | null, id: string, t: (k: string, v?: Record<string, unknown>) => string) {
  const inv = await rpc<InvoiceDetail>("get_invoice", { p_org_id: orgId, p_invoice_id: id });
  downloadBytes(await invoicePdf(inv, t as never, currentLocale()), `${inv.number}.pdf`);
}

/** Settings → Betalning (org admins): plan, usage this month, billing details and invoices. */
export function BillingSettings() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const loc = currentLocale();
  const [params, setParams] = useSearchParams();
  const q = useRpc<Billing>("get_billing", { p_org_id: orgId });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const choose = useRpcMutation<{ p_org_id: string; p_plan_key: string }>("choose_plan");
  const pay = useRpcMutation<{ p_org_id: string; p_invoice_id: string }>("billing_mock_pay");
  const checkout = params.get("checkout");
  useEffect(() => { if (checkout) void queryClient.invalidateQueries({ queryKey: ["rpc"] }); }, [checkout]);

  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const b = q.data!;
  const kr = (ore: number) => formatSek(ore, loc);

  async function startCheckout(plan: string) {
    setBusy(plan);
    setError(null);
    try {
      const r = await backend.invoke<{ url: string }>("billing", { action: "checkout", org_id: orgId, plan });
      if (/^https?:/.test(r.url)) window.location.assign(r.url);
      else { setParams({ tab: "billing", checkout: "done" }, { replace: true }); await queryClient.invalidateQueries({ queryKey: ["rpc"] }); }
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  async function openPortal() {
    setError(null);
    try {
      const r = await backend.invoke<{ url: string }>("billing", { action: "portal", org_id: orgId });
      window.location.assign(r.url);
    } catch (e) { setError(e); }
  }

  return (
    <div className="stack-6">
      {checkout && <Notice kind="ok" title={t("billing.checkout_done", { plan: t(`billing.plan.${b.plan.key}.name`) })} />}
      {!b.payments_enabled && <Notice title={t("billing.payments_disabled")} />}
      {b.subscription?.status === "past_due" && <Notice kind="fel" title={t("billing.past_due")} />}
      <section className="stack-3" aria-labelledby="plan">
        <h2 id="plan" className="t-rubrik-4">{t("billing.your_plan")}</h2>
        <div className="plan-rutnat">
          {b.available_plans.map((p) => {
            const current = p.key === b.plan.key;
            return (
              <PlanCard key={p.key} plan={p} vatRate={b.estimate.vat_rate} current={current}
                action={current ? <p className="t-liten"><Icon name="bock" className="ikon-inline" /> {t("billing.current_plan")}</p>
                  : p.contact_sales ? <a className="mid-knapp mid-knapp-kontur" href="/contact">{t("billing.contact_us")}</a>
                    : <button type="button" className="mid-knapp mid-knapp-primar" disabled={!!busy || choose.isPending || (!!p.monthly_fee_ore && !b.payments_enabled)}
                        onClick={() => (p.monthly_fee_ore ? void startCheckout(p.key) : choose.mutate({ p_org_id: orgId, p_plan_key: p.key }))}>
                        {p.monthly_fee_ore ? t("billing.choose_paid") : t("billing.choose_free")}</button>} />
            );
          })}
        </div>
        {b.plan.key === "public_sector" && <Notice title={t("billing.public_sector_note")} />}
        {!!error && <ErrorNotice error={error} />}
        {choose.error && <ErrorNotice error={choose.error} />}
        {b.subscription?.has_payment_method && b.subscription.provider === "stripe" && (
          <div><button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => void openPortal()}>{t("billing.manage_payment")}</button></div>
        )}
      </section>

      <section className="stack-3" aria-labelledby="forbrukning">
        <h2 id="forbrukning" className="t-rubrik-4">{t("billing.usage_title", { month: formatMonthName(b.period) })}</h2>
        <div className="mid-tabell-wrap">
          <table className="mid-tabell">
            <caption className="visually-hidden">{t("billing.usage_title", { month: formatMonthName(b.period) })}</caption>
            <thead><tr>
              <th scope="col">{t("billing.item")}</th><th scope="col" className="tal">{t("billing.used")}</th><th scope="col" className="tal">{t("billing.included")}</th>
              <th scope="col" className="tal">{t("billing.unit_price")}</th><th scope="col" className="tal">{t("billing.amount_excl_vat")}</th>
            </tr></thead>
            <tbody>
              {b.plan.monthly_fee_ore > 0 && <tr><td>{t("billing.line.plan", { plan: t(`billing.plan.${b.plan.key}.name`) })}</td><td /><td /><td /><td className="tal">{kr(b.plan.monthly_fee_ore)}</td></tr>}
              {b.usage.map((u) => (
                <tr key={u.metric}><td>{t(`billing.metric.${u.metric}`)}</td><td className="tal">{u.used.toLocaleString("sv-SE")}</td><td className="tal">{u.included ? u.included.toLocaleString("sv-SE") : "–"}</td>
                  <td className="tal">{kr(u.unit_price_ore)}</td><td className="tal">{kr(u.amount_ore)}</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>{t("billing.subtotal_excl_vat")}</td><td className="tal">{kr(b.estimate.subtotal_ore)}</td></tr>
              <tr><td colSpan={4}>{t("billing.vat_amount", { rate: Math.round(b.estimate.vat_rate * 100) })}</td><td className="tal">{kr(b.estimate.vat_ore)}</td></tr>
              <tr><td colSpan={4}>{t("billing.estimate_total")}</td><td className="tal">{kr(b.estimate.total_ore)}</td></tr>
            </tfoot>
          </table>
        </div>
        <p className="t-liten t-sekundar">{t("billing.usage_hint")}</p>
      </section>

      <BillingDetails email={b.billing_email} reference={b.invoice_reference} />

      <section className="stack-3" aria-labelledby="fakturor">
        <h2 id="fakturor" className="t-rubrik-4">{t("billing.invoices")}</h2>
        {pay.error && <ErrorNotice error={pay.error} />}
        <DataTable caption={t("billing.invoices")} rows={b.invoices} getKey={(x) => x.id}
          empty={<EmptyState icon="dokument" title={t("billing.no_invoices")} />}
          columns={[
            { id: "number", header: t("billing.invoice_number"), value: (x) => x.number, cell: (x) => <span className="mid-id">{x.number}</span> },
            { id: "period", header: t("billing.pdf.period"), value: (x) => x.period, sortable: true, cell: (x) => formatMonth(x.period) },
            { id: "total", header: t("billing.total_incl_vat"), value: (x) => x.total_ore, cell: (x) => kr(x.total_ore) },
            { id: "due", header: t("billing.pdf.due"), value: (x) => x.due_date, hideOnMobile: true, cell: (x) => formatDate(x.due_date) },
            { id: "status", header: t("common.status"), value: (x) => x.status, cell: (x) => <InvoiceStatus inv={x} /> },
            { id: "actions", header: "", value: () => "", cell: (x) => (
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-kontur" onClick={() => void downloadInvoice(orgId, x.id, t)}>
                  <Icon name="nedladdning" />{t("billing.download_pdf")}</button>
                {x.status === "open" && x.provider_url && <a className="mid-knapp mid-knapp-liten mid-knapp-primar" href={x.provider_url} target="_blank" rel="noreferrer">{t("billing.pay")}</a>}
                {x.status === "open" && !x.provider_url && b.demo && (
                  <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-primar" disabled={pay.isPending}
                    onClick={() => pay.mutate({ p_org_id: orgId, p_invoice_id: x.id })}>{t("billing.pay_demo")}</button>
                )}
              </div>
            ) },
          ]} />
      </section>
    </div>
  );
}

function BillingDetails({ email, reference }: { email: string | null; reference: string | null }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [d, setD] = useState({ email: email ?? "", reference: reference ?? "" });
  const [saved, setSaved] = useState(false);
  const m = useRpcMutation<{ p_org_id: string; p_email: string; p_reference: string }>("set_billing_details", { onSuccess: () => setSaved(true) });
  return (
    <section className="stack-3" aria-labelledby="faktureringsuppgifter">
      <h2 id="faktureringsuppgifter" className="t-rubrik-4">{t("billing.details")}</h2>
      <form className="stack-3 smal-bred" onSubmit={(e) => { e.preventDefault(); setSaved(false); m.mutate({ p_org_id: orgId, p_email: d.email, p_reference: d.reference }); }}>
        <FormField label={t("billing.invoice_email")}><input className="mid-input" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></FormField>
        <FormField label={t("billing.reference")} optional hint={t("billing.reference_hint")}>
          <input className="mid-input" value={d.reference} maxLength={60} onChange={(e) => setD({ ...d, reference: e.target.value })} /></FormField>
        {m.error && <ErrorNotice error={m.error} />}
        {saved && <Notice kind="ok" title={t("common.saved")} />}
        <div><button type="submit" className="mid-knapp mid-knapp-sekundar" disabled={m.isPending}>{t("common.save")}</button></div>
      </form>
    </section>
  );
}
