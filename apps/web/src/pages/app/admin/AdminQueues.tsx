import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon, type IconName } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { useSign } from "../../../components/Signature";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import type { OrgBrief } from "../../../lib/api/types";
import { formatDate, formatDateTime } from "../../../lib/format";
import { useAdmin } from "./useAdmin";

/** /admin – what needs the register keeper's attention now. */
export function AdminHomePage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { overview } = useAdmin();
  if (overview.isLoading) return <Skeleton lines={8} />;
  if (overview.error) return <ErrorNotice error={overview.error} />;
  const o = overview.data!;
  const tiles: { to: string; label: string; value: number; icon: IconName; urgent?: boolean }[] = [
    { to: "admin/organizations?status=pending", label: t("admin.home.orgs_pending"), value: o.orgs_pending, icon: "personer", urgent: o.orgs_pending > 0 },
    { to: "verify", label: t("admin.home.verifications_open"), value: o.verifications_open, icon: "sigill", urgent: o.verifications_open > 0 },
    { to: "admin/conflicts", label: t("admin.home.conflicts_open"), value: o.conflicts_open, icon: "varning", urgent: o.conflicts_open > 0 },
    { to: "admin/corrections", label: t("admin.home.corrections_pending"), value: o.corrections_pending, icon: "penna" },
    { to: "admin/labels", label: t("admin.home.labels_ordered"), value: o.label_batches_ordered, icon: "qr", urgent: o.label_batches_ordered > 0 },
    { to: "admin/market", label: t("admin.home.market_alerts"), value: o.market_alerts_open, icon: "sok", urgent: o.market_alerts_open > 0 },
    { to: "admin/api", label: t("admin.home.webhooks_failed"), value: o.webhooks_failed_24h, icon: "extern", urgent: o.webhooks_failed_24h > 0 },
    { to: "admin/api", label: t("admin.home.api_requests"), value: o.api_requests_24h, icon: "diagram" },
  ];
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.admin")} lead={t("admin.home.lead", { role: t(`enum.operator_role.${o.operator_role}`) })} />
      <dl className="nyckeltal">
        <div><dt>{t("dashboard.machines")}</dt><dd>{o.machines}</dd></div>
        <div><dt>{t("admin.home.orgs")}</dt><dd>{o.orgs}</dd></div>
        <div><dt>{t("admin.home.last_anchor")}</dt><dd>{o.last_anchor ? formatDate(o.last_anchor.day) : "–"}</dd></div>
      </dl>
      <ul className="admin-rutor">
        {tiles.map((x) => (
          <li key={x.label}>
            <Link to={path(x.to)} className={x.urgent ? "is-akut" : undefined}>
              <Icon name={x.icon} />
              <span className="admin-ruta-varde">{x.value}</span>
              <span>{x.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Conflict {
  id: string; type: string; status: string; details: Record<string, unknown>; created_at: string; resolved_at: string | null; resolution_note: string | null;
  machine: { id: string; reg_number: string; status: string; owner: OrgBrief | null; make: string; model: string } | null;
  related_machine: Conflict["machine"];
  involved: OrgBrief[];
}

/** Conflict queue (SPEC §6.7): duplicates, disputes, market anomalies. Resolution needs a note; all of it is logged. */
export function AdminConflictsPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { atLeast } = useAdmin();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const q = useRpc<Conflict[]>("list_conflicts", { p_status: status === "all" ? null : status });
  const [open, setOpen] = useState<Conflict | null>(null);
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.conflicts.title")} lead={t("admin.conflicts.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      <Tabs label={t("admin.conflicts.title")} value={status} onChange={(s) => setParams({ status: s }, { replace: true })}
        tabs={["open", "resolved", "dismissed", "all"].map((s) => ({ id: s, label: s === "all" ? t("common.all") : t(`enum.conflict_status.${s}`) }))} />
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.conflicts.title")} rows={q.data!} getKey={(c) => c.id} exportName="konflikter"
          empty={<EmptyState icon="bock" title={t("admin.conflicts.empty")} />}
          columns={[
            { id: "type", header: t("common.type"), value: (c) => c.type, cell: (c) => <><strong>{t(`enum.conflict_type.${c.type}`)}</strong><br /><span className="t-liten t-sekundar">{formatDateTime(c.created_at)}</span></> },
            { id: "machine", header: t("machines.col_machine"), value: (c) => c.machine?.reg_number ?? "",
              cell: (c) => (c.machine ? <><Link to={path(`machines/${c.machine.id}`)}><RegNumber value={c.machine.reg_number} /></Link><br /><span className="t-liten">{c.machine.make} {c.machine.model}</span></> : "–") },
            { id: "related", header: t("admin.conflicts.related"), value: (c) => c.related_machine?.reg_number ?? "", hideOnMobile: true,
              cell: (c) => (c.related_machine ? <Link to={path(`machines/${c.related_machine.id}`)}><RegNumber value={c.related_machine.reg_number} /></Link> : "–") },
            { id: "involved", header: t("admin.conflicts.involved"), value: (c) => c.involved.map((o) => o.name).join(", "), hideOnMobile: true, cell: (c) => c.involved.map((o) => o.name).join(", ") },
            { id: "action", header: "", value: () => "",
              cell: (c) => (c.status === "open" && atLeast("verifier")
                ? <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => setOpen(c)}>{t("admin.conflicts.resolve")}</button>
                : <span className="t-liten t-sekundar">{c.resolution_note ?? t(`enum.conflict_status.${c.status}`)}</span>) },
          ]} />
      )}
      {open && <ResolveDialog c={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ResolveDialog({ c, onClose }: { c: Conflict; onClose(): void }) {
  const { t } = useTranslation();
  const duplicate = c.type === "duplicate_identifier";
  const [resolution, setResolution] = useState(duplicate && c.machine && c.related_machine && (!c.machine.owner || c.machine.owner.id === c.related_machine.owner?.id)
    ? "merge_into_existing" : duplicate ? "keep_existing" : "resolved");
  const [note, setNote] = useState("");
  const m = useRpcMutation<{ p_conflict_id: string; p_resolution: string; p_note: string }>("resolve_conflict", { onSuccess: onClose });
  const merge = useRpcMutation<{ p_keep_id: string; p_merge_id: string; p_note: string }>("admin_merge_machines", { onSuccess: onClose });
  // Merge (step 24) moves documents, service, labels etc. to the kept record; keep_* deregisters the other without moving data.
  // Only records of the same owner can be merged; different owners are an ownership dispute (server enforces it too).
  const canMerge = duplicate && !!c.machine && !!c.related_machine && (!c.machine.owner || c.machine.owner.id === c.related_machine.owner?.id);
  const options = duplicate ? [...(canMerge ? ["merge_into_existing", "merge_into_new"] : []), "keep_existing", "keep_new", "resolved", "dismiss"] : ["resolved", "dismiss"];
  function submit() {
    if (resolution === "merge_into_existing" || resolution === "merge_into_new") {
      const keep = resolution === "merge_into_existing" ? c.related_machine! : c.machine!;
      const drop = resolution === "merge_into_existing" ? c.machine! : c.related_machine!;
      merge.mutate({ p_keep_id: keep.id, p_merge_id: drop.id, p_note: note.trim() });
    } else m.mutate({ p_conflict_id: c.id, p_resolution: resolution, p_note: note.trim() });
  }
  return (
    <Dialog open onClose={onClose} title={t(`enum.conflict_type.${c.type}`)}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {Object.keys(c.details).length > 0 && <pre className="kodblock">{JSON.stringify(c.details, null, 2)}</pre>}
        <fieldset className="stack-2">
          <legend className="mid-etikett">{t("admin.conflicts.resolution")}</legend>
          {options.map((o) => (
            <label key={o} className="mid-kryss"><input type="radio" name="res" checked={resolution === o} onChange={() => setResolution(o)} />
              {t(`admin.conflicts.res.${o}`, { existing: c.related_machine?.reg_number ?? "", new: c.machine?.reg_number ?? "" })}</label>
          ))}
        </fieldset>
        <FormField label={t("admin.note")}><textarea className="mid-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required /></FormField>
        {resolution.startsWith("merge") && <p className="t-liten t-sekundar">{t("admin.conflicts.merge_hint")}</p>}
        {duplicate && !canMerge && <p className="t-liten t-sekundar">{t("admin.conflicts.merge_other_owner")}</p>}
        {m.error && <ErrorNotice error={m.error} />}
        {merge.error && <ErrorNotice error={merge.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!note.trim() || m.isPending || merge.isPending}>{t("admin.conflicts.resolve")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}

interface Correction {
  id: string; machine_id: string; reg_number: string; status: string; reason: string; obvious_typo: boolean; created_at: string;
  effective_after: string | null; proposed_by_user_id: string; from: OrgBrief | null; to: OrgBrief | null;
}

/** Owner corrections (SPEC §11.4): four eyes – one verifier proposes, another approves; both sign. */
export function AdminCorrectionsPage() {
  const { t } = useTranslation();
  const { path, orgId } = useOrg();
  const { atLeast } = useAdmin();
  const sign = useSign();
  const q = useRpc<Correction[]>("list_owner_corrections", { p_status: null });
  const [error, setError] = useState<unknown>(null);
  const [proposing, setProposing] = useState(false);
  async function approve(c: Correction) {
    setError(null);
    try {
      const sig = await sign(orgId, "approve_owner_correction", c.id);
      await rpc("approve_owner_correction", { p_correction_id: c.id, p_signature_id: sig });
      await q.refetch();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.corrections.title")} lead={t("admin.corrections.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]}
        actions={atLeast("verifier") ? <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setProposing(true)}>{t("admin.corrections.propose")}</button> : undefined} />
      {!!error && <ErrorNotice error={error} />}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.corrections.title")} rows={q.data!} getKey={(c) => c.id}
          empty={<EmptyState icon="bock" title={t("admin.corrections.empty")} />}
          columns={[
            { id: "reg", header: t("machines.col_reg"), value: (c) => c.reg_number, cell: (c) => <Link to={path(`machines/${c.machine_id}`)}><RegNumber value={c.reg_number} /></Link> },
            { id: "change", header: t("admin.corrections.change"), value: (c) => `${c.from?.name} → ${c.to?.name}`,
              cell: (c) => <>{c.from?.name ?? "–"} → <strong>{c.to?.name ?? "–"}</strong><br /><span className="t-liten t-sekundar">{c.reason}</span></> },
            { id: "status", header: t("common.status"), value: (c) => c.status,
              cell: (c) => <>{t(`admin.corrections.status.${c.status}`)}{c.effective_after ? <><br /><span className="t-liten t-sekundar">{t("admin.corrections.until", { date: formatDate(c.effective_after) })}</span></> : null}</> },
            { id: "action", header: "", value: () => "",
              cell: (c) => (c.status === "proposed" && atLeast("verifier")
                ? <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void approve(c)}>{t("admin.corrections.approve")}</button> : null) },
          ]} />
      )}
      {proposing && <ProposeDialog onClose={() => { setProposing(false); void q.refetch(); }} />}
    </div>
  );
}

function ProposeDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  const [reg, setReg] = useState("");
  const [toOrg, setToOrg] = useState("");
  const [reason, setReason] = useState("");
  const [typo, setTypo] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const found = await rpc<{ machines: { id: string }[]; orgs: { id: string }[] }>("admin_support_search", { p_query: reg });
      const orgs = await rpc<{ orgs: { id: string }[] }>("admin_support_search", { p_query: toOrg });
      const machineId = found.machines[0]?.id;
      const to = orgs.orgs[0]?.id;
      if (!machineId || !to) throw new Error(t("admin.corrections.not_found"));
      const sig = await sign(orgId, "propose_owner_correction", machineId, { to_org_id: to });
      await rpc("propose_owner_correction", { p_machine_id: machineId, p_to_org_id: to, p_reason: reason.trim(), p_obvious_typo: typo, p_signature_id: sig });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={t("admin.corrections.propose")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="t-liten">{t("admin.corrections.propose_lead")}</p>
        <FormField label={t("machines.col_reg")}><input className="mid-input is-id" value={reg} onChange={(e) => setReg(e.target.value)} required /></FormField>
        <FormField label={t("admin.corrections.to_org")} hint={t("admin.corrections.to_org_hint")}><input className="mid-input" value={toOrg} onChange={(e) => setToOrg(e.target.value)} required /></FormField>
        <FormField label={t("admin.reason")}><textarea className="mid-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required /></FormField>
        <label className="mid-kryss"><input type="checkbox" checked={typo} onChange={(e) => setTypo(e.target.checked)} />{t("admin.corrections.obvious_typo")}</label>
        {!!error && <ErrorNotice error={error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy || !reason.trim()}>{t("admin.corrections.propose_sign")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
