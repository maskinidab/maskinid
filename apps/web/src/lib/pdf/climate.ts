import type { TFunction } from "i18next";
import { formatDate, formatDateTime, formatNumber, formatReg } from "../format";
import type { SnapshotMeta } from "./certificate";
import { createDoc } from "./layout";

export interface ClimateReport {
  from: string; to: string; org_name?: string; generated_at?: string; factors: Record<string, number>;
  totals: { co2e_kg: number; entries: number; fossil_free_share: number | null };
  by_fuel: { fuel: string; unit: string; quantity: number; co2e_kg: number }[];
  by_machine: { reg_number: string; make: string; model: string; category: string; emission_stage: string | null; quantity_l: number | null; kwh: number | null; co2e_kg: number; hours: number | null }[];
  by_project: { project: string; co2e_kg: number }[];
}

const tonnes = (kg: number) => formatNumber(Math.round(kg / 100) / 10);

/** Klimatrapport: fuel and energy per period with CO2e, per machine and per project, with the emission factors used. */
export async function climatePdf(r: ClimateReport, meta: SnapshotMeta, t: TFunction): Promise<Uint8Array> {
  const d = await createDoc({ title: t("climate.pdf_title"), number: meta.report_number, hash: meta.result_hash,
    generatedAt: r.generated_at ? formatDateTime(r.generated_at) : "", issuer: r.org_name, t });
  d.row(t("climate.period"), `${formatDate(r.from)} – ${formatDate(r.to)}`);
  d.row(t("climate.total"), `${tonnes(r.totals.co2e_kg)} t CO2e`, d.bold);
  if (r.totals.fossil_free_share != null) d.row(t("climate.fossil_free"), `${formatNumber(r.totals.fossil_free_share)} %`);
  d.rule();
  d.heading(t("climate.by_fuel"));
  for (const f of r.by_fuel) d.row(t(`climate.fuel.${f.fuel}`), `${formatNumber(f.quantity)} ${f.unit} · ${tonnes(f.co2e_kg)} t CO2e`);
  d.rule();
  d.heading(t("climate.by_machine"));
  for (const m of r.by_machine) {
    d.row(formatReg(m.reg_number), [`${m.make} ${m.model}`, m.emission_stage && m.emission_stage !== "unknown" ? t(`enum.emission.${m.emission_stage}`) : "",
      m.quantity_l ? `${formatNumber(m.quantity_l)} l` : "", m.kwh ? `${formatNumber(m.kwh)} kWh` : "", `${tonnes(m.co2e_kg)} t CO2e`,
      m.hours && m.quantity_l ? t("climate.per_hour", { value: formatNumber(Math.round((m.quantity_l / m.hours) * 10) / 10) }) : ""].filter(Boolean).join(" · "));
  }
  if (r.by_project.length) {
    d.rule();
    d.heading(t("climate.by_project"));
    for (const p of r.by_project) d.row(p.project, `${tonnes(p.co2e_kg)} t CO2e`);
  }
  d.rule();
  d.heading(t("climate.factors"));
  for (const [k, v] of Object.entries(r.factors)) d.row(t(`climate.fuel.${k}`), `${formatNumber(v)} kg CO2e / ${k === "electricity" ? "kWh" : k === "biogas" ? "kg" : "l"}`);
  d.text(t("climate.method"), { size: 8.5 });
  return d.save();
}
