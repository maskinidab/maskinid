import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { RegNumber } from "../../../components/RegNumber";
import { StatusBadge } from "../../../components/StatusBadge";
import { useRpc } from "../../../lib/api/query";
import { formatDateTime } from "../../../lib/format";

interface Alert { seq: number; type: string; created_at: string; machine_id: string | null; reg_number: string | null; make: string | null; model: string | null;
  actor: string | null; payload: Record<string, unknown> }

const SEVERE = new Set(["flag.raised", "conflict.created", "machine.scanned_while_stolen", "market.alert"]);

/** Alerts (SPEC §9.2): what others did to machines in our portfolio (financier, insurer, dealer stock) or – for
 * authorities – every flag and every scan of a stolen machine. */
export function AlertsPage() {
  const { t, i18n } = useTranslation();
  const { orgId, path } = useOrg();
  const q = useRpc<Alert[]>("list_alerts", { p_org_id: orgId, p_limit: 300 });
  const label = (a: Alert) => (i18n.exists(`alerts.type.${a.type}`) ? t(`alerts.type.${a.type}`) : a.type);
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.alerts")} lead={t("alerts.lead")} />
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.alerts")} rows={q.data ?? []} getKey={(a) => String(a.seq)} exportName="larm"
          empty={<EmptyState icon="varning" title={t("alerts.empty")} />}
          filters={[{ id: "type", label: t("common.type"), options: [...new Set((q.data ?? []).map((a) => a.type))].map((x) => ({ value: x, label: i18n.exists(`alerts.type.${x}`) ? t(`alerts.type.${x}`) : x })), match: (a, v) => a.type === v }]}
          columns={[
            { id: "at", header: t("common.date"), value: (a) => a.created_at, cell: (a) => formatDateTime(a.created_at), sortable: true },
            { id: "what", header: t("alerts.what"), value: (a) => label(a), cell: (a) => <StatusBadge kind={SEVERE.has(a.type) ? "sparr" : "neutral"}>{label(a)}</StatusBadge> },
            { id: "machine", header: t("machines.col_machine"), value: (a) => a.reg_number,
              cell: (a) => a.machine_id && a.reg_number ? <><Link to={path(`machines/${a.machine_id}`)}><RegNumber value={a.reg_number} /></Link> {a.make} {a.model}</> : "–" },
            { id: "who", header: t("alerts.who"), value: (a) => a.actor, cell: (a) => a.actor ?? t("alerts.system") },
          ]} />
      )}
    </div>
  );
}
