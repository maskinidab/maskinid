import { BILLING_METRICS, formatSek, vatOf } from "@maskinid/shared/billing.ts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorNotice, Skeleton } from "../../components/Feedback";
import { useRpc } from "../../lib/api/query";
import { currentLocale } from "../../i18n";

export interface Plan {
  key: string; org_types: string[]; monthly_fee_ore: number; included: Record<string, number>; unit_prices: Record<string, number>;
  contact_sales: boolean; is_public: boolean;
}

/** One plan: fee excl. VAT with VAT shown separately, what is included and the price above that. */
export function PlanCard({ plan, vatRate, current, action }: { plan: Plan; vatRate: number; current?: boolean; action?: ReactNode }) {
  const { t } = useTranslation();
  const loc = currentLocale();
  const incl = BILLING_METRICS.filter((m) => plan.included[m]);
  return (
    <article className={`panel stack-3 plan-kort${current ? " plan-kort-aktiv" : ""}`} aria-current={current || undefined}>
      <h3 className="t-rubrik-4">{t(`billing.plan.${plan.key}.name`)}</h3>
      <p className="t-liten t-sekundar">{t(`billing.plan.${plan.key}.for`)}</p>
      {plan.contact_sales ? <p className="plan-pris">{t("billing.contact_sales")}</p> : (
        <div>
          <p className="plan-pris">{plan.monthly_fee_ore ? t("billing.per_month", { price: formatSek(plan.monthly_fee_ore, loc) }) : t("billing.free")}</p>
          {plan.monthly_fee_ore > 0 && (
            <p className="t-liten t-sekundar">{t("billing.excl_vat_note", { vat: formatSek(vatOf(plan.monthly_fee_ore, vatRate).vat, loc),
              total: formatSek(vatOf(plan.monthly_fee_ore, vatRate).total, loc) })}</p>
          )}
        </div>
      )}
      <ul className="lista-punkter t-liten">
        <li>{t("billing.feature_registration")}</li>
        {incl.map((m) => <li key={m}>{t("billing.included_n", { n: plan.included[m].toLocaleString(loc === "sv" ? "sv-SE" : "en-GB"), name: t(`billing.included_name.${m}`) })}</li>)}
        {!plan.contact_sales && (["check", "api_call"] as const).filter((m) => plan.unit_prices[m] !== undefined).map((m) => (
          <li key={`p-${m}`}>{t("billing.then_price", { name: t(`billing.unit.${m}`), price: formatSek(plan.unit_prices[m], loc) })}</li>
        ))}
        {plan.contact_sales && <li>{t("billing.enterprise_points")}</li>}
      </ul>
      {action}
    </article>
  );
}

/** Public price list (/pricing). Registration is always free; all prices excl. VAT, VAT shown separately. */
export function PricingPage() {
  const { t } = useTranslation();
  const loc = currentLocale();
  const q = useRpc<{ plans: Plan[]; price_items: Record<string, number>; vat_rate: number }>("list_plans", {});
  return (
    <div className="behallare sektion stack-6">
      <header className="stack-2">
        <h1 className="t-rubrik-1">{t("billing.pricing_title")}</h1>
        <p className="t-ingress">{t("billing.pricing_lead")}</p>
        <p className="t-liten t-sekundar">{t("billing.all_excl_vat")}</p>
      </header>
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <>
          <div className="plan-rutnat">
            {q.data!.plans.map((p) => (
              <PlanCard key={p.key} plan={p} vatRate={q.data!.vat_rate}
                action={p.contact_sales
                  ? <Link className="mid-knapp mid-knapp-kontur" to="/contact">{t("billing.contact_us")}</Link>
                  : <Link className="mid-knapp mid-knapp-primar" to="/login">{p.monthly_fee_ore ? t("billing.get_started") : t("billing.start_free")}</Link>} />
            ))}
          </div>
          <section className="stack-3" aria-labelledby="prislista">
            <h2 id="prislista" className="t-rubrik-3">{t("billing.price_list")}</h2>
            <table className="mid-tabell">
              <caption className="visually-hidden">{t("billing.price_list")}</caption>
              <thead><tr><th scope="col">{t("billing.item")}</th><th scope="col" className="tal">{t("billing.price_excl_vat")}</th></tr></thead>
              <tbody>
                {BILLING_METRICS.map((m) => (
                  <tr key={m}><td>{t(`billing.metric.${m}`)}</td><td className="tal">{t("billing.per_unit", { price: formatSek(q.data!.price_items[m] ?? 0, loc), unit: t(`billing.unit.${m}`) })}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="t-liten t-sekundar">{t("billing.public_sector_note")}</p>
          </section>
          <section className="panel stack-2">
            <h2 className="t-rubrik-4">{t("billing.faq_title")}</h2>
            <p className="t-liten">{t("billing.faq_no_amounts")}</p>
            <p className="t-liten">{t("billing.faq_invoice")}</p>
          </section>
        </>
      )}
    </div>
  );
}
