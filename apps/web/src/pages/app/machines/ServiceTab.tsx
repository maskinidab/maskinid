import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DocumentDropzone } from "../../../components/DocumentDropzone";
import { Dialog } from "../../../components/Dialog";
import { ErrorNotice, Notice, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { MachineView } from "../../../lib/api/types";
import { formatDate, formatNumber, todayIso } from "../../../lib/format";

export interface MaintenanceEntry {
  id: string; type: string; performed_at: string; hours: number | null; performed_by_text: string | null; performed_by_org_name: string | null;
  notes: string | null; next_due_at: string | null; next_due_hours: number | null; org_name: string; created_at: string;
}
export interface Inspection {
  id: string; type: string; performed_at: string; result: string; valid_until: string | null; inspection_body_name: string;
  certificate_no: string | null; remarks: string | null; hours_at_inspection: number | null;
}
export interface Reminder {
  id: string; type: string; title: string; due_at: string | null; due_hours: number | null; status: string; overdue: boolean;
  machine_id: string | null; reg_number: string | null; make: string | null; model: string | null; hour_meter: number | null;
}
interface Policy { id: string; insurer_name: string; policy_number: string; valid_from: string; valid_to: string; coverage: string; status: string }
interface Project { id: string; name: string; site_address: string | null; machine_count: number }

/** Hour meter readings as a small line chart (SVG, no library). */
export function HoursChart({ points }: { points: { at: string; hours: number }[] }) {
  const { t } = useTranslation();
  if (points.length < 2) return null;
  const w = 560, h = 120, pad = 8;
  const xs = points.map((p) => Date.parse(p.at));
  const ys = points.map((p) => p.hours);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (w - 2 * pad);
  const sy = (y: number) => h - pad - ((y - y0) / Math.max(1, y1 - y0)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(xs[i]!).toFixed(1)},${sy(p.hours).toFixed(1)}`).join(" ");
  return (
    <figure className="timgraf">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("service.chart_label", { from: formatNumber(y0), to: formatNumber(y1) })}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
        {points.map((p, i) => <circle key={i} cx={sx(xs[i]!)} cy={sy(p.hours)} r="3" fill="currentColor" />)}
      </svg>
      <figcaption className="t-liten t-sekundar">{formatDate(points[0]!.at)} – {formatDate(points.at(-1)!.at)} · {formatNumber(y0)}–{formatNumber(y1)} h</figcaption>
    </figure>
  );
}

export function ServiceTab({ m }: { m: MachineView }) {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const owner = m.relations.includes("owner") || m.relations.includes("user");
  const log = useRpc<MaintenanceEntry[]>("list_maintenance", { p_org_id: orgId, p_machine_id: m.id });
  const insp = useRpc<Inspection[]>("list_inspections", { p_org_id: orgId, p_machine_id: m.id });
  const reminders = useRpc<Reminder[]>("list_reminders", owner ? { p_org_id: orgId, p_machine_id: m.id } : null);
  const policies = useRpc<Policy[]>("list_insurance_policies", owner ? { p_org_id: orgId, p_machine_id: m.id } : null);
  const projects = useRpc<Project[]>("list_projects", owner ? { p_org_id: orgId } : null);
  const [dialog, setDialog] = useState<"service" | "inspection" | "insurance" | "reminder" | null>(null);
  const [hours, setHours] = useState("");
  const [hoursMsg, setHoursMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const write = owner && canWrite && !["scrapped", "exported", "deregistered"].includes(m.status);
  const readings = (log.data ?? []).filter((e) => e.hours !== null).map((e) => ({ at: e.performed_at, hours: e.hours! })).reverse();
  const assignment = m.assignment as { project_id: string; name: string } | undefined;

  async function saveHours(correction = false) {
    setError(null);
    setHoursMsg(null);
    try {
      const r = await rpc<{ due: { title: string }[] }>("record_hours", { p_org_id: orgId, p_machine_id: m.id, p_hours: Number(hours.replace(/\s/g, "")), p_correction: correction });
      setHours("");
      setHoursMsg(r.due.length ? t("service.hours_saved_due", { title: r.due[0]!.title }) : t("service.hours_saved"));
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack-6">
      {write && (
        <section className="panel stack-3" aria-labelledby="timmar">
          <h2 id="timmar" className="t-rubrik-4">{t("service.hours_title")}</h2>
          <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); if (hours.trim()) void saveHours(); }}>
            <input className="mid-input" inputMode="numeric" aria-label={t("machine.hours")} value={hours} onChange={(e) => setHours(e.target.value)}
              placeholder={m.hour_meter !== null ? t("service.hours_now", { hours: formatNumber(m.hour_meter) }) : "0"} />
            <button type="submit" className="mid-knapp mid-knapp-primar">{t("service.hours_report")}</button>
          </form>
          {error != null && (
            <div className="stack-2">
              <ErrorNotice error={error} />
              {(error as { detail?: { reason?: string } }).detail?.reason === "lower_than_current" && (
                <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void saveHours(true)}>{t("service.hours_correction")}</button>
              )}
            </div>
          )}
          {hoursMsg && <p className="t-liten" role="status"><Icon name="bock" className="ikon-inline" /> {hoursMsg}</p>}
          <HoursChart points={readings} />
        </section>
      )}

      {owner && (
        <section className="stack-3" aria-labelledby="projekt">
          <h2 id="projekt" className="t-rubrik-4">{t("service.project")}</h2>
          {write ? (
            <select className="mid-select" aria-labelledby="projekt" value={assignment?.project_id ?? ""}
              onChange={async (e) => { await rpc("assign_machine", { p_org_id: orgId, p_machine_id: m.id, p_project_id: e.target.value || null }); await queryClient.invalidateQueries({ queryKey: ["rpc"] }); }}>
              <option value="">{t("service.no_project")}</option>
              {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.site_address ? ` · ${p.site_address}` : ""}</option>)}
            </select>
          ) : <p>{assignment?.name ?? t("service.no_project")}</p>}
        </section>
      )}

      {owner && (
        <section className="stack-3" aria-labelledby="paminnelser">
          <div className="panel-huvud">
            <h2 id="paminnelser" className="t-rubrik-4">{t("service.reminders")}</h2>
            {write && <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => setDialog("reminder")}><Icon name="plus" />{t("service.add_reminder")}</button>}
          </div>
          <ReminderList items={reminders.data ?? []} loading={reminders.isLoading} />
        </section>
      )}

      <section className="stack-3" aria-labelledby="servicelogg">
        <div className="panel-huvud">
          <h2 id="servicelogg" className="t-rubrik-4">{t("service.log")}</h2>
          {write && <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => setDialog("service")}><Icon name="plus" />{t("service.add_entry")}</button>}
        </div>
        {log.isLoading ? <Skeleton /> : (log.data ?? []).filter((e) => e.type !== "hour_reading").length === 0 ? <p className="t-liten t-sekundar">{t("service.no_entries")}</p> : (
          <ol className="mid-historik">
            {log.data!.filter((e) => e.type !== "hour_reading").map((e) => (
              <li key={e.id}>
                <time dateTime={e.performed_at}>{formatDate(e.performed_at)}</time>
                <p><strong>{t(`enum.maintenance_type.${e.type}`)}</strong>{e.hours !== null && ` · ${formatNumber(e.hours)} h`}
                  {(e.performed_by_text || e.performed_by_org_name) && ` · ${e.performed_by_text ?? e.performed_by_org_name}`}</p>
                {e.notes && <p className="t-liten">{e.notes}</p>}
                {(e.next_due_at || e.next_due_hours) && <p className="t-liten t-sekundar">{t("service.next_due", {
                  when: [e.next_due_at && formatDate(e.next_due_at), e.next_due_hours && `${formatNumber(e.next_due_hours)} h`].filter(Boolean).join(" / ") })}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="stack-3" aria-labelledby="besiktning">
        <div className="panel-huvud">
          <h2 id="besiktning" className="t-rubrik-4">{t("service.inspections")}</h2>
          {write && <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => setDialog("inspection")}><Icon name="plus" />{t("service.add_inspection")}</button>}
        </div>
        {m.technical.has_lifting_device && !m.inspection_valid_until && <Notice kind="info" title={t("service.inspection_required")} />}
        {insp.isLoading ? <Skeleton /> : (insp.data ?? []).length === 0 ? <p className="t-liten t-sekundar">{t("service.no_inspections")}</p> : (
          <ul className="radlista">
            {insp.data!.map((i) => (
              <li key={i.id}>
                <span><strong>{t(`enum.inspection_type.${i.type}`)}</strong> · {formatDate(i.performed_at)} · {i.inspection_body_name}
                  {i.certificate_no && <> · <span className="mid-id">{i.certificate_no}</span></>}
                  {i.remarks && <><br /><span className="t-liten">{i.remarks}</span></>}</span>
                <span className="badge-rad">
                  <StatusBadge kind={i.result === "rejected" ? "sparr" : i.result === "approved" ? "verifierad" : "vantar"}>{t(`enum.inspection_result.${i.result}`)}</StatusBadge>
                  {i.valid_until && <span className="t-liten">{t("service.valid_until", { date: formatDate(i.valid_until) })}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {owner && (
        <section className="stack-3" aria-labelledby="forsakring">
          <div className="panel-huvud">
            <h2 id="forsakring" className="t-rubrik-4">{t("service.insurance")}</h2>
            {write && <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => setDialog("insurance")}><Icon name="plus" />{t("service.add_insurance")}</button>}
          </div>
          {(policies.data ?? []).length === 0 ? <p className="t-liten t-sekundar">{t("service.no_insurance")}</p> : (
            <ul className="radlista">
              {policies.data!.map((p) => (
                <li key={p.id}>
                  <span><strong>{p.insurer_name}</strong> · <span className="mid-id">{p.policy_number}</span> · {t(`service.coverage.${p.coverage}`)}</span>
                  <span className="t-liten">{formatDate(p.valid_from)} – {formatDate(p.valid_to)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {dialog === "service" && <MaintenanceDialog m={m} onClose={() => setDialog(null)} />}
      {dialog === "inspection" && <InspectionDialog machineId={m.id} onClose={() => setDialog(null)} owner />}
      {dialog === "insurance" && <InsuranceDialog machineId={m.id} onClose={() => setDialog(null)} />}
      {dialog === "reminder" && <ReminderDialog machineId={m.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

export function ReminderList({ items, loading, showMachine = false }: { items: Reminder[]; loading?: boolean; showMachine?: boolean }) {
  const { t } = useTranslation();
  const { orgId, path, canWrite } = useOrg();
  if (loading) return <Skeleton />;
  if (items.length === 0) return <p className="t-liten t-sekundar">{t("service.no_reminders")}</p>;
  const act = async (id: string, action: string, until?: string) => {
    await rpc("update_reminder", { p_org_id: orgId, p_reminder_id: id, p_action: action, p_snooze_until: until ?? null });
    await queryClient.invalidateQueries({ queryKey: ["rpc"] });
  };
  return (
    <ul className="radlista">
      {items.map((r) => (
        <li key={r.id}>
          <span>
            <strong>{r.title}</strong>{showMachine && r.reg_number && <> · <Link className="mid-lank mid-id" to={path(`machines/${r.machine_id}?tab=service`)}>{r.reg_number}</Link> {r.make} {r.model}</>}
            <br /><span className={r.overdue ? "t-liten t-fel" : "t-liten t-sekundar"}>
              {[r.due_at && formatDate(r.due_at), r.due_hours !== null && `${formatNumber(r.due_hours)} h`].filter(Boolean).join(" / ")}
              {r.overdue && ` · ${t("service.overdue")}`}
            </span>
          </span>
          {canWrite && (
            <span className="mid-rad">
              <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void act(r.id, "done")}><Icon name="bock" />{t("service.done")}</button>
              <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten"
                onClick={() => void act(r.id, "snooze", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))}>{t("service.snooze_week")}</button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function FormDialog({ title, onClose, onSubmit, children, submit }: { title: string; onClose(): void; onSubmit(): Promise<void>; children: React.ReactNode; submit?: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open onClose={onClose} title={title}>
      <form className="stack-4" noValidate onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try { await onSubmit(); await queryClient.invalidateQueries({ queryKey: ["rpc"] }); onClose(); } catch (err) { setError(err); } finally { setBusy(false); }
      }}>
        {children}
        {error != null && <ErrorNotice error={error} />}
        <div className="mid-rad mid-rad-slut">
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}>{busy ? t("common.loading") : submit ?? t("common.save")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function MaintenanceDialog({ m, onClose }: { m: MachineView; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [f, setF] = useState({ type: "service", performed_at: todayIso(), hours: m.hour_meter?.toString() ?? "", performed_by_text: "", notes: "",
    next_due_at: "", next_due_hours: "", document_id: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog title={t("service.add_entry")} onClose={onClose}
      onSubmit={() => rpc("add_maintenance", { p_org_id: orgId, p_machine_id: m.id, p_entry: { ...f, hours: f.hours || null, next_due_hours: f.next_due_hours || null,
        next_due_at: f.next_due_at || null, document_id: f.document_id || null } }).then(() => undefined)}>
      <div className="rutnat">
        <FormField className="kol-6" label={t("common.type")}>
          <select className="mid-select" value={f.type} onChange={set("type")}>
            {["service", "repair", "inspection", "other"].map((x) => <option key={x} value={x}>{t(`enum.maintenance_type.${x}`)}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("common.date")}>
          <input className="mid-input" type="date" max={todayIso()} value={f.performed_at} onChange={set("performed_at")} />
        </FormField>
        <FormField className="kol-6" label={t("machine.hours")} optional>
          <input className="mid-input" inputMode="numeric" value={f.hours} onChange={set("hours")} />
        </FormField>
        <FormField className="kol-6" label={t("service.performed_by")} optional>
          <input className="mid-input" value={f.performed_by_text} onChange={set("performed_by_text")} />
        </FormField>
      </div>
      <FormField label={t("common.note")} optional>
        <textarea className="mid-textarea" rows={3} value={f.notes} onChange={set("notes")} />
      </FormField>
      {f.type === "service" && (
        <div className="rutnat">
          <FormField className="kol-6" label={t("service.next_due_at")} optional>
            <input className="mid-input" type="date" min={todayIso()} value={f.next_due_at} onChange={set("next_due_at")} />
          </FormField>
          <FormField className="kol-6" label={t("service.next_due_hours")} optional hint={t("service.next_due_hint")}>
            <input className="mid-input" inputMode="numeric" value={f.next_due_hours} onChange={set("next_due_hours")} />
          </FormField>
        </div>
      )}
      <div className="stack-2">
        <p className="mid-etikett">{t("service.attach")}</p>
        {f.document_id ? <p className="t-liten"><Icon name="bock" className="ikon-inline" /> {t("service.attached")}</p> :
          <DocumentDropzone orgId={orgId} machineId={m.id} type="other" multiple={false} onUploaded={(d) => setF((x) => ({ ...x, document_id: d.id }))} />}
      </div>
    </FormDialog>
  );
}

export function InspectionDialog({ machineId, onClose, owner = false }: { machineId: string; onClose(): void; owner?: boolean }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [f, setF] = useState({ type: "periodic", performed_at: todayIso(), result: "approved", valid_until: "", certificate_no: "", remarks: "",
    inspection_body_name: "", hours: "", document_id: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog title={t("service.add_inspection")} onClose={onClose}
      onSubmit={() => rpc("record_inspection", { p_org_id: orgId, p_machine_id: machineId, p_data: { ...f, valid_until: f.valid_until || null,
        hours: f.hours || null, document_id: f.document_id || null } }).then(() => undefined)}>
      <div className="rutnat">
        <FormField className="kol-6" label={t("common.type")}>
          <select className="mid-select" value={f.type} onChange={set("type")}>
            {["first", "periodic", "revision", "extraordinary"].map((x) => <option key={x} value={x}>{t(`enum.inspection_type.${x}`)}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("common.date")}>
          <input className="mid-input" type="date" max={todayIso()} value={f.performed_at} onChange={set("performed_at")} />
        </FormField>
        <FormField className="kol-6" label={t("service.result")}>
          <select className="mid-select" value={f.result} onChange={set("result")}>
            {["approved", "approved_with_remarks", "rejected"].map((x) => <option key={x} value={x}>{t(`enum.inspection_result.${x}`)}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("service.valid_until_label")} optional={f.result === "rejected"}>
          <input className="mid-input" type="date" value={f.valid_until} onChange={set("valid_until")} />
        </FormField>
        <FormField className="kol-6" label={t("service.certificate_no")} optional>
          <input className="mid-input is-id" value={f.certificate_no} onChange={set("certificate_no")} />
        </FormField>
        <FormField className="kol-6" label={t("machine.hours")} optional>
          <input className="mid-input" inputMode="numeric" value={f.hours} onChange={set("hours")} />
        </FormField>
      </div>
      {owner && (
        <FormField label={t("service.inspection_body")}>
          <input className="mid-input" value={f.inspection_body_name} onChange={set("inspection_body_name")} />
        </FormField>
      )}
      <FormField label={t("service.remarks")} optional>
        <textarea className="mid-textarea" rows={2} value={f.remarks} onChange={set("remarks")} />
      </FormField>
      <div className="stack-2">
        <p className="mid-etikett">{t("service.protocol")}{!owner && <span className="t-sekundar"> ({t("common.optional")})</span>}</p>
        {f.document_id ? <p className="t-liten"><Icon name="bock" className="ikon-inline" /> {t("service.attached")}</p> :
          <DocumentDropzone orgId={orgId} machineId={machineId} type="inspection_report" visibility="verifiers" multiple={false}
            onUploaded={(d) => setF((x) => ({ ...x, document_id: d.id }))} />}
      </div>
    </FormDialog>
  );
}

function InsuranceDialog({ machineId, onClose }: { machineId: string; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const insurers = useRpc<{ id: string; name: string }[]>("list_partner_orgs", { p_type: "insurer" });
  const [f, setF] = useState({ insurer_org_id: "", insurer_name: "", policy_number: "", valid_from: todayIso(), valid_to: "", coverage: "full" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog title={t("service.add_insurance")} onClose={onClose}
      onSubmit={() => rpc("add_insurance_policy", { p_org_id: orgId, p_machine_id: machineId, p_data: { ...f, insurer_org_id: f.insurer_org_id || null } }).then(() => undefined)}>
      <FormField label={t("service.insurer")}>
        <select className="mid-select" value={f.insurer_org_id} onChange={set("insurer_org_id")}>
          <option value="">{t("service.insurer_other")}</option>
          {(insurers.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </FormField>
      {!f.insurer_org_id && <FormField label={t("service.insurer_name")}><input className="mid-input" value={f.insurer_name} onChange={set("insurer_name")} /></FormField>}
      <div className="rutnat">
        <FormField className="kol-6" label={t("service.policy_number")}><input className="mid-input is-id" value={f.policy_number} onChange={set("policy_number")} /></FormField>
        <FormField className="kol-6" label={t("service.coverage_label")}>
          <select className="mid-select" value={f.coverage} onChange={set("coverage")}>
            {["liability", "machine", "theft", "full"].map((x) => <option key={x} value={x}>{t(`service.coverage.${x}`)}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("service.valid_from")}><input className="mid-input" type="date" value={f.valid_from} onChange={set("valid_from")} /></FormField>
        <FormField className="kol-6" label={t("service.valid_to")}><input className="mid-input" type="date" min={f.valid_from} value={f.valid_to} onChange={set("valid_to")} /></FormField>
      </div>
    </FormDialog>
  );
}

function ReminderDialog({ machineId, onClose }: { machineId: string | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [f, setF] = useState({ title: "", due_at: "", due_hours: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormDialog title={t("service.add_reminder")} onClose={onClose}
      onSubmit={() => rpc("create_reminder", { p_org_id: orgId, p_machine_id: machineId, p_title: f.title, p_due_at: f.due_at || null,
        p_due_hours: f.due_hours ? Number(f.due_hours) : null }).then(() => undefined)}>
      <FormField label={t("service.reminder_title")}><input className="mid-input" value={f.title} onChange={set("title")} /></FormField>
      <div className="rutnat">
        <FormField className="kol-6" label={t("common.date")} optional><input className="mid-input" type="date" min={todayIso()} value={f.due_at} onChange={set("due_at")} /></FormField>
        <FormField className="kol-6" label={t("service.at_hours")} optional><input className="mid-input" inputMode="numeric" value={f.due_hours} onChange={set("due_hours")} /></FormField>
      </div>
    </FormDialog>
  );
}
