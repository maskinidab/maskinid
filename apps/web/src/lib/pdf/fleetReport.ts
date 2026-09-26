import { APP_DOMAIN, APP_NAME } from "@maskinid/shared/config.ts";
import type { TFunction } from "i18next";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { formatDate, formatDateTime, formatMonth, formatNumber, formatReg } from "../format";

export interface FleetReportRow {
  reg_number: string; make: string; model: string; year: number | null; category: string; emission_stage?: string | null; fuel_type?: string | null;
  electric_config?: string | null; service_weight_kg?: number | null; engine_power_kw?: number | null; hour_meter?: number | null;
  has_lifting_device?: boolean; inspection_valid_until?: string | null; verification_level: number; status: string; project: string | null;
}
export interface FleetReport {
  org_name: string; org_number: string | null; project: { name: string; site_address: string | null; reference: string | null } | null;
  kind: "fleet_report" | "project_list"; generated_at: string; machines: FleetReportRow[];
  summary: { count: number; stage_v_or_zero: number; electric: number; hvo: number; level_2: number; inspection_due: number };
}

/**
 * Fleet/procurement report PDF (SPEC §7.1): machines with emission stage, fuel, electric drive, weight, power,
 * inspection status and verification level. Number + SHA-256 make it verifiable at /receipt.
 */
export async function fleetReportPdf(r: FleetReport, meta: { report_number: string; result_hash: string }, t: TFunction): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${t("fleet.report_title")} ${meta.report_number}`);
  doc.setProducer(APP_NAME);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.07, 0.08, 0.09);
  const grey = rgb(0.31, 0.34, 0.37);
  const W = 841.89, H = 595.28; // A4 landscape
  const cols = r.kind === "project_list"
    ? [["reg", 80], ["machine", 190], ["year", 45], ["category", 150], ["level", 110], ["project", 150]] as const
    : [["reg", 70], ["machine", 150], ["year", 38], ["emission", 70], ["fuel", 80], ["weight", 58], ["power", 52], ["inspection", 78], ["level", 90], ["project", 90]] as const;
  const cell = (row: FleetReportRow, c: string): string => {
    switch (c) {
      case "reg": return formatReg(row.reg_number);
      case "machine": return `${row.make} ${row.model}`;
      case "year": return row.year?.toString() ?? "–";
      case "category": return t(`enum.category.${row.category}`);
      case "emission": return row.emission_stage ? t(`enum.emission.${row.emission_stage}`) : "–";
      case "fuel": return [row.fuel_type ? t(`enum.fuel.${row.fuel_type}`) : "–", row.electric_config ? t(`enum.electric.${row.electric_config}`) : ""].filter(Boolean).join(", ");
      case "weight": return row.service_weight_kg ? `${formatNumber(row.service_weight_kg)} kg` : "–";
      case "power": return row.engine_power_kw ? `${formatNumber(row.engine_power_kw)} kW` : "–";
      case "inspection": return row.has_lifting_device ? (row.inspection_valid_until ? formatMonth(row.inspection_valid_until) : t("fleet.inspection_missing_short")) : t("fleet.not_required");
      case "level": return t(`level.${row.verification_level}.name`);
      case "project": return row.project ?? "–";
      default: return "";
    }
  };
  const fit = (s: string, width: number, f = font, size = 8) => {
    let out = s;
    while (out.length > 1 && f.widthOfTextAtSize(out, size) > width - 4) out = out.slice(0, -2) + "…";
    return out;
  };
  let page = doc.addPage([W, H]);
  let y = H - 40;
  const header = () => {
    page.drawRectangle({ x: 0, y: H - 22, width: W, height: 22, color: rgb(1, 0.8, 0) });
    page.drawText(APP_NAME, { x: 40, y: H - 16, size: 10, font: bold, color: ink });
    page.drawText(`${meta.report_number}`, { x: W - 140, y: H - 16, size: 9, font: mono, color: ink });
  };
  header();
  y = H - 60;
  page.drawText(t(r.kind === "project_list" ? "fleet.project_list_title" : "fleet.report_title"), { x: 40, y, size: 18, font: bold, color: ink });
  y -= 20;
  page.drawText(`${r.org_name}${r.org_number ? `, ${r.org_number}` : ""}${r.project ? ` · ${r.project.name}${r.project.site_address ? `, ${r.project.site_address}` : ""}` : ""}`,
    { x: 40, y, size: 10, font, color: ink });
  y -= 14;
  page.drawText(t("fleet.generated", { date: formatDateTime(r.generated_at) }), { x: 40, y, size: 9, font, color: grey });
  y -= 18;
  if (r.kind === "fleet_report") {
    const s = r.summary;
    page.drawText(t("fleet.summary_line", { count: s.count, stage_v: s.stage_v_or_zero, electric: s.electric, hvo: s.hvo, level2: s.level_2, inspection_due: s.inspection_due }),
      { x: 40, y, size: 9, font, color: ink, maxWidth: W - 80 });
    y -= 18;
  }
  const drawHead = () => {
    let x = 40;
    page.drawRectangle({ x: 36, y: y - 4, width: W - 72, height: 16, color: rgb(0.945, 0.949, 0.953) });
    for (const [c, w] of cols) { page.drawText(fit(t(`fleet.col.${c}`), w, bold), { x, y, size: 8, font: bold, color: grey }); x += w; }
    y -= 16;
  };
  drawHead();
  for (const row of r.machines) {
    if (y < 60) {
      page = doc.addPage([W, H]);
      header();
      y = H - 50;
      drawHead();
    }
    let x = 40;
    for (const [c, w] of cols) { page.drawText(fit(cell(row, c), w, c === "reg" ? mono : font), { x, y, size: 8, font: c === "reg" ? mono : font, color: ink }); x += w; }
    y -= 13;
  }
  const last = doc.getPages().at(-1)!;
  last.drawText(t("fleet.pdf_footer", { url: `https://${APP_DOMAIN}/receipt`, date: formatDate(r.generated_at) }), { x: 40, y: 34, size: 8, font, color: grey });
  last.drawText(`SHA-256 ${meta.result_hash}`, { x: 40, y: 22, size: 7, font: mono, color: grey });
  return doc.save();
}
