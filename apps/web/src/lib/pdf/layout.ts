import { APP_DOMAIN, APP_NAME } from "@maskinid/shared/config.ts";
import type { TFunction } from "i18next";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

/**
 * Shared layout for our formal PDFs (SPEC §10): same typography, yellow ID band, document number, QR code to the
 * public machine page and a footer with "verify at /verify-document" + SHA-256 of the snapshot.
 */
export const INK = rgb(0.07, 0.08, 0.09);
export const GREY = rgb(0.31, 0.34, 0.37);
export const LINE = rgb(0.84, 0.85, 0.87);
const W = 595.28;
const H = 841.89;

export interface Doc {
  doc: PDFDocument;
  font: PDFFont; bold: PDFFont; mono: PDFFont;
  heading(s: string, size?: number): void;
  text(s: string, o?: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number }): void;
  row(label: string, value: string, f?: PDFFont): void;
  space(h: number): void;
  rule(): void;
  save(): Promise<Uint8Array>;
}

/** Wraps text into lines that fit `width` at `size` (pdf-lib has no layout engine). */
export function wrap(s: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function createDoc(opts: {
  title: string; number: string; hash: string; generatedAt: string; issuer?: string; t: TFunction;
  /** Public page for the QR code (label page or /r/<reg>). */
  qrUrl?: string;
}): Promise<Doc> {
  const { t } = opts;
  const doc = await PDFDocument.create();
  doc.setTitle(`${opts.title} ${opts.number}`);
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const qr = opts.qrUrl ? await doc.embedPng(await QRCode.toDataURL(opts.qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 300 })) : null;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 27, width: W, height: 27, color: rgb(0.976, 0.663, 0.137) });
    page.drawText(APP_NAME, { x: 56, y: H - 19, size: 12, font: bold, color: INK });
    page.drawText(opts.number, { x: W - 56 - mono.widthOfTextAtSize(opts.number, 9), y: H - 18, size: 9, font: mono, color: INK });
    y = H - 62;
  };
  newPage();
  const ensure = (h: number) => { if (y - h < 110) newPage(); };
  const api: Doc = {
    doc, font, bold, mono,
    heading(s, size = 12) { ensure(size + 14); y -= 4; page.drawText(s, { x: 56, y, size, font: bold, color: INK }); y -= size + 8; },
    text(s, o = {}) {
      const size = o.size ?? 10;
      for (const line of wrap(s, o.f ?? font, size, W - 112)) {
        ensure(size + 5);
        page.drawText(line, { x: 56, y, size, font: o.f ?? font, color: o.color ?? INK });
        y -= size + 4;
      }
      y -= (o.gap ?? 6);
    },
    row(label, value, f = font) {
      const lines = wrap(value || "–", f, 10, W - 56 - 210);
      ensure(lines.length * 14 + 2);
      page.drawText(label, { x: 56, y, size: 9, font, color: GREY, maxWidth: 145 });
      for (const [i, l] of lines.entries()) page.drawText(l, { x: 210, y: y - i * 14, size: 10, font: f, color: INK });
      y -= lines.length * 14 + 2;
    },
    space(h) { y -= h; },
    rule() { ensure(10); page.drawLine({ start: { x: 56, y: y + 4 }, end: { x: W - 56, y: y + 4 }, thickness: 0.5, color: LINE }); y -= 10; },
    async save() {
      // Footer on every page: verification + hash + page numbers; QR on the first page.
      const verify = t("pdf.verify_document", { url: `https://${APP_DOMAIN}/verify-document`, number: opts.number });
      for (const [i, p] of pages.entries()) {
        p.drawLine({ start: { x: 56, y: 92 }, end: { x: W - 56, y: 92 }, thickness: 0.5, color: LINE });
        const textW = qr && i === 0 ? W - 112 - 80 : W - 112;
        let fy = 78;
        for (const l of wrap(verify, font, 8, textW)) { p.drawText(l, { x: 56, y: fy, size: 8, font, color: GREY }); fy -= 11; }
        p.drawText(`SHA-256 ${opts.hash}`, { x: 56, y: fy - 2, size: 6.5, font: mono, color: GREY });
        const issued = [opts.issuer, opts.generatedAt].filter(Boolean).join(" · ");
        p.drawText(`${issued}  ·  ${t("pdf.page", { page: i + 1, pages: pages.length })}`, { x: 56, y: 36, size: 8, font, color: GREY });
        if (qr && i === 0) p.drawImage(qr, { x: W - 56 - 70, y: 18, width: 70, height: 70 });
      }
      return doc.save();
    },
  };
  api.text(opts.title, { f: bold, size: 20, gap: 10 });
  api.row(t("pdf.document_number"), opts.number, mono);
  if (opts.issuer) api.row(t("pdf.issued_by"), opts.issuer);
  api.space(6);
  return api;
}
