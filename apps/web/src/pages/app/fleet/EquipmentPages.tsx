import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { StatusBadge } from "../../../components/StatusBadge";
import { useRpc, useRpcMutation } from "../../../lib/api/query";
import type { MachineListItem } from "../../../lib/api/types";
import { formatDate, formatReg } from "../../../lib/format";

export const ATTACHMENT_TYPES = ["bucket", "ditch_bucket", "hammer", "grapple", "fork", "tiltrotator", "quick_coupler", "ripper", "compactor",
  "auger", "mower", "snow_plough", "sweeper", "other"] as const;
export const CERTIFICATE_TYPES = ["machine_operator_licence", "forklift", "crane", "aerial_platform", "loader_crane", "road_safety", "hot_work",
  "first_aid", "ykb", "other"] as const;

/** Active machines the org owns or uses (fleet actions only apply to those). */
export function useFleetMachines() {
  const { orgId } = useOrg();
  const q = useRpc<{ items: MachineListItem[] }>("list_machines", { p_org_id: orgId, p_scope: "all", p_limit: 500 });
  const items = (q.data?.items ?? []).filter((m) => m.status === "active" && (m.owner_org_id === orgId || m.user_org_id === orgId));
  return { ...q, items };
}

export function MachineSelect({ value, onChange, id, allowNone }: { value: string; onChange(v: string): void; id?: string; allowNone?: boolean }) {
  const { t } = useTranslation();
  const q = useFleetMachines();
  return (
    <select id={id} className="mid-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowNone ? t("equipment.not_mounted") : t("common.select")}</option>
      {q.items.map((m) => <option key={m.id} value={m.id}>{formatReg(m.reg_number)} · {m.make} {m.model}</option>)}
    </select>
  );
}

interface Attachment {
  id: string; type: string; make: string | null; model: string | null; serial: string | null; year: number | null; weight_kg: number | null;
  notes: string | null; status: "active" | "retired"; mounted_at: string | null; machine: { id: string; reg_number: string; make: string; model: string } | null;
}

/** Redskap: buckets, hammers, tiltrotators … and which machine they are on. */
export function AttachmentsPage() {
  const { t } = useTranslation();
  const { orgId, path, canWrite } = useOrg();
  const q = useRpc<Attachment[]>("list_attachments", { p_org_id: orgId });
  const [edit, setEdit] = useState<Attachment | "new" | null>(null);
  const mount = useRpcMutation<{ p_org_id: string; p_attachment_id: string; p_machine_id: string | null }>("mount_attachment");
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.attachments")} lead={t("equipment.attachments_lead")}
        actions={canWrite ? <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setEdit("new")}><Icon name="plus" />{t("equipment.add_attachment")}</button> : undefined} />
      {mount.error && <ErrorNotice error={mount.error} />}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.attachments")} rows={q.data!} getKey={(a) => a.id} exportName="redskap"
          empty={<EmptyState icon="verktyg" title={t("equipment.no_attachments")} />}
          filters={[{ id: "type", label: t("common.type"), options: ATTACHMENT_TYPES.map((x) => ({ value: x, label: t(`equipment.attachment_type.${x}`) })), match: (a, v) => a.type === v }]}
          columns={[
            { id: "what", header: t("equipment.attachment"), value: (a) => `${a.type} ${a.make ?? ""} ${a.model ?? ""}`, sortable: true,
              cell: (a) => <><strong>{t(`equipment.attachment_type.${a.type}`)}</strong>{a.status === "retired" && <> <StatusBadge kind="neutral">{t("equipment.retired")}</StatusBadge></>}
                <br /><span className="t-liten t-sekundar">{[a.make, a.model, a.year].filter(Boolean).join(" · ")}{a.serial ? <> · <span className="mid-id">{a.serial}</span></> : null}</span></> },
            { id: "machine", header: t("equipment.mounted_on"), value: (a) => a.machine?.reg_number ?? "",
              cell: (a) => (canWrite && a.status === "active"
                ? <select className="mid-select" aria-label={t("equipment.mounted_on")} value={a.machine?.id ?? ""}
                    onChange={(e) => mount.mutate({ p_org_id: orgId, p_attachment_id: a.id, p_machine_id: e.target.value || null })}>
                    <option value="">{t("equipment.not_mounted")}</option>
                    <FleetOptions />
                  </select>
                : a.machine ? <Link to={path(`machines/${a.machine.id}`)}><RegNumber value={a.machine.reg_number} /></Link> : "–") },
            { id: "weight", header: t("equipment.weight"), value: (a) => a.weight_kg ?? 0, hideOnMobile: true, cell: (a) => (a.weight_kg ? `${a.weight_kg} kg` : "–") },
            { id: "edit", header: "", value: () => "", cell: (a) => canWrite && <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setEdit(a)}>{t("common.edit")}</button> },
          ]} />
      )}
      {edit && <AttachmentDialog a={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function FleetOptions() {
  const q = useFleetMachines();
  return <>{q.items.map((m) => <option key={m.id} value={m.id}>{formatReg(m.reg_number)} · {m.make} {m.model}</option>)}</>;
}

function AttachmentDialog({ a, onClose }: { a: Attachment | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [d, setD] = useState({ type: a?.type ?? "bucket", make: a?.make ?? "", model: a?.model ?? "", serial: a?.serial ?? "", year: a?.year ? String(a.year) : "",
    weight_kg: a?.weight_kg ? String(a.weight_kg) : "", notes: a?.notes ?? "", status: a?.status ?? "active" });
  const m = useRpcMutation<{ p_org_id: string; p_data: typeof d; p_attachment_id: string | null }>("save_attachment", { onSuccess: onClose });
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Dialog open onClose={onClose} title={a ? t("equipment.edit_attachment") : t("equipment.add_attachment")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ p_org_id: orgId, p_data: d, p_attachment_id: a?.id ?? null }); }}>
        <FormField label={t("common.type")}>
          <select className="mid-select" value={d.type} onChange={set("type")}>{ATTACHMENT_TYPES.map((x) => <option key={x} value={x}>{t(`equipment.attachment_type.${x}`)}</option>)}</select>
        </FormField>
        <div className="rutnat">
          <FormField className="kol-6" label={t("wizard.make")} optional><input className="mid-input" value={d.make} onChange={set("make")} /></FormField>
          <FormField className="kol-6" label={t("wizard.model")} optional><input className="mid-input" value={d.model} onChange={set("model")} /></FormField>
          <FormField className="kol-6" label={t("enum.identifier_type.serial")} optional><input className="mid-input is-id" value={d.serial} onChange={set("serial")} /></FormField>
          <FormField className="kol-3" label={t("wizard.year")} optional><input className="mid-input" inputMode="numeric" value={d.year} onChange={set("year")} /></FormField>
          <FormField className="kol-3" label={t("equipment.weight")} optional><input className="mid-input" inputMode="numeric" value={d.weight_kg} onChange={set("weight_kg")} /></FormField>
        </div>
        <FormField label={t("common.notes")} optional><textarea className="mid-input" rows={2} value={d.notes} onChange={set("notes")} /></FormField>
        {a && <label className="mid-kryss"><input type="checkbox" checked={d.status === "retired"} onChange={(e) => setD({ ...d, status: e.target.checked ? "retired" : "active" })} />{t("equipment.retire")}</label>}
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={m.isPending}>{t("common.save")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}

interface Operator {
  id: string; name: string; employee_ref: string | null; user_id: string | null; user_name: string | null; active: boolean;
  certificates: { id: string; type: string; label: string | null; valid_until: string | null; expired: boolean; expiring: boolean }[];
  machines: { id: string; reg_number: string; make: string; model: string }[];
}

/** Förare: operators, their licences and certificates (expiry highlighted) and which machine they drive. */
export function OperatorsPage() {
  const { t } = useTranslation();
  const { orgId, path, isAdmin } = useOrg();
  const q = useRpc<Operator[]>("list_operators", { p_org_id: orgId });
  const [edit, setEdit] = useState<Operator | "new" | null>(null);
  const [cert, setCert] = useState<Operator | null>(null);
  const [assign, setAssign] = useState<Operator | null>(null);
  const remove = useRpcMutation<{ p_org_id: string; p_certificate_id: string }>("remove_operator_certificate");
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.operators")} lead={t("equipment.operators_lead")}
        actions={isAdmin ? <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setEdit("new")}><Icon name="plus" />{t("equipment.add_operator")}</button> : undefined} />
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.operators")} rows={q.data!} getKey={(o) => o.id} exportName="forare"
          empty={<EmptyState icon="personer" title={t("equipment.no_operators")} />}
          filters={[{ id: "cert", label: t("equipment.certificates"), options: [{ value: "attention", label: t("equipment.cert_attention") }],
            match: (o) => o.certificates.some((c) => c.expired || c.expiring) }]}
          columns={[
            { id: "name", header: t("common.name"), value: (o) => o.name, sortable: true,
              cell: (o) => <><strong>{o.name}</strong>{!o.active && <> <StatusBadge kind="neutral">{t("equipment.inactive")}</StatusBadge></>}
                <br /><span className="t-liten t-sekundar">{[o.employee_ref, o.user_name && t("equipment.has_login", { name: o.user_name })].filter(Boolean).join(" · ")}</span></> },
            { id: "certs", header: t("equipment.certificates"), value: (o) => o.certificates.map((c) => c.type).join(", "),
              cell: (o) => <ul className="stack-1 t-liten">{o.certificates.map((c) => (
                <li key={c.id}>{c.label || t(`equipment.cert_type.${c.type}`)}{c.valid_until ? ` · ${t("service.valid_until", { date: formatDate(c.valid_until) })}` : ""}
                  {c.expired ? <> <StatusBadge kind="sparr">{t("equipment.expired")}</StatusBadge></> : c.expiring ? <> <StatusBadge kind="vantar">{t("equipment.expiring")}</StatusBadge></> : null}
                  {isAdmin && <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" aria-label={t("common.remove")} onClick={() => remove.mutate({ p_org_id: orgId, p_certificate_id: c.id })}><Icon name="stang" /></button>}</li>
              ))}</ul> },
            { id: "machine", header: t("equipment.drives"), value: (o) => o.machines.map((m) => m.reg_number).join(", "),
              cell: (o) => o.machines.map((m) => <Link key={m.id} to={path(`machines/${m.id}`)}><RegNumber value={m.reg_number} /></Link>) },
            { id: "act", header: "", value: () => "", cell: (o) => isAdmin && (
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setCert(o)}>{t("equipment.add_certificate")}</button>
                {o.active && <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setAssign(o)}>{t("equipment.assign")}</button>}
                <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setEdit(o)}>{t("common.edit")}</button>
              </div>
            ) },
          ]} />
      )}
      {edit && <OperatorDialog o={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {cert && <CertificateDialog o={cert} onClose={() => setCert(null)} />}
      {assign && <AssignDialog o={assign} onClose={() => setAssign(null)} />}
    </div>
  );
}

function OperatorDialog({ o, onClose }: { o: Operator | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const members = useRpc<{ user_id: string; full_name: string | null; email: string | null; status: string }[]>("list_org_members", { p_org_id: orgId });
  const [d, setD] = useState({ name: o?.name ?? "", employee_ref: o?.employee_ref ?? "", user_id: o?.user_id ?? "", active: o?.active ?? true });
  const m = useRpcMutation<{ p_org_id: string; p_data: typeof d; p_operator_id: string | null }>("save_operator", { onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={o ? t("equipment.edit_operator") : t("equipment.add_operator")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ p_org_id: orgId, p_data: d, p_operator_id: o?.id ?? null }); }}>
        <FormField label={t("common.name")}><input className="mid-input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required /></FormField>
        <FormField label={t("equipment.employee_ref")} hint={t("equipment.employee_ref_hint")} optional>
          <input className="mid-input" value={d.employee_ref} onChange={(e) => setD({ ...d, employee_ref: e.target.value })} /></FormField>
        <FormField label={t("equipment.login")} hint={t("equipment.login_hint")} optional>
          <select className="mid-select" value={d.user_id} onChange={(e) => setD({ ...d, user_id: e.target.value })}>
            <option value="">{t("common.none")}</option>
            {(members.data ?? []).filter((x) => x.status === "active" && x.user_id).map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name ?? x.email}</option>)}
          </select>
        </FormField>
        {o && <label className="mid-kryss"><input type="checkbox" checked={!d.active} onChange={(e) => setD({ ...d, active: !e.target.checked })} />{t("equipment.deactivate")}</label>}
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={m.isPending || !d.name.trim()}>{t("common.save")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function CertificateDialog({ o, onClose }: { o: Operator; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [d, setD] = useState({ type: "machine_operator_licence", label: "", issued_at: "", valid_until: "" });
  const m = useRpcMutation<{ p_org_id: string; p_operator_id: string; p_data: typeof d }>("add_operator_certificate", { onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={t("equipment.add_certificate_for", { name: o.name })}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ p_org_id: orgId, p_operator_id: o.id, p_data: d }); }}>
        <FormField label={t("common.type")}>
          <select className="mid-select" value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}>
            {CERTIFICATE_TYPES.map((x) => <option key={x} value={x}>{t(`equipment.cert_type.${x}`)}</option>)}
          </select>
        </FormField>
        <FormField label={t("equipment.cert_label")} optional><input className="mid-input" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></FormField>
        <div className="rutnat">
          <FormField className="kol-6" label={t("equipment.issued_at")} optional><input className="mid-input" type="date" value={d.issued_at} onChange={(e) => setD({ ...d, issued_at: e.target.value })} /></FormField>
          <FormField className="kol-6" label={t("equipment.valid_until")} optional><input className="mid-input" type="date" value={d.valid_until} onChange={(e) => setD({ ...d, valid_until: e.target.value })} /></FormField>
        </div>
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={m.isPending}>{t("common.save")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function AssignDialog({ o, onClose }: { o: Operator; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [machine, setMachine] = useState(o.machines[0]?.id ?? "");
  const m = useRpcMutation<{ p_org_id: string; p_machine_id: string; p_operator_id: string }>("assign_operator", { onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={t("equipment.assign_title", { name: o.name })}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); if (machine) m.mutate({ p_org_id: orgId, p_machine_id: machine, p_operator_id: o.id }); }}>
        <FormField label={t("machines.col_machine")}><MachineSelect value={machine} onChange={setMachine} /></FormField>
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!machine || m.isPending}>{t("equipment.assign")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
