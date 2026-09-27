import { BILLING_METRICS, formatSek } from "@maskinid/shared/billing.ts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { useRpc, useRpcMutation } from "../../../lib/api/query";
import { formatDate, formatMonth } from "../../../lib/format";
import { currentLocale } from "../../../i18n";
import type { Plan } from "../../public/PricingPage";
import { downloadInvoice, InvoiceStatus } from "../settings/BillingSettings";
import { useAdmin } from "./useAdmin";

interface Overview {
  period: string; price_items: { key: string; unit_price_ore: number; updated_at: string }[];
  plans: (Plan & { active: boolean; orgs: number })[]; usage: Record<string, number>;
  invoices: { id: string; number: string; period: string; total_ore: number; status: "open" | "paid" | "void"; overdue: boolean; due_date: string; org: { name: string } }[];
  open_total_ore: number; payments_enabled: boolean;
}

/** Operator: price list and plans (superadmin edits), usage this month, invoices, closing a period. */
export function AdminBillingPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { atLeast } = useAdmin();
  const loc = currentLocale();
  const q = useRpc<Overview>("admin_billing_overview", {});
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [period, setPeriod] = useState(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
  const setPrice = useRpcMutation<{ p_key: string; p_unit_price_ore: number }>("admin_set_price", { onSuccess: (_d, a) => setEdit((e) => ({ ...e, [a.p_key]: "" })) });
  const close = useRpcMutation<{ p_period: string }, { created: number; period: string }>("admin_close_billing_period");
  const status = useRpcMutation<{ p_invoice_id: string; p_status: "paid" | "void" }>("admin_set_invoice_status");
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const o = q.data!;
  const kr = (ore: number) => formatSek(ore, loc);
  const superadmin = atLeast("superadmin");
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.billing.title")} lead={t("admin.billing.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      {!o.payments_enabled && <Notice title={t("billing.payments_disabled")} />}
      <dl className="nyckeltal">
        {BILLING_METRICS.map((m) => <div key={m}><dt>{t(`billing.metric.${m}`)}</dt><dd>{(o.usage[m] ?? 0).toLocaleString("sv-SE")}</dd><p className="nyckeltal-not">{formatMonth(o.period)}</p></div>)}
        <div><dt>{t("admin.billing.open_total")}</dt><dd>{kr(o.open_total_ore)}</dd></div>
      </dl>

      <section className="stack-3" aria-labelledby="prislista">
        <h2 id="prislista" className="t-rubrik-4">{t("billing.price_list")}</h2>
        <p className="t-liten t-sekundar">{t("billing.all_excl_vat")}</p>
        {setPrice.error && <ErrorNotice error={setPrice.error} />}
        <div className="mid-tabell-wrap">
          <table className="mid-tabell">
            <caption className="visually-hidden">{t("billing.price_list")}</caption>
            <thead><tr><th scope="col">{t("billing.item")}</th><th scope="col" className="tal">{t("billing.price_excl_vat")}</th><th scope="col">{t("admin.billing.updated")}</th>{superadmin && <th scope="col">{t("admin.billing.new_price")}</th>}</tr></thead>
            <tbody>
              {o.price_items.map((p) => (
                <tr key={p.key}>
                  <td>{t(`billing.metric.${p.key}`)}</td><td className="tal">{kr(p.unit_price_ore)}</td><td>{formatDate(p.updated_at)}</td>
                  {superadmin && (
                    <td>
                      <form className="mid-rad" onSubmit={(e) => { e.preventDefault(); setPrice.mutate({ p_key: p.key, p_unit_price_ore: Math.round(Number(edit[p.key].replace(",", ".")) * 100) }); }}>
                        <input className="mid-input" inputMode="decimal" aria-label={t("admin.billing.new_price_for", { name: t(`billing.metric.${p.key}`) })} value={edit[p.key] ?? ""}
                          onChange={(e) => setEdit({ ...edit, [p.key]: e.target.value })} style={{ maxWidth: "8rem" }} />
                        <button type="submit" className="mid-knapp mid-knapp-liten mid-knapp-kontur" disabled={!edit[p.key] || Number.isNaN(Number(edit[p.key].replace(",", ".")))}>{t("common.save")}</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack-3" aria-labelledby="planer">
        <h2 id="planer" className="t-rubrik-4">{t("admin.billing.plans")}</h2>
        <DataTable caption={t("admin.billing.plans")} rows={o.plans} getKey={(p) => p.key}
          columns={[
            { id: "name", header: t("billing.item"), value: (p) => p.key, cell: (p) => <strong>{t(`billing.plan.${p.key}.name`)}</strong> },
            { id: "fee", header: t("admin.billing.fee"), value: (p) => p.monthly_fee_ore, cell: (p) => (p.contact_sales ? t("billing.contact_sales") : kr(p.monthly_fee_ore)) },
            { id: "incl", header: t("billing.included"), value: () => "", cell: (p) => Object.entries(p.included).map(([k, v]) => `${v} ${t(`billing.included_name.${k}`)}`).join(", ") || "–" },
            { id: "orgs", header: t("admin.billing.subscribers"), value: (p) => p.orgs, sortable: true, cell: (p) => p.orgs },
          ]} />
      </section>

      {superadmin && (
        <section className="panel stack-3" aria-labelledby="stang">
          <h2 id="stang" className="t-rubrik-4">{t("admin.billing.close_title")}</h2>
          <p className="t-liten">{t("admin.billing.close_lead")}</p>
          <form className="mid-rad" onSubmit={(e) => { e.preventDefault(); close.mutate({ p_period: `${period}-01` }); }}>
            <FormField label={t("billing.pdf.period")}><input className="mid-input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></FormField>
            <div><button type="submit" className="mid-knapp mid-knapp-sekundar" disabled={close.isPending}>{t("admin.billing.close")}</button></div>
          </form>
          {close.data && <Notice kind="ok" title={t("admin.billing.closed", { count: close.data.created, month: formatMonth(close.data.period) })} />}
          {close.error && <ErrorNotice error={close.error} />}
        </section>
      )}

      <section className="stack-3" aria-labelledby="fakturor">
        <h2 id="fakturor" className="t-rubrik-4">{t("billing.invoices")}</h2>
        {status.error && <ErrorNotice error={status.error} />}
        <DataTable caption={t("billing.invoices")} rows={o.invoices} getKey={(x) => x.id} exportName="fakturor"
          empty={<EmptyState icon="dokument" title={t("billing.no_invoices")} />}
          columns={[
            { id: "number", header: t("billing.invoice_number"), value: (x) => x.number, cell: (x) => <span className="mid-id">{x.number}</span> },
            { id: "org", header: t("admin.tickets.from"), value: (x) => x.org?.name ?? "", sortable: true, cell: (x) => x.org?.name ?? "–" },
            { id: "period", header: t("billing.pdf.period"), value: (x) => x.period, sortable: true, cell: (x) => formatMonth(x.period) },
            { id: "total", header: t("billing.total_incl_vat"), value: (x) => x.total_ore, sortable: true, cell: (x) => kr(x.total_ore) },
            { id: "status", header: t("common.status"), value: (x) => x.status, cell: (x) => <InvoiceStatus inv={x} /> },
            { id: "actions", header: "", value: () => "", cell: (x) => (
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-kontur" onClick={() => void downloadInvoice(null, x.id, t)}>{t("billing.download_pdf")}</button>
                {superadmin && x.status === "open" && <>
                  <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-text" onClick={() => status.mutate({ p_invoice_id: x.id, p_status: "paid" })}>{t("admin.billing.mark_paid")}</button>
                  <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-text" onClick={() => status.mutate({ p_invoice_id: x.id, p_status: "void" })}>{t("admin.billing.void")}</button>
                </>}
              </div>
            ) },
          ]} />
      </section>
    </div>
  );
}
