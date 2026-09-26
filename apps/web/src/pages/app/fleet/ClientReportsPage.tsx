import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { useRpc } from "../../../lib/api/query";
import type { OrgBrief } from "../../../lib/api/types";
import { formatDate } from "../../../lib/format";
import type { FleetReport } from "../../../lib/pdf/fleetReport";
import { FleetReportTable } from "./FleetPage";

interface Grant { id: string; kind: string; direction: "in" | "out"; owner: OrgBrief; project: { id: string; name: string } | null; created_at: string }

/** Client (beställare) view: fleet reports and project lists that contractors share, always current (SPEC §7.1). */
export function ClientReportsPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [params, setParams] = useSearchParams();
  const grants = useRpc<Grant[]>("list_report_grants", { p_org_id: orgId });
  const incoming = (grants.data ?? []).filter((g) => g.direction === "in");
  const sel = params.get("grant") ?? incoming[0]?.id ?? null;
  const report = useRpc<FleetReport>("get_client_report", sel ? { p_org_id: orgId, p_grant_id: sel } : null);
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.client_reports")} lead={t("client.lead")} />
      {grants.isLoading ? <Skeleton /> : incoming.length === 0 ? <EmptyState icon="diagram" title={t("client.empty")} body={t("client.empty_body")} /> : (
        <>
          <label className="mid-etikett" htmlFor="rapportval">{t("client.choose")}</label>
          <select id="rapportval" className="mid-select" value={sel ?? ""} onChange={(e) => setParams({ grant: e.target.value }, { replace: true })}>
            {incoming.map((g) => <option key={g.id} value={g.id}>{g.owner.name} · {g.project?.name ?? t("fleet.all_machines")} ({formatDate(g.created_at)})</option>)}
          </select>
          {report.isLoading ? <Skeleton lines={6} /> : report.error ? <ErrorNotice error={report.error} /> : report.data && (
            <>
              <p className="t-liten t-sekundar">{t("client.live", { org: report.data.org_name })}</p>
              <FleetReportTable report={report.data} />
            </>
          )}
        </>
      )}
    </div>
  );
}
