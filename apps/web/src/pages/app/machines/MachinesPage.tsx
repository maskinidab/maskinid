import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable, type Column } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { Icon } from "../../../components/Icon";
import { MachineCard } from "../../../components/MachineCard";
import { RegNumber } from "../../../components/RegNumber";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { useRpc, useRpcMutation } from "../../../lib/api/query";
import type { MachineListItem, MachineStatus } from "../../../lib/api/types";
import { formatDate, formatDateTime, formatNumber } from "../../../lib/format";

type Scope = "owned" | "used" | "registered" | "previous" | "all";
const STATUSES: MachineStatus[] = ["active", "stolen", "blocked", "disputed", "scrapped", "exported", "deregistered"];

interface Draft { id: string; draft_data: Record<string, unknown> & { make?: string; model?: string; step?: number }; updated_at: string }

/** "Mina maskiner" (SPEC §9.2): scopes, search, filter, CSV export; table on desktop, cards on mobile. */
export function MachinesPage() {
  const { t } = useTranslation();
  const { orgId, path, has, canWrite, minTrustedLevel } = useOrg();
  const [params, setParams] = useSearchParams();
  const scope = (params.get("scope") as Scope | null) ?? "all";
  const list = useRpc<{ total: number; items: MachineListItem[] }>("list_machines", { p_org_id: orgId, p_scope: scope, p_limit: 500 });
  const drafts = useRpc<Draft[]>("list_machine_drafts", { p_org_id: orgId });
  const delDraft = useRpcMutation<{ p_org_id: string; p_draft_id: string }>("delete_machine_draft");
  const canRegister = canWrite && (has("owner") || has("dealer") || has("financier") || has("inspector"));

  const columns: Column<MachineListItem>[] = [
    { id: "reg", header: t("machines.col_reg"), cell: (m) => <Link to={path(`machines/${m.id}`)}><RegNumber value={m.reg_number} /></Link>, value: (m) => m.reg_number, sortable: true },
    { id: "machine", header: t("machines.col_machine"), cell: (m) => <><strong>{m.make} {m.model}</strong><br /><span className="t-liten t-sekundar">{t(`enum.category.${m.category}`)}</span></>,
      value: (m) => `${m.make} ${m.model}`, sortable: true },
    { id: "year", header: t("machines.col_year"), cell: (m) => m.year ?? "–", value: (m) => m.year, sortable: true, hideOnMobile: true },
    { id: "serial", header: t("machines.col_serial"), cell: (m) => <span className="mid-id">{m.serial ?? "–"}</span>, value: (m) => m.serial, hideOnMobile: true },
    { id: "hours", header: t("machine.hours"), cell: (m) => (m.hour_meter === null ? "–" : formatNumber(m.hour_meter)), value: (m) => m.hour_meter, sortable: true, hideOnMobile: true },
    { id: "project", header: t("fleet.col.project"), value: (m) => (m.project as string | null) ?? "", cell: (m) => (m.project as string | null) ?? "–", hideOnMobile: true },
    { id: "next", header: t("machines.col_next"), hideOnMobile: true,
      value: (m) => (m.next_action as { title: string } | null)?.title ?? "",
      cell: (m) => {
        const n = m.next_action as { title: string; due_at: string | null; due_hours: number | null } | null;
        return n ? <>{n.title}<br /><span className="t-liten t-sekundar">{[n.due_at && formatDate(n.due_at), n.due_hours && `${formatNumber(n.due_hours)} h`].filter(Boolean).join(" / ")}</span></> : "–";
      } },
    { id: "status", header: t("common.status"), value: (m) => m.status, cell: (m) => (
      <span className="badge-rad">
        {m.status !== "active" && <MachineStatusBadge status={m.status} />}
        <VerificationBadge level={m.verification_level} minTrusted={minTrustedLevel} />
        {m.has_active_financing && <FinancingBadge hasActive />}
        {m.open_transfer_status && <span className="mid-status mid-status-vantar">{t("machines.transfer_open")}</span>}
      </span>
    ) },
  ];

  const scopes: { id: Scope; label: string }[] = [
    { id: "all", label: t("machines.scope_all") },
    { id: "owned", label: t("machines.scope_owned") },
    ...(has("owner") ? [{ id: "used" as Scope, label: t("machines.scope_used") }] : []),
    ...(has("dealer") || has("financier") ? [{ id: "registered" as Scope, label: t("machines.scope_registered") }] : []),
    { id: "previous", label: t("machines.scope_previous") },
  ];

  return (
    <div className="stack-6">
      <PageHeader title={t("machines.title")} lead={t("machines.lead")}
        actions={canRegister ? <Link className="mid-knapp mid-knapp-primar" to={path("machines/new")}><Icon name="plus" />{t("nav.register")}</Link> : undefined} />
      {(drafts.data?.length ?? 0) > 0 && (
        <section className="panel stack-3" aria-labelledby="utkast">
          <h2 id="utkast" className="t-rubrik-4">{t("machines.drafts_title")}</h2>
          <ul className="radlista">
            {drafts.data!.map((d) => (
              <li key={d.id}>
                <Link to={path(`machines/new?draft=${d.id}`)}>
                  <strong><Icon name="penna" className="ikon-inline" /> {[d.draft_data.make, d.draft_data.model].filter(Boolean).join(" ") || t("machines.draft_untitled")}</strong>
                  <br /><span className="t-liten t-sekundar">{t("machines.draft_saved", { at: formatDateTime(d.updated_at) })}</span>
                </Link>
                <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" disabled={delDraft.isPending}
                  onClick={() => delDraft.mutate({ p_org_id: orgId, p_draft_id: d.id })}>{t("common.remove")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Tabs label={t("machines.title")} tabs={scopes} value={scope} onChange={(s) => setParams({ scope: s }, { replace: true })} />
      <div role="tabpanel" id={`panel-${scope}`} aria-labelledby={`flik-${scope}`}>
        {list.isLoading ? <Skeleton lines={6} height={40} /> : list.error ? <ErrorNotice error={list.error} /> : (
          <DataTable caption={t("machines.title")} rows={list.data!.items} columns={columns} getKey={(m) => m.id} exportName="maskiner"
            searchPlaceholder={t("machines.search_placeholder")}
            card={(m) => <MachineCard m={m} to={path(`machines/${m.id}`)} minTrusted={minTrustedLevel} />}
            filters={[
              { id: "status", label: t("common.status"), options: STATUSES.map((s) => ({ value: s, label: t(`enum.machine_status.${s}`) })), match: (m, v) => m.status === v },
              { id: "financing", label: t("machines.filter_financing"), options: [{ value: "yes", label: t("common.yes") }, { value: "no", label: t("common.no") }],
                match: (m, v) => m.has_active_financing === (v === "yes") },
              { id: "level", label: t("machines.filter_level"), options: [0, 1, 2].map((l) => ({ value: String(l), label: t(`level.${l}.name`) })),
                match: (m, v) => String(m.verification_level) === v },
            ]}
            empty={<EmptyState icon="maskin" title={t("machines.empty_title")} body={t("machines.empty_body")}
              action={canRegister ? { label: t("nav.register"), to: path("machines/new") } : undefined} />} />
        )}
      </div>
    </div>
  );
}
