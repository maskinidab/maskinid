import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import { formatDateTime } from "../../../lib/format";
import { useAdmin } from "./useAdmin";

interface Job {
  name: string; description: string; schedule: string; kind: "sql" | "http"; target: string; enabled: boolean; last_run_at: string | null;
  last_status: "ok" | "error" | "dispatched" | null; last_duration_ms: number | null; last_error: string | null; consecutive_failures: number;
  runs: { started_at: string; status: string; error: string | null; ms: number | null }[];
}
interface Jobs { jobs: Job[]; scheduler: { pg_cron: boolean; pg_net: boolean; functions_url: boolean; cron_secret: boolean } }

const KIND = { ok: "verifierad", error: "sparr", dispatched: "vantar" } as const;

/** Operator: scheduled jobs (pg_cron) with last runs; superadmins run or pause them (step 26). */
export function AdminJobsPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { atLeast } = useAdmin();
  const q = useRpc<Jobs>("admin_list_jobs", {});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>, name: string) {
    setBusy(name); setError(null);
    try { await fn(); await queryClient.invalidateQueries({ queryKey: ["rpc"] }); } catch (e) { setError(e); } finally { setBusy(null); }
  }
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const { jobs, scheduler } = q.data!;
  const ready = scheduler.pg_cron && scheduler.pg_net && scheduler.functions_url && scheduler.cron_secret;
  return (
    <div className="stack-6">
      <PageHeader title={t("jobs.title")} lead={t("jobs.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      {!ready && (
        <Notice title={t("jobs.not_ready")}>
          <ul className="lista-punkter t-liten">
            {(["pg_cron", "pg_net", "functions_url", "cron_secret"] as const).map((k) => <li key={k}>{t(`jobs.req.${k}`)}: {scheduler[k] ? t("common.yes") : t("common.no")}</li>)}
          </ul>
        </Notice>
      )}
      {!!error && <ErrorNotice error={error} />}
      <DataTable caption={t("jobs.title")} rows={jobs} getKey={(j) => j.name}
        columns={[
          { id: "name", header: t("jobs.job"), value: (j) => j.name, sortable: true,
            cell: (j) => <><span className="mid-id">{j.name}</span><br /><span className="t-liten t-sekundar">{t(`jobs.desc.${j.name}`, { defaultValue: j.description })}</span></> },
          { id: "schedule", header: t("jobs.schedule"), value: (j) => j.schedule, hideOnMobile: true,
            cell: (j) => <><span className="mid-id">{j.schedule}</span><br /><span className="t-liten t-sekundar">{j.kind === "sql" ? t("jobs.kind_sql") : t("jobs.kind_http")}</span></> },
          { id: "last", header: t("jobs.last_run"), value: (j) => j.last_run_at ?? "", sortable: true,
            cell: (j) => j.last_run_at ? <>{formatDateTime(j.last_run_at)}{j.last_duration_ms !== null && <span className="t-liten t-sekundar"> · {j.last_duration_ms} ms</span>}</> : "–" },
          { id: "status", header: t("common.status"), value: (j) => j.last_status ?? "",
            cell: (j) => <>
              {!j.enabled ? <StatusBadge kind="neutral">{t("jobs.paused")}</StatusBadge>
                : j.last_status ? <StatusBadge kind={KIND[j.last_status]}>{t(`jobs.status.${j.last_status}`)}</StatusBadge> : "–"}
              {j.consecutive_failures > 0 && <><br /><span className="t-liten" role="alert">{t("jobs.failures", { count: j.consecutive_failures, error: j.last_error ?? "" })}</span></>}
            </> },
          { id: "actions", header: "", value: () => "", cell: (j) => atLeast("superadmin") ? (
            <span className="mid-rad">
              <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-sekundar" disabled={busy === j.name}
                onClick={() => void act(() => rpc("admin_run_job", { p_name: j.name }), j.name)}>{t("jobs.run")}</button>
              <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-text" disabled={busy === j.name}
                onClick={() => void act(() => rpc("admin_set_job_enabled", { p_name: j.name, p_enabled: !j.enabled }), j.name)}>{j.enabled ? t("jobs.pause") : t("jobs.resume")}</button>
            </span>) : null },
        ]} />
      <p className="t-liten t-sekundar">{t("jobs.utc_note")}</p>
    </div>
  );
}
