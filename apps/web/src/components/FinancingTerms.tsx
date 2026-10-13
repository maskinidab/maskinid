/**
 * The finance calculator ("finanssnurran", ADR 0029): the five figures from the agreement, with the monthly cost
 * and the total credit amount worked out from them.
 *
 * Shared by the dealer's manual form, the document path and the lender's own registration form, so all three
 * store the same fields. The arithmetic lives in @maskinid/shared/financing.ts, which app.annuity_monthly mirrors
 * in SQL — the server has to be able to compute the same figure for an API client with no browser.
 *
 * The computed monthly cost is shown, not typed. It can be overridden, and an override is recorded as such so a
 * later change to the formula never silently rewrites the lender's own figure.
 */
import { useTranslation } from "react-i18next";
import { calculateFinancing, type FinancingTerms as Terms } from "@maskinid/shared/financing.ts";
import { currentLocale } from "../i18n";
import { formatSek } from "../lib/format";
import { FormField } from "./FormField";

export interface TermsForm {
  financing_amount: string;
  down_payment: string;
  residual_value: string;
  amortization_months: string;
  interest_rate: string;
  /** Empty unless the user chose to type the monthly cost in. */
  monthly_cost: string;
}

export const EMPTY_TERMS: TermsForm = {
  financing_amount: "", down_payment: "", residual_value: "", amortization_months: "", interest_rate: "", monthly_cost: "",
};

const n = (v: string): number | null => {
  const s = v.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
};

/** The form as the RPCs want it: null for anything left blank, so nothing is stored as zero by accident. */
export function termsPayload(f: TermsForm): Terms & { monthly_cost?: number | null } | null {
  const out = {
    financing_amount: n(f.financing_amount),
    down_payment: n(f.down_payment),
    residual_value: n(f.residual_value),
    amortization_months: n(f.amortization_months),
    interest_rate: n(f.interest_rate),
    monthly_cost: n(f.monthly_cost),
  };
  return Object.values(out).every((v) => v === null) ? null : out;
}

/** True when the figures given cannot be stored, with the message to show. Checked here and again in SQL. */
export function termsError(f: TermsForm, t: (k: string) => string): string | null {
  const { total_credit_amount: credit } = calculateFinancing(termsPayload(f) ?? {});
  const residual = n(f.residual_value);
  if (credit !== null && residual !== null && residual > credit) return t("financing.terms.residual_too_high");
  return null;
}

export function FinancingTermsFields({ form, set }: {
  form: TermsForm;
  set: <K extends keyof TermsForm>(k: K, v: TermsForm[K]) => void;
}) {
  const { t } = useTranslation();
  const loc = currentLocale();
  const calc = calculateFinancing(termsPayload(form) ?? {});
  const overridden = n(form.monthly_cost) !== null;
  const shown = overridden ? n(form.monthly_cost) : calc.monthly_cost;
  const error = termsError(form, t);

  const amount = (k: keyof TermsForm, cls: string) => (
    <FormField className={cls} label={t(`financing.terms.${k}`)} optional>
      <input className="mid-input tal" inputMode="decimal" value={form[k]} onChange={(e) => set(k, e.target.value)} />
    </FormField>
  );

  return (
    <fieldset className="stack-3">
      <legend className="t-rubrik-4">{t("financing.terms.title")}</legend>
      <p className="t-liten t-sekundar">{t("financing.terms.lead")}</p>
      <div className="rutnat">
        {amount("financing_amount", "kol-4")}
        {amount("down_payment", "kol-4")}
        {amount("residual_value", "kol-4")}
        <FormField className="kol-6" label={t("financing.terms.amortization_months")} optional>
          <input className="mid-input tal" type="number" min={1} max={240} value={form.amortization_months}
            onChange={(e) => set("amortization_months", e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("financing.terms.interest_rate")} optional>
          <input className="mid-input tal" inputMode="decimal" value={form.interest_rate}
            onChange={(e) => set("interest_rate", e.target.value)} />
        </FormField>
      </div>
      <dl className="nyckeltal">
        <div>
          <dt>{t("financing.terms.total_credit_amount")}</dt>
          <dd>{calc.total_credit_amount === null ? "–" : formatSek(calc.total_credit_amount, loc)}</dd>
        </div>
        <div>
          <dt>{t("financing.terms.monthly_cost")}</dt>
          <dd>
            {shown === null ? "–" : formatSek(shown, loc)}
            <br />
            <span className="t-liten t-sekundar">{overridden ? t("financing.terms.overridden") : t("financing.terms.calculated")}</span>
          </dd>
        </div>
      </dl>
      {shown === null && !error && <p className="t-liten t-sekundar">{t("financing.terms.incomplete")}</p>}
      {error && <p className="t-liten t-fel">{error}</p>}
      {overridden ? (
        <div className="rutnat">
          <FormField className="kol-6" label={t("financing.terms.monthly_cost")}>
            <input className="mid-input tal" inputMode="decimal" value={form.monthly_cost}
              onChange={(e) => set("monthly_cost", e.target.value)} />
          </FormField>
          <div className="kol-6">
            <button type="button" className="mid-knapp mid-knapp-text" onClick={() => set("monthly_cost", "")}>
              {t("financing.terms.reset")}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="mid-knapp mid-knapp-text"
            onClick={() => set("monthly_cost", calc.monthly_cost === null ? "0" : String(calc.monthly_cost))}>
            {t("financing.terms.override")}
          </button>
        </div>
      )}
    </fieldset>
  );
}

/** Read-only summary on the machine's financing tab. Only ever rendered for the owner and the lender. */
export function FinancingTermsSummary({ terms }: { terms: Record<string, number | string | boolean | null> | null | undefined }) {
  const { t } = useTranslation();
  const loc = currentLocale();
  const num = (k: string): number | null => {
    const v = terms?.[k];
    return typeof v === "number" ? v : typeof v === "string" ? Number(v) : null;
  };
  if (!terms || num("financing_amount") === null) return <p className="t-liten t-sekundar">{t("financing.terms.none")}</p>;
  const rows: [string, string][] = [
    ["financing_amount", formatSek((num("financing_amount") ?? 0), loc)],
    ...(num("down_payment") !== null ? [["down_payment", formatSek((num("down_payment") ?? 0), loc)] as [string, string]] : []),
    ...(num("total_credit_amount") !== null ? [["total_credit_amount", formatSek((num("total_credit_amount") ?? 0), loc)] as [string, string]] : []),
    ...(num("residual_value") !== null ? [["residual_value", formatSek((num("residual_value") ?? 0), loc)] as [string, string]] : []),
    ...(num("amortization_months") !== null ? [["amortization_months", String(num("amortization_months"))] as [string, string]] : []),
    ...(num("interest_rate") !== null ? [["interest_rate", `${num("interest_rate")} %`] as [string, string]] : []),
    ...(num("monthly_cost") !== null ? [["monthly_cost", formatSek((num("monthly_cost") ?? 0), loc)] as [string, string]] : []),
  ];
  return (
    <dl className="faktarutnat">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{t(`financing.terms.${k}`)}</dt>
          <dd className="tal">{v}{k === "monthly_cost" && terms.terms_overridden ? ` (${t("financing.terms.overridden")})` : ""}</dd>
        </div>
      ))}
    </dl>
  );
}
