import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import { formatDate, formatNumber, todayIso } from "../../../lib/format";
import { climatePdf, type ClimateReport } from "../../../lib/pdf/climate";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { MachineSelect } from "./EquipmentPages";

export const FUELS = ["diesel", "hvo100", "rme", "petrol", "biogas", "electricity", "other"] as const;
interface FuelEntry { id: string; machine_id: string; reg_number: string; make: string; model: string; entry_date: string; fuel: string; quantity: number; unit: string; hours: number | null; project: string | null }

/** Bränsle & klimat: fuel/energy log per machine and a climate report (CO2e) per period, machine and project. */
export function ClimatePage() {
  const { t } = useTranslation();
  const { orgId, path, canWrite } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "report";
  const [adding, setAdding] = useState(false);
  const fuel = useRpc<FuelEntry[]>("list_fuel", tab === "log" ? { p_org_id: orgId, p_limit: 1000 } : null);
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.climate")} lead={t("climate.lead")}
        actions={canWrite ? <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setAdding(true)}><Icon name="plus" />{t("climate.add_fuel")}</button> : undefined} />
      <Tabs label={t("nav.climate")} value={tab} onChange={(x) => setParams({ tab: x }, { replace: true })}
        tabs={[{ id: "report", label: t("climate.tab_report") }, { id: "log", label: t("climate.tab_log") }]} />
      {tab === "report" && <Report />}
      {tab === "log" && (fuel.isLoading ? <Skeleton lines={6} /> : fuel.error ? <ErrorNotice error={fuel.error} /> : (
        <DataTable caption={t("climate.tab_log")} rows={fuel.data!} getKey={(f) => f.id} exportName="bransle"
          empty={<EmptyState icon="lista" title={t("climate.no_fuel")} />}
          filters={[{ id: "fuel", label: t("climate.fuel_label"), options: FUELS.map((f) => ({ value: f, label: t(`climate.fuel.${f}`) })), match: (f, v) => f.fuel === v }]}
          columns={[
            { id: "date", header: t("common.date"), value: (f) => f.entry_date, sortable: true, cell: (f) => formatDate(f.entry_date) },
            { id: "machine", header: t("machines.col_machine"), value: (f) => f.reg_number,
              cell: (f) => <><Link to={path(`machines/${f.machine_id}`)}><RegNumber value={f.reg_number} /></Link><br /><span className="t-liten">{f.make} {f.model}</span></> },
            { id: "fuel", header: t("climate.fuel_label"), value: (f) => f.fuel, cell: (f) => t(`climate.fuel.${f.fuel}`) },
            { id: "qty", header: t("climate.quantity"), value: (f) => f.quantity, sortable: true, cell: (f) => `${formatNumber(f.quantity)} ${f.unit}` },
            { id: "project", header: t("fleet.col.project"), value: (f) => f.project ?? "", hideOnMobile: true, cell: (f) => f.project ?? "–" },
          ]} />
      ))}
      {adding && <FuelDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function Report() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(todayIso());
  const q = useRpc<ClimateReport>("get_climate_report", { p_org_id: orgId, p_from: from, p_to: to });
  const [err, setErr] = useState<unknown>(null);
  async function pdf() {
    setErr(null);
    try {
      const s = await rpc<{ report_number: string; result_hash: string; result: ClimateReport }>("create_climate_report", { p_org_id: orgId, p_from: from, p_to: to });
      downloadBytes(await climatePdf(s.result, s, t), `klimatrapport-${s.report_number}.pdf`);
    } catch (e) { setErr(e); }
  }
  const r = q.data;
  return (
    <section className="stack-5">
      <div className="mid-rad">
        <FormField label={t("climate.from")}><input className="mid-input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></FormField>
        <FormField label={t("climate.to")}><input className="mid-input" type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} /></FormField>
      </div>
      {q.error && <ErrorNotice error={q.error} />}
      {!!err && <ErrorNotice error={err} />}
      {q.isLoading ? <Skeleton lines={5} /> : r && (r.totals.entries === 0 ? <EmptyState icon="diagram" title={t("climate.no_data")} body={t("climate.no_data_body")} /> : (
        <>
          <dl className="nyckeltal">
            <div><dt>{t("climate.total")}</dt><dd>{formatNumber(Math.round(r.totals.co2e_kg / 100) / 10)} t</dd><dd className="nyckeltal-not">CO2e</dd></div>
            {r.totals.fossil_free_share != null && <div><dt>{t("climate.fossil_free")}</dt><dd>{formatNumber(r.totals.fossil_free_share)} %</dd></div>}
            {r.by_fuel.map((f) => <div key={f.fuel}><dt>{t(`climate.fuel.${f.fuel}`)}</dt><dd>{formatNumber(Math.round(f.quantity))}</dd><dd className="nyckeltal-not">{f.unit}</dd></div>)}
          </dl>
          <DataTable caption={t("climate.by_machine")} rows={r.by_machine} getKey={(m) => m.reg_number} exportName="klimat-per-maskin"
            columns={[
              { id: "reg", header: t("machines.col_reg"), value: (m) => m.reg_number, cell: (m) => <RegNumber value={m.reg_number} /> },
              { id: "machine", header: t("machines.col_machine"), value: (m) => `${m.make} ${m.model}`, cell: (m) => <>{m.make} {m.model}<br /><span className="t-liten t-sekundar">{m.emission_stage ? t(`enum.emission.${m.emission_stage}`) : ""}</span></> },
              { id: "l", header: t("climate.litres"), value: (m) => m.quantity_l ?? 0, sortable: true, cell: (m) => (m.quantity_l ? formatNumber(m.quantity_l) : "–") },
              { id: "co2", header: "t CO2e", value: (m) => m.co2e_kg, sortable: true, cell: (m) => formatNumber(Math.round(m.co2e_kg / 100) / 10) },
            ]} />
          <div><button type="button" className="mid-knapp mid-knapp-primar" onClick={() => void pdf()}><Icon name="nedladdning" />{t("climate.download")}</button></div>
          <p className="t-liten t-sekundar">{t("climate.method")}</p>
        </>
      ))}
    </section>
  );
}

export function FuelDialog({ onClose, machineId }: { onClose(): void; machineId?: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [d, setD] = useState({ machine: machineId ?? "", fuel: "diesel", quantity: "", entry_date: todayIso(), hours: "" });
  const m = useRpcMutation<{ p_org_id: string; p_machine_id: string; p_data: Record<string, unknown> }>("log_fuel", { onSuccess: onClose });
  const unit = d.fuel === "electricity" ? "kWh" : d.fuel === "biogas" ? "kg" : "l";
  return (
    <Dialog open onClose={onClose} title={t("climate.add_fuel")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ p_org_id: orgId, p_machine_id: d.machine,
        p_data: { fuel: d.fuel, quantity: d.quantity.replace(",", ".").replace(/\s/g, ""), entry_date: d.entry_date, hours: d.hours.replace(/\s/g, "") || null } }); }}>
        {!machineId && <FormField label={t("machines.col_machine")}><MachineSelect value={d.machine} onChange={(v) => setD({ ...d, machine: v })} /></FormField>}
        <div className="rutnat">
          <FormField className="kol-6" label={t("climate.fuel_label")}>
            <select className="mid-select" value={d.fuel} onChange={(e) => setD({ ...d, fuel: e.target.value })}>{FUELS.map((f) => <option key={f} value={f}>{t(`climate.fuel.${f}`)}</option>)}</select>
          </FormField>
          <FormField className="kol-6" label={`${t("climate.quantity")} (${unit})`}><input className="mid-input" inputMode="decimal" value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value })} required /></FormField>
          <FormField className="kol-6" label={t("common.date")}><input className="mid-input" type="date" max={todayIso()} value={d.entry_date} onChange={(e) => setD({ ...d, entry_date: e.target.value })} /></FormField>
          <FormField className="kol-6" label={t("machine.hours")} optional><input className="mid-input" inputMode="numeric" value={d.hours} onChange={(e) => setD({ ...d, hours: e.target.value })} /></FormField>
        </div>
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!d.machine || !d.quantity || m.isPending}>{t("common.save")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
