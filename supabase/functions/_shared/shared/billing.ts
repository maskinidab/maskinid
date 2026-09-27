/**
 * Billing helpers shared by the web app, invoice PDFs and Edge Functions (step 23, ADR 0020).
 * Amounts are integers in öre excluding VAT; VAT is always shown separately.
 */
export const BILLING_METRICS = ["check", "api_call", "register_extract", "label_qr", "label_nfc"] as const;
export type BillingMetric = (typeof BILLING_METRICS)[number];

export interface InvoiceLine {
  kind: "plan" | "usage";
  item: string;
  quantity: number;
  used?: number;
  included?: number;
  unit_price_ore: number;
  amount_ore: number;
}

type T = (key: string, vars?: Record<string, unknown>) => string;

/** Formats öre as kronor, e.g. 99000 ⇒ "990 kr", 20 ⇒ "0,20 kr". */
export function formatSek(ore: number, locale: "sv" | "en" = "sv"): string {
  const decimals = ore % 100 === 0 ? 0 : 2;
  const n = new Intl.NumberFormat(locale === "sv" ? "sv-SE" : "en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .format(ore / 100);
  return locale === "sv" ? `${n} kr` : `SEK ${n}`;
}

export function vatOf(subtotalOre: number, rate: number): { vat: number; total: number } {
  const vat = Math.round(subtotalOre * rate);
  return { vat, total: subtotalOre + vat };
}

export function lineDescription(l: InvoiceLine, t: T): string {
  if (l.kind === "plan") return t("billing.line.plan", { plan: t(`billing.plan.${l.item}.name`) });
  const name = t(`billing.metric.${l.item}`);
  return l.included ? t("billing.line.above_included", { name, used: l.used ?? l.quantity, included: l.included }) : name;
}
