import { useTranslation } from "react-i18next";
import type { FleetReport } from "../../lib/pdf/fleetReport";
import { formatDate, formatDateTime } from "../../lib/format";
import { FleetReportTable } from "../app/fleet/FleetPage";

/** Shared fleet/procurement report or project list (share link, read-only, SPEC §7.1). */
export function FleetShareView({ share }: { share: { shared_by: string; expires_at?: string; data: unknown } }) {
  const { t } = useTranslation();
  const r = share.data as FleetReport;
  return (
    <div className="behallare sektion stack-5">
      <header className="stack-2">
        <h1 className="t-rubrik-2">{t(r.kind === "project_list" ? "fleet.project_list_title" : "fleet.report_title")}</h1>
        <p className="t-brodtext">{r.org_name}{r.project ? ` · ${r.project.name}${r.project.site_address ? `, ${r.project.site_address}` : ""}` : ""}</p>
        <p className="t-liten t-sekundar">{t("fleet.generated", { date: formatDateTime(r.generated_at) })}
          {share.expires_at && ` · ${t("share.shared_by", { org: share.shared_by, date: formatDate(share.expires_at) })}`}</p>
      </header>
      <FleetReportTable report={r} />
    </div>
  );
}
