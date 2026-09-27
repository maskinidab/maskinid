import { APP_DOMAIN, APP_NAME } from "@maskinid/shared/config.ts";
import type { TFunction } from "i18next";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { formatReg } from "../format";

async function qrPng(url: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 600 });
  const b64 = dataUrl.split(",")[1]!;
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Ad sign (SPEC §7.2 "Skapa annons-QR"): A4 with the machine, the registration number and a QR code to /ad/<reg> where
 * buyers see the verified machine card and can contact the dealer. `origin` defaults to the production domain.
 */
export async function adSignPdf(m: { reg_number: string; make: string; model: string; year: number | null; dealer: string },
  t: TFunction, origin = `https://${APP_DOMAIN}`): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${m.make} ${m.model} ${formatReg(m.reg_number)}`);
  doc.setProducer(APP_NAME);
  const page = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const ink = rgb(0.07, 0.08, 0.09);
  const url = `${origin}/ad/${m.reg_number}`;
  const img = await doc.embedPng(await qrPng(url));
  page.drawRectangle({ x: 0, y: 781.89, width: 595.28, height: 60, color: rgb(1, 0.8, 0) });
  page.drawText(APP_NAME, { x: 48, y: 803, size: 22, font: bold, color: ink });
  page.drawText(`${m.make} ${m.model}`, { x: 48, y: 720, size: 34, font: bold, color: ink, maxWidth: 500 });
  if (m.year) page.drawText(String(m.year), { x: 48, y: 684, size: 20, font, color: ink });
  page.drawText(formatReg(m.reg_number), { x: 48, y: 620, size: 44, font: mono, color: ink });
  page.drawImage(img, { x: 147, y: 250, width: 300, height: 300 });
  page.drawText(t("dealer.ad_scan"), { x: 48, y: 200, size: 18, font: bold, color: ink, maxWidth: 500 });
  page.drawText(t("dealer.ad_scan_body"), { x: 48, y: 176, size: 12, font, color: ink, maxWidth: 500, lineHeight: 16 });
  page.drawText(m.dealer, { x: 48, y: 80, size: 14, font: bold, color: ink });
  page.drawText(url.replace(/^https?:\/\//, ""), { x: 48, y: 60, size: 10, font, color: ink });
  return doc.save();
}

/** Lot tag for the windscreen (SPEC §7.2 "Skriv ut märke-etikett"): reg number and QR to the machine's public page. */
export async function lotTagPdf(m: { reg_number: string; make: string; model: string; label_code: string | null }, t: TFunction,
  origin = `https://${APP_DOMAIN}`): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([297.64, 419.53]); // A6
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const ink = rgb(0.07, 0.08, 0.09);
  // QR content follows §5.2: only /m/<label code> when a label is bound, otherwise the reg-number page.
  const url = m.label_code ? `${origin}/m/${m.label_code}` : `${origin}/r/${m.reg_number}`;
  const img = await doc.embedPng(await qrPng(url));
  page.drawRectangle({ x: 0, y: 389.53, width: 297.64, height: 30, color: rgb(1, 0.8, 0) });
  page.drawText(APP_NAME, { x: 20, y: 399, size: 13, font: bold, color: ink });
  page.drawText(formatReg(m.reg_number), { x: 20, y: 345, size: 30, font: mono, color: ink });
  page.drawText(`${m.make} ${m.model}`, { x: 20, y: 322, size: 12, font: bold, color: ink, maxWidth: 260 });
  page.drawImage(img, { x: 48.8, y: 90, width: 200, height: 200 });
  page.drawText(t("dealer.lot_tag_note"), { x: 20, y: 60, size: 9, font: bold, color: ink, maxWidth: 260 });
  return doc.save();
}
