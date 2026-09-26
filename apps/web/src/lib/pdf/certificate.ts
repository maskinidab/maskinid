import { APP_DOMAIN } from "@maskinid/shared/config.ts";
import type { TFunction } from "i18next";
import { formatDate, formatDateTime, formatNumber, formatReg } from "../format";
import { createDoc } from "./layout";

export interface CertificateSnapshot {
  generated_at: string; org_name: string;
  machine: Record<string, unknown> & { reg_number: string; make: string; model: string; variant?: string | null; year: number | null; category: string;
    status: string; verification_level: number; technical?: { service_weight_kg?: number | null; engine_power_kw?: number | null } };
  identifiers: { type: string; value: string; verified: boolean }[];
  owner: { name: string; org_number: string | null; city: string | null } | null;
  owner_since: string | null; owner_ordinal: number; label_code: string | null;
  financing: { has_active: boolean; type: string | null; holder: string | null } | null;
  first_sale_dealer: string | null;
}

export interface SnapshotMeta { report_number: string; result_hash: string }

/** Ägarbevis / registration confirmation (SPEC §6.2, §6.3): who is the registered owner, no amounts, no personal numbers. */
export async function certificatePdf(c: CertificateSnapshot, meta: SnapshotMeta, t: TFunction): Promise<Uint8Array> {
  const m = c.machine;
  const d = await createDoc({
    title: t("certificate.title"), number: meta.report_number, hash: meta.result_hash, generatedAt: formatDateTime(c.generated_at), t,
    qrUrl: c.label_code ? `https://${APP_DOMAIN}/m/${c.label_code}` : `https://${APP_DOMAIN}/r/${m.reg_number}`,
  });
  d.text(t("certificate.lead", { org: c.owner?.name ?? "", reg: formatReg(m.reg_number) }), { size: 11, gap: 10 });
  d.heading(`${m.make} ${m.model}${m.variant ? ` ${m.variant}` : ""}${m.year ? ` · ${m.year}` : ""}`, 14);
  d.row(t("pdf.reg_number"), formatReg(m.reg_number), d.mono);
  d.row(t("wizard.category"), t(`enum.category.${m.category}`));
  for (const i of c.identifiers) d.row(t(`enum.identifier_type.${i.type}`), `${i.value}${i.verified ? ` (${t("extract.verified")})` : ""}`, d.mono);
  if (m.technical?.service_weight_kg) d.row(t("certificate.weight"), `${formatNumber(m.technical.service_weight_kg)} kg`);
  if (m.technical?.engine_power_kw) d.row(t("certificate.power"), `${formatNumber(m.technical.engine_power_kw)} kW`);
  d.row(t("common.status"), t(`enum.machine_status.${m.status}`));
  d.row(t("certificate.level"), `${t(`level.${m.verification_level}.name`)} – ${t(`level.${m.verification_level}.desc`)}`);
  d.rule();
  d.heading(t("certificate.owner"));
  d.row(t("machine.owner"), c.owner ? [c.owner.name, c.owner.org_number, c.owner.city].filter(Boolean).join(", ") : "–");
  if (c.owner_since) d.row(t("certificate.owner_since"), formatDate(c.owner_since));
  d.row(t("certificate.owner_ordinal"), String(c.owner_ordinal));
  if (c.first_sale_dealer) d.row(t("certificate.sold_new_by"), c.first_sale_dealer);
  d.row(t("certificate.financing"), c.financing?.has_active
    ? `${t("components.financing.yes")}${c.financing.type ? ` – ${t(`enum.encumbrance_type.${c.financing.type}`)}` : ""}${c.financing.holder ? `, ${c.financing.holder}` : ""}`
    : t("components.financing.no"));
  if (c.label_code) d.row(t("certificate.label"), c.label_code, d.mono);
  d.rule();
  d.text(t("certificate.legal"), { size: 8.5 });
  return d.save();
}

export interface MachineReportSnapshot {
  generated_at: string; org_name: string;
  machine: Record<string, unknown> & { reg_number: string; make: string; model: string; year: number | null; category: string; status: string;
    verification_level: number; hour_meter?: number | null; owner_ordinal: number; serial_masked: string | null;
    financing: { has_active: boolean; holder: string | null; type: string | null };
    flags: { type: string; raised_at: string }[];
    history: { type: string; created_at: string; actor_org: string | null }[];
    documents: { type: string; filename: string; created_at: string }[];
    maintenance?: { performed_at: string; type: string; hours: number | null; performed_by_text: string | null }[];
    inspections?: { performed_at: string; type: string; result: string; valid_until: string | null; inspection_body_name: string | null }[] };
}

/** Maskinrapport (SPEC §6.10): history, verification, financing yes/no + holder, documents, hours and service. */
export async function machineReportPdf(r: MachineReportSnapshot, meta: SnapshotMeta, t: TFunction): Promise<Uint8Array> {
  const m = r.machine;
  const d = await createDoc({
    title: t("machine_report.title"), number: meta.report_number, hash: meta.result_hash, generatedAt: formatDateTime(r.generated_at),
    issuer: r.org_name, t, qrUrl: `https://${APP_DOMAIN}/r/${m.reg_number}`,
  });
  d.heading(`${m.make} ${m.model}${m.year ? ` · ${m.year}` : ""}`, 14);
  d.row(t("pdf.reg_number"), formatReg(m.reg_number), d.mono);
  d.row(t("wizard.category"), t(`enum.category.${m.category}`));
  if (m.serial_masked) d.row(t("enum.identifier_type.serial"), m.serial_masked, d.mono);
  d.row(t("common.status"), `${t(`enum.machine_status.${m.status}`)} · ${t(`level.${m.verification_level}.name`)}`);
  if (m.hour_meter != null) d.row(t("machine.hours"), `${formatNumber(m.hour_meter)} h`);
  d.row(t("certificate.owner_ordinal"), String(m.owner_ordinal));
  d.row(t("certificate.financing"), m.financing.has_active ? `${t("components.financing.yes")}${m.financing.holder ? ` – ${m.financing.holder}` : ""}` : t("components.financing.no"));
  d.row(t("pdf.flags"), m.flags.length ? m.flags.map((f) => `${t(`enum.flag_type.${f.type}`)} ${formatDate(f.raised_at)}`).join(", ") : t("common.none"));
  if (m.maintenance?.length) {
    d.rule();
    d.heading(t("machine_report.service"));
    for (const s of m.maintenance.slice(0, 30)) d.row(formatDate(s.performed_at), [t(`enum.maintenance_type.${s.type}`, { defaultValue: s.type }), s.hours != null ? `${formatNumber(s.hours)} h` : "", s.performed_by_text ?? ""].filter(Boolean).join(" · "));
  }
  if (m.inspections?.length) {
    d.rule();
    d.heading(t("machine_report.inspections"));
    for (const i of m.inspections) d.row(formatDate(i.performed_at), [t(`enum.inspection_type.${i.type}`, { defaultValue: i.type }), t(`enum.inspection_result.${i.result}`, { defaultValue: i.result }),
      i.valid_until ? t("service.valid_until", { date: formatDate(i.valid_until) }) : "", i.inspection_body_name ?? ""].filter(Boolean).join(" · "));
  }
  d.rule();
  d.heading(t("machine_report.history"));
  for (const h of m.history.slice(0, 60)) d.row(formatDate(h.created_at), eventText(t, h));
  if (m.documents.length) {
    d.rule();
    d.heading(t("machine_report.documents"));
    for (const doc of m.documents) d.row(t(`enum.document_type.${doc.type}`), `${doc.filename} · ${formatDate(doc.created_at)}`);
  }
  d.rule();
  d.text(t("machine_report.legal"), { size: 8.5 });
  return d.save();
}

/** Event line without payload details (the buyer report carries none): unresolved {{payload.…}} parts are dropped. */
export function eventText(t: TFunction, h: { type: string; actor_org: string | null }): string {
  const s = t(`events.${h.type}`, { actor: h.actor_org ?? t("events.system"), payload: {}, defaultValue: h.type });
  return s.replace(/\s*…?\{\{[^}]*\}\}/g, "").trim();
}
