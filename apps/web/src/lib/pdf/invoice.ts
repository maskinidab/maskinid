import { BILLING_SELLER, SUPPORT_EMAIL } from "@maskinid/shared/config.ts";
import { formatSek, lineDescription, type InvoiceLine } from "@maskinid/shared/billing.ts";
import type { TFunction } from "i18next";
import { formatDate } from "../format";
import { createDoc } from "./layout";

export interface InvoiceDetail {
  id: string; number: string; period: string; plan_key: string | null; subtotal_ore: number; vat_rate: number; vat_ore: number; total_ore: number;
  status: "open" | "paid" | "void"; issued_at: string; due_date: string; paid_at: string | null; provider_url: string | null;
  lines: InvoiceLine[];
  buyer: { name: string; org_number: string | null; address: { street?: string; postal_code?: string; city?: string } | null; email: string | null; reference: string | null };
}

/** Invoice PDF (step 23): amounts excl. VAT per line, VAT on its own line, total incl. VAT. */
export async function invoicePdf(inv: InvoiceDetail, t: TFunction, locale: "sv" | "en"): Promise<Uint8Array> {
  const kr = (ore: number) => formatSek(ore, locale);
  const seller = [BILLING_SELLER.name, BILLING_SELLER.orgNumber && t("billing.pdf.org_number", { nr: BILLING_SELLER.orgNumber }),
    BILLING_SELLER.vatNumber && t("billing.pdf.vat_number", { nr: BILLING_SELLER.vatNumber }), BILLING_SELLER.address].filter(Boolean).join(", ");
  const d = await createDoc({
    title: t("billing.pdf.title"), number: inv.number, hash: "", generatedAt: formatDate(inv.issued_at), issuer: BILLING_SELLER.name, t,
    footer: [seller, BILLING_SELLER.bankgiro && t("billing.pdf.bankgiro", { nr: BILLING_SELLER.bankgiro }), t("billing.pdf.questions", { email: SUPPORT_EMAIL })]
      .filter(Boolean).join(" · "),
  });
  const a = inv.buyer.address;
  d.row(t("billing.pdf.buyer"), [inv.buyer.name, inv.buyer.org_number, a && [a.street, [a.postal_code, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
    .filter(Boolean).join("\n"));
  if (inv.buyer.reference) d.row(t("billing.reference"), inv.buyer.reference);
  d.row(t("billing.pdf.period"), inv.period.slice(0, 7));
  d.row(t("billing.pdf.issued"), formatDate(inv.issued_at));
  d.row(t("billing.pdf.due"), formatDate(inv.due_date));
  d.row(t("common.status"), t(`billing.invoice_status.${inv.status}`));
  d.space(8);
  d.heading(t("billing.pdf.specification"));
  for (const l of inv.lines) {
    d.row(lineDescription(l, t), `${l.quantity} × ${kr(l.unit_price_ore)} = ${kr(l.amount_ore)}`);
  }
  d.rule();
  d.row(t("billing.subtotal_excl_vat"), kr(inv.subtotal_ore));
  d.row(t("billing.vat_amount", { rate: Math.round(inv.vat_rate * 100) }), kr(inv.vat_ore));
  d.row(t("billing.total_incl_vat"), kr(inv.total_ore), d.bold);
  d.space(8);
  if (inv.status === "paid" && inv.paid_at) d.text(t("billing.pdf.paid", { date: formatDate(inv.paid_at) }));
  else if (inv.provider_url) d.text(t("billing.pdf.pay_online", { url: inv.provider_url }));
  return d.save();
}
