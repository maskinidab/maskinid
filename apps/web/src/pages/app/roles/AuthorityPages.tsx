import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { ReceiptCard, type CheckReceipt } from "../../../components/ReceiptCard";
import { RegNumber } from "../../../components/RegNumber";
import { ScanButton } from "../../../components/Scanner";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { rpc, useRpc } from "../../../lib/api/query";
import type { MachineListItem } from "../../../lib/api/types";
import { formatDateTime } from "../../../lib/format";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { toCsv } from "../../../lib/tabular";
import { useReceiptPdf } from "../check/CheckPage";

type Hit = MachineListItem & { owner: string | null; serial_full: string | null };
const CATEGORIES = ["excavator_tracked", "excavator_wheeled", "wheel_loader", "backhoe", "dumper", "dozer", "grader", "roller", "paver",
  "telehandler", "forklift", "crane_mobile", "drill_rig", "crusher", "screener", "compressor", "generator", "forestry_harvester",
  "forestry_forwarder", "skidder", "tractor", "trailer_heavy", "attachment", "other"];

/** Authority search (SPEC §7.5): partial reg number/serial (≥ 4 characters) or make + model + year. Every hit is logged. */
export function AuthoritySearchPage() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const [f, setF] = useState({ query: "", make: "", model: "", year: "" });
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setHits(await rpc<Hit[]>("authority_search", { p_org_id: orgId, p_query: f.query || null, p_make: f.make || null, p_model: f.model || null,
        p_year: f.year ? Number(f.year) : null }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.search")} lead={t("authority.search_lead")} />
      <form className="panel stack-3" onSubmit={search}>
        <FormField label={t("authority.query")} hint={t("authority.query_hint")}>
          <input className="mid-input is-id" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} autoCapitalize="characters" />
        </FormField>
        <div className="rutnat">
          <FormField className="kol-4" label={t("wizard.make")} optional><input className="mid-input" value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} /></FormField>
          <FormField className="kol-4" label={t("wizard.model")} optional><input className="mid-input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></FormField>
          <FormField className="kol-4" label={t("machines.col_year")} optional><input className="mid-input" inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></FormField>
        </div>
        <p className="t-liten t-sekundar">{t("authority.logged")}</p>
        <div className="mid-rad"><button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}><Icon name="sok" />{t("common.search")}</button></div>
      </form>
      {error != null && <ErrorNotice error={error} />}
      {hits && (
        <DataTable caption={t("common.results")} rows={hits} getKey={(h) => h.id} exportName="sokresultat"
          empty={<EmptyState icon="sok" title={t("check.not_found")} />}
          columns={[
            { id: "reg", header: t("machines.col_reg"), value: (h) => h.reg_number, cell: (h) => <Link to={path(`machines/${h.id}`)}><RegNumber value={h.reg_number} /></Link> },
            { id: "machine", header: t("machines.col_machine"), value: (h) => `${h.make} ${h.model}`, cell: (h) => `${h.make} ${h.model}${h.year ? ` · ${h.year}` : ""}` },
            { id: "serial", header: t("machines.col_serial"), value: (h) => h.serial_full, cell: (h) => <span className="mid-id">{h.serial_full ?? "–"}</span> },
            { id: "owner", header: t("machine.owner"), value: (h) => h.owner, cell: (h) => h.owner ?? "–" },
            { id: "status", header: t("common.status"), value: (h) => h.status, cell: (h) => (
              <span className="badge-rad"><MachineStatusBadge status={h.status} /><VerificationBadge level={h.verification_level} /><FinancingBadge hasActive={h.has_active_financing} /></span>) },
          ]} />
      )}
    </div>
  );
}

interface FlagRow { id: string; type: string; status: string; reference: string | null; raised_at: string; location_text: string | null; raised_by: string | null;
  machine_id: string; reg_number: string; make: string; model: string; year: number | null; owner: string | null; serial: string | null;
  last_scan: { at: string; location: { city?: string; lat?: number; lon?: number } | null } | null }

/** All flags (SPEC §7.5): wanted/seized/blocked machines with the latest scan. */
export function FlagsPage() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const [status, setStatus] = useState("active");
  const q = useRpc<FlagRow[]>("list_flags", { p_org_id: orgId, p_status: status || null });
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.flags")} lead={t("authority.flags_lead")} />
      <FormField label={t("common.status")}>
        <select className="mid-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">{t("authority.flags_active")}</option><option value="cleared">{t("authority.flags_cleared")}</option><option value="">{t("common.all")}</option>
        </select>
      </FormField>
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.flags")} rows={q.data ?? []} getKey={(r) => r.id} exportName="flaggor"
          empty={<EmptyState icon="flagga" title={t("authority.no_flags")} />}
          filters={[{ id: "type", label: t("common.type"), options: ["stolen", "seized", "blocked", "under_investigation", "disputed"].map((x) => ({ value: x, label: t(`enum.flag_type.${x}`) })), match: (r, v) => r.type === v }]}
          columns={[
            { id: "type", header: t("common.type"), value: (r) => r.type, cell: (r) => <strong>{t(`enum.flag_type.${r.type}`)}</strong> },
            { id: "reg", header: t("machines.col_reg"), value: (r) => r.reg_number, cell: (r) => <Link to={path(`machines/${r.machine_id}?tab=access`)}><RegNumber value={r.reg_number} /></Link> },
            { id: "machine", header: t("machines.col_machine"), value: (r) => `${r.make} ${r.model}`, cell: (r) => <>{r.make} {r.model}<br /><span className="t-liten mid-id">{r.serial ?? ""}</span></> },
            { id: "ref", header: t("actions.flag.reference"), value: (r) => r.reference, cell: (r) => <>{r.reference ?? "–"}<br /><span className="t-liten t-sekundar">{r.raised_by ?? ""}</span></> },
            { id: "at", header: t("common.date"), value: (r) => r.raised_at, cell: (r) => formatDateTime(r.raised_at), sortable: true },
            { id: "scan", header: t("authority.last_scan"), value: (r) => r.last_scan?.at ?? "", cell: (r) => r.last_scan
              ? <>{formatDateTime(r.last_scan.at)}<br /><span className="t-liten t-sekundar">{r.last_scan.location?.city ?? ""}</span></> : "–" },
          ]} />
      )}
    </div>
  );
}

/** Tullverket export check (SPEC §7.5): look up at the border; active financing ⇒ warning. Creates a receipt. */
export function ExportCheckPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const pdf = useReceiptPdf();
  const [value, setValue] = useState("");
  const [r, setR] = useState<CheckReceipt | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function check(v: string) {
    setError(null);
    setR(null);
    try { setR(await rpc<CheckReceipt>("perform_check", { p_org_id: orgId, p_query: { type: "any", value: v }, p_purpose: "export_check" })); } catch (e) { setError(e); }
  }
  const x = r?.result;
  const stolen = x?.flags?.some((f) => f.type === "stolen" || f.type === "seized");
  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("nav.export_check")} lead={t("authority.export_lead")} />
      <form className="panel stack-3" onSubmit={(e) => { e.preventDefault(); void check(value); }}>
        <div className="mid-sok-rad">
          <input className="mid-input is-id" aria-label={t("check.query")} value={value} onChange={(e) => setValue(e.target.value)} autoCapitalize="characters" />
          <button type="submit" className="mid-knapp mid-knapp-primar"><Icon name="sok" />{t("check.submit")}</button>
        </div>
        <div><ScanButton onResult={async (s) => {
          if (s.kind === "reg") { setValue(s.reg); return check(s.reg); }
          const c = await rpc<{ card?: { reg_number: string } }>("public_machine_card", { p_code: s.code });
          if (c.card) { setValue(c.card.reg_number); await check(c.card.reg_number); }
        }} /></div>
      </form>
      {error != null && <ErrorNotice error={error} />}
      {x?.found && stolen && <Notice kind="fel" title={t("authority.export_stolen")} />}
      {x?.found && !stolen && x.has_active_financing && <Notice kind="fel" title={t("authority.export_financed", { holder: x.financing?.holder ?? "" })} />}
      {x?.found && !stolen && !x.has_active_financing && <Notice kind="ok" title={t("authority.export_clear")} />}
      {r && <ReceiptCard r={r} onPdf={() => void pdf(r)} />}
    </div>
  );
}

interface PrepRow { county: string | null; category: string; weight_class: string; count: number; electric: number }

/** Preparedness export (beredskapsexport, SPEC §7.5): aggregate by county, category and weight – no owner data. */
export function ExportsPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [cat, setCat] = useState("");
  const [data, setData] = useState<{ generated_at: string; total: number; rows: PrepRow[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function run() {
    setError(null);
    try { setData(await rpc("authority_preparedness_export", { p_org_id: orgId, p_category: cat || null })); } catch (e) { setError(e); }
  }
  function csv() {
    const text = toCsv([t("authority.county"), t("wizard.category"), t("authority.weight_class"), t("authority.count"), t("fleet.sum_electric")],
      data!.rows.map((r) => [r.county ?? t("authority.unknown_county"), t(`enum.category.${r.category}`), t(`authority.weight.${r.weight_class}`), r.count, r.electric]));
    downloadBytes(new TextEncoder().encode(text), "beredskapsexport.csv", "text/csv");
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.exports")} lead={t("authority.prep_lead")} />
      <div className="panel stack-3">
        <FormField label={t("wizard.category")} optional>
          <select className="mid-select" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t("common.all")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`enum.category.${c}`)}</option>)}
          </select>
        </FormField>
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => void run()}>{t("authority.prep_run")}</button>
          {data && <button type="button" className="mid-knapp mid-knapp-kontur" onClick={csv}><Icon name="nedladdning" />{t("common.export_csv")}</button>}
        </div>
      </div>
      {error != null && <ErrorNotice error={error} />}
      {data && (
        <>
          <p className="t-liten t-sekundar">{t("authority.prep_total", { count: data.total, date: formatDateTime(data.generated_at) })}</p>
          <div className="mid-tabell-wrap">
            <table className="mid-tabell">
              <thead><tr><th scope="col">{t("authority.county")}</th><th scope="col">{t("wizard.category")}</th><th scope="col">{t("authority.weight_class")}</th>
                <th scope="col">{t("authority.count")}</th><th scope="col">{t("fleet.sum_electric")}</th></tr></thead>
              <tbody>{data.rows.map((r, i) => (
                <tr key={i}><td>{r.county ?? t("authority.unknown_county")}</td><td>{t(`enum.category.${r.category}`)}</td><td>{t(`authority.weight.${r.weight_class}`)}</td>
                  <td>{r.count}</td><td>{r.electric}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
