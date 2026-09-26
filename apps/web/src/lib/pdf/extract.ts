import { APP_DOMAIN, APP_NAME } from "@maskinid/shared/config.ts";
import type { TFunction } from "i18next";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDate, formatDateTime, formatReg } from "../format";

interface Extract {
  org_name: string; generated_at: string;
  machine: Record<string, unknown> & { reg_number: string; make: string; model: string; year: number | null; category: string; status: string; verification_level: number };
  identifiers: { type: string; value: string; verified: boolean }[];
  owner: { name: string; org_number: string | null; city: string | null } | null;
  ownerships: { owner: string; org_number: string | null; from: string; to: string | null; via: string }[];
  encumbrances: { type: string; status: string; holder: string; start_date: string; end_date: string | null; released_at: string | null }[];
  flags: { type: string; status: string; raised_at: string; cleared_at: string | null }[];
  inspection_valid_until: string | null;
}

/** Register extract (registerutdrag, SPEC §7.5): formal PDF with extract number and SHA-256, no personal identity numbers. */
export async function extractPdf(x: Extract, meta: { report_number: string; result_hash: string }, t: TFunction): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${t("extract.title")} ${meta.report_number}`);
  doc.setProducer(APP_NAME);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.07, 0.08, 0.09);
  const grey = rgb(0.31, 0.34, 0.37);
  let page: PDFPage = doc.addPage([595.28, 841.89]);
  let y = 780;
  const ensure = (h: number) => { if (y - h < 60) { page = doc.addPage([595.28, 841.89]); y = 800; } };
  const text = (s: string, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) => {
    ensure(o.gap ?? 16);
    page.drawText(s, { x: o.x ?? 56, y, size: o.size ?? 10, font: o.f ?? font, color: o.color ?? ink, maxWidth: 480, lineHeight: (o.size ?? 10) + 3 });
    y -= o.gap ?? 16;
  };
  const row = (l: string, v: string, f: PDFFont = font) => { ensure(16); page.drawText(l, { x: 56, y, size: 9, font, color: grey });
    page.drawText(v, { x: 210, y, size: 10, font: f, color: ink, maxWidth: 330 }); y -= 16; };
  page.drawRectangle({ x: 0, y: 815, width: 595.28, height: 27, color: rgb(1, 0.8, 0) });
  page.drawText(APP_NAME, { x: 56, y: 823, size: 12, font: bold, color: ink });
  text(t("extract.title"), { f: bold, size: 20, gap: 28 });
  row(t("extract.number"), meta.report_number, mono);
  row(t("extract.issued"), `${formatDateTime(x.generated_at)} · ${x.org_name}`);
  y -= 8;
  const m = x.machine;
  text(`${m.make} ${m.model}${m.year ? ` · ${m.year}` : ""}`, { f: bold, size: 14, gap: 22 });
  row(t("pdf.reg_number"), formatReg(m.reg_number), mono);
  row(t("wizard.category"), t(`enum.category.${m.category}`));
  row(t("common.status"), `${t(`enum.machine_status.${m.status}`)} · ${t(`level.${m.verification_level}.name`)}`);
  for (const i of x.identifiers) row(t(`enum.identifier_type.${i.type}`), `${i.value}${i.verified ? ` (${t("extract.verified")})` : ""}`, mono);
  if (x.inspection_valid_until) row(t("fleet.col.inspection"), formatDate(x.inspection_valid_until));
  y -= 8;
  text(t("extract.owner"), { f: bold, size: 12, gap: 18 });
  row(t("machine.owner"), x.owner ? [x.owner.name, x.owner.org_number, x.owner.city].filter(Boolean).join(", ") : "–");
  y -= 4;
  text(t("extract.ownerships"), { f: bold, size: 12, gap: 18 });
  for (const o of x.ownerships) row(`${formatDate(o.from)} – ${o.to ? formatDate(o.to) : ""}`, [o.owner, o.org_number].filter(Boolean).join(", "));
  y -= 4;
  text(t("extract.encumbrances"), { f: bold, size: 12, gap: 18 });
  if (x.encumbrances.length === 0) row("", t("components.financing.no"));
  for (const e of x.encumbrances) row(`${t(`enum.encumbrance_type.${e.type}`)}`, `${e.holder} · ${formatDate(e.start_date)}${e.end_date ? `–${formatDate(e.end_date)}` : ""} · ${t(`enum.encumbrance_status.${e.status}`)}`);
  y -= 4;
  text(t("pdf.flags"), { f: bold, size: 12, gap: 18 });
  if (x.flags.length === 0) row("", t("common.none"));
  for (const f of x.flags) row(t(`enum.flag_type.${f.type}`), `${formatDate(f.raised_at)}${f.cleared_at ? ` – ${formatDate(f.cleared_at)}` : ""} · ${t(`extract.flag_${f.status}`)}`);
  y -= 12;
  text(t("extract.footer"), { size: 8, color: grey, gap: 24 });
  text(t("fleet.pdf_footer", { url: `https://${APP_DOMAIN}/receipt`, date: formatDate(x.generated_at) }), { size: 8, color: grey, gap: 24 });
  text(`SHA-256 ${meta.result_hash}`, { f: mono, size: 7, color: grey });
  return doc.save();
}
