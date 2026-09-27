import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { RegNumber } from "../../../components/RegNumber";
import { MachineStatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { OrgBrief } from "../../../lib/api/types";
import { backend, dataSource } from "../../../lib/backend";
import { formatDate, formatDateTime } from "../../../lib/format";
import { useAdmin } from "./useAdmin";

interface Report {
  id: string; source: string; external_ref: string | null; serial: string; make: string | null; model: string | null; reported_at: string | null;
  report_status: "stolen" | "recovered"; review_status: "new" | "confirmed" | "ignored"; received_at: string;
  machine: { id: string; reg_number: string; status: string; owner: OrgBrief | null } | null;
}

/** Operator: reports from the external theft register (Larmtjänst) and the outgoing queue (step 25). */
export function AdminTheftReportsPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { atLeast } = useAdmin();
  const [status, setStatus] = useState("new");
  const q = useRpc<{ reports: Report[]; queue: Record<string, number> | null; enabled: boolean }>("admin_list_external_theft_reports", { p_status: status === "all" ? null : status });
  const [error, setError] = useState<unknown>(null);
  async function review(id: string, s: "confirmed" | "ignored") {
    setError(null);
    try { await rpc("admin_review_external_theft_report", { p_id: id, p_status: s }); await queryClient.invalidateQueries({ queryKey: ["rpc"] }); }
    catch (e) { setError(e); }
  }
  async function syncNow() {
    setError(null);
    try { await backend.invoke("theft-sync", {}); await queryClient.invalidateQueries({ queryKey: ["rpc"] }); } catch (e) { setError(e); }
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("theftsync.title")} lead={t("theftsync.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]}
        actions={dataSource === "local" && atLeast("verifier") ? <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => void syncNow()}>{t("theftsync.sync_now")}</button> : undefined} />
      {q.data && !q.data.enabled && <Notice title={t("theftsync.disabled")} />}
      {q.data?.queue && (
        <dl className="nyckeltal">
          {["pending", "sent", "failed"].map((k) => <div key={k}><dt>{t(`theftsync.queue.${k}`)}</dt><dd>{q.data!.queue?.[k] ?? 0}</dd></div>)}
        </dl>
      )}
      {!!error && <ErrorNotice error={error} />}
      <Tabs label={t("theftsync.title")} value={status} onChange={setStatus}
        tabs={["new", "confirmed", "ignored", "all"].map((s) => ({ id: s, label: s === "all" ? t("common.all") : t(`theftsync.review.${s}`) }))} />
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("theftsync.title")} rows={q.data!.reports} getKey={(r) => r.id} exportName="stoldregister"
          empty={<EmptyState icon="bock" title={t("theftsync.empty")} />}
          columns={[
            { id: "serial", header: t("public.serial"), value: (r) => r.serial, cell: (r) => <><span className="mid-id">{r.serial}</span><br /><span className="t-liten t-sekundar">{[r.make, r.model].filter(Boolean).join(" ")}</span></> },
            { id: "report", header: t("theftsync.report"), value: (r) => r.report_status,
              cell: (r) => <>{t(`theftsync.report_status.${r.report_status}`)}<br /><span className="t-liten t-sekundar">{r.source} {r.external_ref ?? ""} · {r.reported_at ? formatDate(r.reported_at) : "–"}</span></> },
            { id: "machine", header: t("theftsync.match"), value: (r) => r.machine?.reg_number ?? "",
              cell: (r) => r.machine ? <><Link to={path(`machines/${r.machine.id}`)}><RegNumber value={r.machine.reg_number} /></Link> <MachineStatusBadge status={r.machine.status as never} />
                <br /><span className="t-liten t-sekundar">{r.machine.owner?.name ?? ""}</span></> : <span className="t-liten t-sekundar">{t("theftsync.no_match")}</span> },
            { id: "received", header: t("theftsync.received"), value: (r) => r.received_at, sortable: true, hideOnMobile: true, cell: (r) => formatDateTime(r.received_at) },
            { id: "actions", header: "", value: () => "", cell: (r) => (r.review_status === "new" && atLeast("verifier") ? (
              <span className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-sekundar" onClick={() => void review(r.id, "confirmed")}>{t("theftsync.confirm")}</button>
                <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-text" onClick={() => void review(r.id, "ignored")}>{t("theftsync.ignore")}</button>
              </span>) : <span className="t-liten t-sekundar">{t(`theftsync.review.${r.review_status}`)}</span>) },
          ]} />
      )}
      <p className="t-liten t-sekundar">{t("theftsync.never_auto")}</p>
    </div>
  );
}
