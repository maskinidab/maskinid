import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { ScanButton } from "../../../components/Scanner";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { MachineView, OrgBrief } from "../../../lib/api/types";
import { formatDate, formatMonth, formatNumber } from "../../../lib/format";
import { fleetReportPdf, type FleetReport, type FleetReportRow } from "../../../lib/pdf/fleetReport";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { ReminderList, type Reminder } from "../machines/ServiceTab";

type Tab = "todo" | "projects" | "report" | "clients";
interface Project { id: string; name: string; site_address: string | null; reference: string | null; starts_on: string | null; ends_on: string | null; archived_at: string | null; machine_count: number }
interface Grant { id: string; kind: string; direction: "in" | "out"; owner: OrgBrief; client: OrgBrief; project: { id: string; name: string } | null; created_at: string }

/** Fleet (SPEC §7.1): what needs doing, projects/sites, fleet & procurement report, clients following the report. */
export function FleetPage() {
  const { t } = useTranslation();
  const { orgId, isAdmin } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "todo";
  const tabs: { id: Tab; label: string }[] = [
    { id: "todo", label: t("fleet.tab_todo") }, { id: "projects", label: t("fleet.tab_projects") }, { id: "report", label: t("fleet.tab_report") },
    ...(isAdmin ? [{ id: "clients" as Tab, label: t("fleet.tab_clients") }] : []),
  ];
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.fleet")} lead={t("fleet.lead")} actions={<HoursByScan />} />
      <Tabs panels label={t("nav.fleet")} tabs={tabs} value={tab} onChange={(x) => setParams({ tab: x }, { replace: true })} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`flik-${tab}`} className="stack-5">
        {tab === "todo" && <Todo orgId={orgId} />}
        {tab === "projects" && <Projects />}
        {tab === "report" && <Report />}
        {tab === "clients" && <Clients />}
      </div>
    </div>
  );
}

function Todo({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const q = useRpc<Reminder[]>("list_reminders", { p_org_id: orgId });
  const overdue = (q.data ?? []).filter((r) => r.overdue);
  const soon = (q.data ?? []).filter((r) => !r.overdue);
  return (
    <>
      {overdue.length > 0 && (
        <section className="stack-3" aria-labelledby="forsenat">
          <h2 id="forsenat" className="t-rubrik-4">{t("fleet.overdue", { count: overdue.length })}</h2>
          <ReminderList items={overdue} showMachine />
        </section>
      )}
      <section className="stack-3" aria-labelledby="kommande">
        <h2 id="kommande" className="t-rubrik-4">{t("fleet.upcoming")}</h2>
        <p className="t-liten t-sekundar">{t("fleet.digest_note")}</p>
        <ReminderList items={soon} loading={q.isLoading} showMachine />
      </section>
    </>
  );
}

/** "Rapportera timmar" by scanning the label (SPEC §7.1 Timmätare). */
function HoursByScan() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [m, setM] = useState<MachineView | null>(null);
  const [hours, setHours] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  return (
    <>
      <ScanButton tone="kontur" onResult={async (r) => {
        setError(null);
        setDone(false);
        try {
          let reg = r.kind === "reg" ? r.reg : null;
          if (r.kind === "label") reg = (await rpc<{ card?: { reg_number: string } }>("public_machine_card", { p_code: r.code })).card?.reg_number ?? null;
          const hits = reg ? await rpc<MachineView[]>("lookup_machine", { p_org_id: orgId, p_query: reg }) : [];
          setM(hits[0] ?? null);
          if (!hits[0]) setError(new Error("NOT_FOUND"));
        } catch (e) { setError(e); }
      }} />
      <Dialog open={!!m || error != null} onClose={() => { setM(null); setError(null); setHours(""); }} title={t("fleet.report_hours")}>
        {error != null && !m ? <Notice kind="fel" title={t("check.not_found")} /> : m && (
          <form className="stack-4" onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await rpc("record_hours", { p_org_id: orgId, p_machine_id: m.id, p_hours: Number(hours.replace(/\s/g, "")) });
              setDone(true);
              await queryClient.invalidateQueries({ queryKey: ["rpc"] });
            } catch (err) { setError(err); }
          }}>
            <p><RegNumber value={m.reg_number} /> {m.make} {m.model}</p>
            <FormField label={t("machine.hours")} hint={m.hour_meter !== null ? t("service.hours_now", { hours: formatNumber(m.hour_meter) }) : undefined}>
              <input className="mid-input" inputMode="numeric" autoFocus value={hours} onChange={(e) => setHours(e.target.value)} />
            </FormField>
            {error != null && <ErrorNotice error={error} />}
            {done && <Notice kind="ok" title={t("service.hours_saved")} />}
            <div className="mid-rad mid-rad-slut"><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!hours.trim()}>{t("service.hours_report")}</button></div>
          </form>
        )}
      </Dialog>
    </>
  );
}

function Projects() {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const [archived, setArchived] = useState(false);
  const q = useRpc<Project[]>("list_projects", { p_org_id: orgId, p_include_archived: archived });
  const [edit, setEdit] = useState<Partial<Project> | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setError(null);
    try {
      await rpc("save_project", { p_org_id: orgId, p_project_id: edit!.id ?? null, p_data: { ...edit, archived: !!edit!.archived_at } });
      setEdit(null);
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) { setError(e); }
  }
  return (
    <>
      <div className="mid-rad mid-rad-mellan">
        <label className="mid-kryss"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{t("fleet.show_archived")}</label>
        {canWrite && <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setEdit({ name: "" })}><Icon name="plus" />{t("fleet.new_project")}</button>}
      </div>
      {q.isLoading ? <Skeleton /> : (
        <DataTable caption={t("fleet.tab_projects")} rows={q.data ?? []} getKey={(p) => p.id} exportName="projekt"
          empty={<EmptyState icon="bygg" title={t("fleet.no_projects")} body={t("fleet.no_projects_body")} />}
          columns={[
            { id: "name", header: t("common.name"), value: (p) => p.name, sortable: true, cell: (p) => (
              <button type="button" className="mid-lank-knapp mid-lank" onClick={() => setEdit(p)}>{p.name}</button>) },
            { id: "site", header: t("fleet.site_address"), value: (p) => p.site_address, cell: (p) => p.site_address ?? "–", hideOnMobile: true },
            { id: "period", header: t("fleet.period"), value: (p) => p.starts_on, cell: (p) => [formatDate(p.starts_on), formatDate(p.ends_on)].filter(Boolean).join(" – ") || "–", hideOnMobile: true },
            { id: "n", header: t("fleet.machines_on_site"), value: (p) => p.machine_count, cell: (p) => p.machine_count, sortable: true },
            { id: "report", header: "", cell: (p) => <Link className="mid-lank" to={`?tab=report&project=${p.id}`}>{t("fleet.tab_report")}</Link> },
          ]} />
      )}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t("fleet.edit_project") : t("fleet.new_project")}>
        {edit && (
          <form className="stack-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <FormField label={t("common.name")}><input className="mid-input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></FormField>
            <FormField label={t("fleet.site_address")} optional><input className="mid-input" value={edit.site_address ?? ""} onChange={(e) => setEdit({ ...edit, site_address: e.target.value })} /></FormField>
            <FormField label={t("fleet.reference")} optional hint={t("fleet.reference_hint")}><input className="mid-input" value={edit.reference ?? ""} onChange={(e) => setEdit({ ...edit, reference: e.target.value })} /></FormField>
            <div className="rutnat">
              <FormField className="kol-6" label={t("fleet.starts_on")} optional><input className="mid-input" type="date" value={edit.starts_on ?? ""} onChange={(e) => setEdit({ ...edit, starts_on: e.target.value || null })} /></FormField>
              <FormField className="kol-6" label={t("fleet.ends_on")} optional><input className="mid-input" type="date" value={edit.ends_on ?? ""} onChange={(e) => setEdit({ ...edit, ends_on: e.target.value || null })} /></FormField>
            </div>
            {edit.id && <label className="mid-kryss"><input type="checkbox" checked={!!edit.archived_at} onChange={(e) => setEdit({ ...edit, archived_at: e.target.checked ? new Date().toISOString() : null })} />{t("fleet.archive")}</label>}
            {error != null && <ErrorNotice error={error} />}
            <div className="mid-rad mid-rad-slut">
              <button type="button" className="mid-knapp mid-knapp-text" onClick={() => setEdit(null)}>{t("common.cancel")}</button>
              <button type="submit" className="mid-knapp mid-knapp-primar">{t("common.save")}</button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function FleetReportTable({ report }: { report: FleetReport }) {
  const { t } = useTranslation();
  const s = report.summary;
  const project = report.kind === "project_list";
  return (
    <div className="stack-4">
      {!project && (
        <dl className="nyckeltal">
          <div><dt>{t("fleet.col.machines")}</dt><dd>{s.count}</dd></div>
          <div><dt>{t("fleet.sum_stage_v")}</dt><dd>{s.stage_v_or_zero}</dd></div>
          <div><dt>{t("fleet.sum_electric")}</dt><dd>{s.electric}</dd></div>
          <div><dt>{t("fleet.sum_level2")}</dt><dd>{s.level_2}</dd></div>
          <div><dt>{t("fleet.sum_inspection_due")}</dt><dd>{s.inspection_due}</dd></div>
        </dl>
      )}
      <DataTable<FleetReportRow> caption={t("fleet.report_title")} rows={report.machines} getKey={(r) => r.reg_number} exportName="flottrapport"
        empty={<EmptyState icon="maskin" title={t("machines.empty_title")} />}
        columns={[
          { id: "reg", header: t("fleet.col.reg"), value: (r) => r.reg_number, cell: (r) => <RegNumber value={r.reg_number} />, sortable: true },
          { id: "machine", header: t("fleet.col.machine"), value: (r) => `${r.make} ${r.model}`, cell: (r) => <>{r.make} {r.model}{r.year ? ` · ${r.year}` : ""}</>, sortable: true },
          ...(project ? [
            { id: "cat", header: t("fleet.col.category"), value: (r: FleetReportRow) => r.category, cell: (r: FleetReportRow) => t(`enum.category.${r.category}`) },
          ] : [
            { id: "emission", header: t("fleet.col.emission"), value: (r: FleetReportRow) => r.emission_stage, cell: (r: FleetReportRow) => (r.emission_stage ? t(`enum.emission.${r.emission_stage}`) : "–"), sortable: true },
            { id: "fuel", header: t("fleet.col.fuel"), value: (r: FleetReportRow) => r.fuel_type, cell: (r: FleetReportRow) => (r.fuel_type ? t(`enum.fuel.${r.fuel_type}`) : "–") },
            { id: "weight", header: t("fleet.col.weight"), value: (r: FleetReportRow) => r.service_weight_kg, cell: (r: FleetReportRow) => (r.service_weight_kg ? `${formatNumber(r.service_weight_kg)} kg` : "–"), hideOnMobile: true },
            { id: "power", header: t("fleet.col.power"), value: (r: FleetReportRow) => r.engine_power_kw, cell: (r: FleetReportRow) => (r.engine_power_kw ? `${formatNumber(r.engine_power_kw)} kW` : "–"), hideOnMobile: true },
            { id: "insp", header: t("fleet.col.inspection"), value: (r: FleetReportRow) => r.inspection_valid_until,
              cell: (r: FleetReportRow) => (!r.has_lifting_device ? t("fleet.not_required") : r.inspection_valid_until ? formatMonth(r.inspection_valid_until) : <span className="t-fel">{t("fleet.inspection_missing_short")}</span>) },
          ]),
          { id: "level", header: t("fleet.col.level"), value: (r) => r.verification_level, cell: (r) => t(`level.${r.verification_level}.name`), sortable: true },
          { id: "project", header: t("fleet.col.project"), value: (r) => r.project, cell: (r) => r.project ?? "–", hideOnMobile: true },
        ]} />
    </div>
  );
}

function Report() {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const [params, setParams] = useSearchParams();
  const project = params.get("project") ?? "";
  const [kind, setKind] = useState<"fleet_report" | "project_list">("fleet_report");
  const projects = useRpc<Project[]>("list_projects", { p_org_id: orgId });
  const q = useRpc<FleetReport>("get_fleet_report", { p_org_id: orgId, p_project_id: project || null, p_kind: kind });
  const [share, setShare] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function pdf() {
    setBusy(true);
    setError(null);
    try {
      const s = await rpc<{ report_number: string; result_hash: string; result: FleetReport }>("create_fleet_report", { p_org_id: orgId, p_project_id: project || null, p_kind: kind });
      downloadBytes(await fleetReportPdf(s.result, s, t), `${kind === "project_list" ? "projektlista" : "flottrapport"}-${s.report_number}.pdf`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function link() {
    setError(null);
    try {
      const r = await rpc<{ token: string }>("create_share_link", { p_org_id: orgId, p_machine_id: null, p_scope: kind, p_days: 30,
        p_params: project ? { project_id: project } : {} });
      setShare(`${location.origin}/s/${r.token}`);
    } catch (e) { setError(e); }
  }
  return (
    <>
      <div className="rutnat">
        <FormField className="kol-6" label={t("fleet.col.project")}>
          <select className="mid-select" value={project} onChange={(e) => setParams({ tab: "report", ...(e.target.value ? { project: e.target.value } : {}) }, { replace: true })}>
            <option value="">{t("fleet.all_machines")}</option>
            {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("fleet.report_kind")}>
          <select className="mid-select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="fleet_report">{t("fleet.report_title")}</option>
            <option value="project_list">{t("fleet.project_list_title")}</option>
          </select>
        </FormField>
      </div>
      <p className="t-liten t-sekundar">{t(kind === "project_list" ? "fleet.project_list_lead" : "fleet.report_lead")}</p>
      {canWrite && (
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy} onClick={() => void pdf()}><Icon name="nedladdning" />{t("fleet.download_pdf")}</button>
          <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => void link()}><Icon name="lank" />{t("fleet.share_link")}</button>
        </div>
      )}
      {share && (
        <Notice kind="ok" title={t("fleet.share_created")}>
          <div className="mid-sok-rad"><input className="mid-input is-id" readOnly value={share} onFocus={(e) => e.currentTarget.select()} aria-label={t("actions.share.link")} />
            <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={() => void navigator.clipboard?.writeText(share)}><Icon name="kopiera" />{t("common.copy")}</button></div>
        </Notice>
      )}
      {error != null && <ErrorNotice error={error} />}
      {q.isLoading ? <Skeleton lines={6} /> : q.data && <FleetReportTable report={q.data} />}
    </>
  );
}

function Clients() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const grants = useRpc<Grant[]>("list_report_grants", { p_org_id: orgId });
  const clients = useRpc<OrgBrief[]>("list_partner_orgs", { p_type: "client" });
  const projects = useRpc<Project[]>("list_projects", { p_org_id: orgId });
  const [client, setClient] = useState("");
  const [project, setProject] = useState("");
  const [error, setError] = useState<unknown>(null);
  const out = (grants.data ?? []).filter((g) => g.direction === "out");
  return (
    <>
      <p className="t-brodtext">{t("fleet.clients_lead")}</p>
      <form className="panel stack-3" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await rpc("grant_report_access", { p_org_id: orgId, p_client_org_id: client, p_project_id: project || null });
          setClient("");
          await queryClient.invalidateQueries({ queryKey: ["rpc"] });
        } catch (err) { setError(err); }
      }}>
        <div className="rutnat">
          <FormField className="kol-6" label={t("fleet.client")}>
            <select className="mid-select" value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">{t("common.select")}</option>
              {(clients.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </FormField>
          <FormField className="kol-6" label={t("fleet.col.project")}>
            <select className="mid-select" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">{t("fleet.all_machines")}</option>
              {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormField>
        </div>
        {error != null && <ErrorNotice error={error} />}
        <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!client}>{t("fleet.grant")}</button></div>
      </form>
      {out.length === 0 ? <p className="t-liten t-sekundar">{t("fleet.no_grants")}</p> : (
        <ul className="radlista">
          {out.map((g) => (
            <li key={g.id}>
              <span><strong>{g.client.name}</strong> · {g.project?.name ?? t("fleet.all_machines")}<br /><span className="t-liten t-sekundar">{t("fleet.granted", { date: formatDate(g.created_at) })}</span></span>
              <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={async () => {
                await rpc("revoke_report_access", { p_org_id: orgId, p_grant_id: g.id });
                await queryClient.invalidateQueries({ queryKey: ["rpc"] });
              }}>{t("fleet.revoke")}</button>
            </li>
          ))}
        </ul>
      )}
      <PublicBadgeSetting />
    </>
  );
}

function PublicBadgeSetting() {
  const { t } = useTranslation();
  const { orgId, org } = useOrg();
  const current = useRpc<{ settings?: { show_inspection_publicly?: boolean } }>("get_org", { p_org_id: orgId });
  const on = !!current.data?.settings?.show_inspection_publicly;
  return (
    <section className="panel stack-2" aria-labelledby="publikt-marke">
      <h2 id="publikt-marke" className="t-rubrik-4">{t("fleet.public_badge_title")}</h2>
      <label className="mid-kryss">
        <input type="checkbox" checked={on} onChange={async (e) => {
          await rpc("set_public_inspection_badge", { p_org_id: orgId, p_show: e.target.checked });
          await queryClient.invalidateQueries({ queryKey: ["rpc"] });
        }} />
        {t("fleet.public_badge", { org: org.name })}
      </label>
    </section>
  );
}
