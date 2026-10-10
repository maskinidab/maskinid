import { APP_DOMAIN, APP_NAME } from "@maskinid/shared/config.ts";
import { labelSerial } from "@maskinid/shared/identifiers.ts";
import type { TFunction } from "i18next";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { qrPng } from "./adQr";

/**
 * A4 with cut marks, 3 × 6 = 18 stickers per page. Deliberately not a die-cut code (Avery/Herma): guessing a
 * die that does not match the stock prints a sheet that looks right and is 2 mm off everywhere, whereas cut
 * marks are merely inconvenient. Switch to a die once the real stock is known.
 */
export const SHEET = { page: [595.28, 841.89] as const, margin: 28.35, cols: 3, rows: 6, max: 500 };

/** Stickers for a set of label codes: QR to /m/<code>, the 6-character serial, and the code itself in fine print. */
export async function labelSheetPdf(codes: string[], t: TFunction, origin = `https://${APP_DOMAIN}`): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(t("labels.print_sheet"));
  doc.setProducer(APP_NAME);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const tiny = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.07, 0.08, 0.09);
  const grey = rgb(0.45, 0.47, 0.5);
  const cut = rgb(0.8, 0.82, 0.84);

  const [pw, ph] = SHEET.page;
  const inner = { w: pw - SHEET.margin * 2, h: ph - SHEET.margin * 2 - 24 }; // 24 pt reserved for the footer
  const cell = { w: inner.w / SHEET.cols, h: inner.h / SHEET.rows };
  const perPage = SHEET.cols * SHEET.rows;
  const list = codes.slice(0, SHEET.max);
  const pages = Math.max(1, Math.ceil(list.length / perPage));

  // Rasterise once per code. 320 px over a 31 mm sticker is ~260 dpi, which is plenty and keeps the file small.
  const images = await Promise.all(list.map((c) => qrPng(`${origin}/m/${c}`, 320)));

  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([pw, ph]);
    for (let i = 0; i < perPage; i++) {
      const idx = p * perPage + i;
      if (idx >= list.length) break;
      const code = list[idx]!;
      const col = i % SHEET.cols;
      const row = Math.floor(i / SHEET.cols);
      const x = SHEET.margin + col * cell.w;
      const yTop = ph - SHEET.margin - row * cell.h;

      page.drawRectangle({ x, y: yTop - cell.h, width: cell.w, height: cell.h, borderColor: cut, borderWidth: 0.5 });
      page.drawRectangle({ x, y: yTop - 2, width: cell.w, height: 2, color: rgb(1, 0.8, 0) });

      const qr = 88;
      page.drawImage(await doc.embedPng(images[idx]!), { x: x + (cell.w - qr) / 2, y: yTop - 14 - qr, width: qr, height: qr });

      const serial = labelSerial(code);
      const sw = mono.widthOfTextAtSize(serial, 13);
      page.drawText(serial, { x: x + (cell.w - sw) / 2, y: yTop - 14 - qr - 15, size: 13, font: mono, color: ink });
      const cw = tiny.widthOfTextAtSize(code, 4.5);
      page.drawText(code, { x: x + (cell.w - cw) / 2, y: yTop - 14 - qr - 24, size: 4.5, font: tiny, color: grey });
      const dw = font.widthOfTextAtSize(APP_DOMAIN, 6);
      page.drawText(APP_DOMAIN, { x: x + (cell.w - dw) / 2, y: yTop - cell.h + 6, size: 6, font, color: grey });
    }
    page.drawText(t("labels.sheet_footer", { page: p + 1, total: pages }),
      { x: SHEET.margin, y: SHEET.margin - 14, size: 8, font, color: grey });
    page.drawText(t("labels.sheet_scan_note"),
      { x: SHEET.margin, y: SHEET.margin - 24, size: 8, font: bold, color: ink, maxWidth: inner.w });
  }
  return doc.save();
}
