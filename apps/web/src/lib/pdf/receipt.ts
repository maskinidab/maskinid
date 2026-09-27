import { APP_DOMAIN, APP_NAME } from "@maskinid/shared/config.ts";
import type { TFunction } from "i18next";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { CheckReceipt } from "../../components/ReceiptCard";
import { formatDate, formatDateTime, formatReg } from "../format";

/**
 * Check receipt as PDF (SPEC §6.6 step 3): "Kontroll utförd <tid> av <org>, resultat: …". Generated in the browser from
 * the stored receipt; the receipt number and the SHA-256 of the result let anyone verify it with the operator.
 */
export async function receiptPdf(r: CheckReceipt, t: TFunction): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${t("components.receipt.title")} ${r.receipt_number}`);
  doc.setProducer(APP_NAME);
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.07, 0.08, 0.09);
  const grey = rgb(0.31, 0.34, 0.37);
  let y = 780;
  const line = (text: string, opts: { f?: typeof font; size?: number; color?: typeof ink; gap?: number } = {}) => {
    page.drawText(text, { x: 56, y, size: opts.size ?? 11, font: opts.f ?? font, color: opts.color ?? ink, maxWidth: 480 });
    y -= opts.gap ?? 18;
  };
  const row = (label: string, value: string, f = font) => {
    page.drawText(label, { x: 56, y, size: 10, font, color: grey });
    page.drawText(value, { x: 220, y, size: 11, font: f, color: ink, maxWidth: 320 });
    y -= 20;
  };
  // Yellow ID bar – the brand's one accent.
  page.drawRectangle({ x: 0, y: 815, width: 595.28, height: 27, color: rgb(1, 0.8, 0) });
  page.drawText(APP_NAME, { x: 56, y: 823, size: 12, font: bold, color: ink });
  line(t("components.receipt.title"), { f: bold, size: 20, gap: 30 });
  const x = r.result;
  row(t("components.receipt.number"), r.receipt_number, mono);
  row(t("pdf.performed_at"), formatDateTime(x.performed_at ?? r.created_at));
  row(t("pdf.performed_by"), x.performed_by);
  y -= 10;
  if (!x.found) {
    line(t("check.not_found"), { f: bold, size: 14, gap: 24 });
  } else {
    line(`${x.make ?? ""} ${x.model ?? ""}${x.year ? ` · ${x.year}` : ""}`, { f: bold, size: 14, gap: 24 });
    row(t("pdf.reg_number"), formatReg(x.reg_number), mono);
    row(t("common.status"), `${t(`enum.machine_status.${x.status}`)} · ${t(`level.${x.verification_level}.name`)}`);
    row(t("check.result_owner"), [x.owner_org_name, x.owner_org_number].filter(Boolean).join(", ") || "–");
    row(t("check.result_financing"), x.has_active_financing ? t("pdf.yes_caps") : t("pdf.no_caps"), bold);
    if (x.financing) row("", `${x.financing.holder} · ${t(`enum.encumbrance_type.${x.financing.type}`)} · ${formatDate(x.financing.start_date)}`);
    row(t("pdf.flags"), x.flags?.length ? x.flags.map((f) => t(`enum.flag_type.${f.type}`)).join(", ") : t("common.none"));
    row(t("machine.last_transfer"), x.last_transfer_date ? formatDate(x.last_transfer_date) : "–");
    if (x.market_listings?.length) row(t("pdf.market"), t("check.listed_for_sale", { count: x.market_listings.length }));
    if (x.risk_signals?.length) row(t("risk.title"), x.risk_signals.map((s) => t(`risk.${s.code}`)).join("; "));
  }
  y -= 16;
  line(t("pdf.no_amounts"), { size: 9, color: grey, gap: 14 });
  line(t("pdf.snapshot"), { size: 9, color: grey, gap: 14 });
  y -= 8;
  line("SHA-256", { size: 9, color: grey, gap: 12 });
  line(r.result_hash, { f: mono, size: 8, gap: 20 });
  line(t("pdf.verify_at", { url: `https://${APP_DOMAIN}/receipt` }), { size: 9, color: grey });
  return doc.save();
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
