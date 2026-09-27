import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { RegNumber } from "../../../components/RegNumber";
import { MachineStatusBadge, StatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { Level, MachineStatus } from "../../../lib/api/types";
import { formatDate, formatDateTime } from "../../../lib/format";

interface Item {
  kind: "encumbrance" | "policy"; id: string; machine_id: string; reg_number: string; make: string; model: string; year: number | null;
  machine_status: MachineStatus; verification_level: Level; owner: string | null; flags: string[]; last_event_at: string | null;
  type?: string; status?: string; contract_ref?: string | null; start_date?: string; end_date?: string | null; open_transfer?: string | null;
  policy_number?: string; coverage?: string; valid_to?: string; requires_verification_level?: number | null;
}

/** Portfolio (SPEC §9.2 financier, §7.4 insurer): machines with our encumbrance / policy, status and flags. */
export function PortfolioPage() {
  const { t } = useTranslation();
  const { orgId, path, has, isAdmin } = useOrg();
  const q = useRpc<Item[]>("list_portfolio", { p_org_id: orgId });
  const insurer = has("insurer") && !has("financier");
  const items = q.data ?? [];
  const flagged = items.filter((i) => i.flags.length > 0).length;
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.portfolio")} lead={insurer ? t("portfolio.lead_insurer") : t("portfolio.lead_financier")} />
      {!q.isLoading && (
        <dl className="nyckeltal">
          <div><dt>{t("dashboard.machines")}</dt><dd>{items.length}</dd></div>
          <div><dt>{t("portfolio.flagged")}</dt><dd>{flagged}</dd></div>
          {!insurer && <div><dt>{t("portfolio.pending")}</dt><dd>{items.filter((i) => i.status === "pending").length}</dd></div>}
          {!insurer && <div><dt>{t("portfolio.in_transfer")}</dt><dd>{items.filter((i) => i.open_transfer).length}</dd></div>}
        </dl>
      )}
      {insurer && isAdmin && <ClaimUrl />}
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.portfolio")} rows={items} getKey={(i) => i.id} exportName="portfolj"
          empty={<EmptyState icon="bank" title={t("portfolio.empty")} />}
          filters={[{ id: "flag", label: t("pdf.flags"), options: [{ value: "yes", label: t("common.yes") }, { value: "no", label: t("common.no") }], match: (i, v) => (i.flags.length > 0) === (v === "yes") }]}
          columns={[
            { id: "reg", header: t("machines.col_reg"), value: (i) => i.reg_number, cell: (i) => <Link to={path(`machines/${i.machine_id}`)}><RegNumber value={i.reg_number} /></Link> },
            { id: "machine", header: t("machines.col_machine"), value: (i) => `${i.make} ${i.model}`, sortable: true,
              cell: (i) => <><strong>{i.make} {i.model}</strong>{i.year ? ` · ${i.year}` : ""}<br /><span className="t-liten t-sekundar">{i.owner ?? ""}</span></> },
            insurer
              ? { id: "policy", header: t("service.policy_number"), value: (i: Item) => i.policy_number, cell: (i: Item) => <><span className="mid-id">{i.policy_number}</span><br /><span className="t-liten t-sekundar">{t("service.valid_until", { date: formatDate(i.valid_to) })}</span></> }
              : { id: "enc", header: t("check.result_financing"), value: (i: Item) => i.type, cell: (i: Item) => <>{t(`enum.encumbrance_type.${i.type}`)} · {t(`enum.encumbrance_status.${i.status}`)}<br /><span className="t-liten t-sekundar">{[i.contract_ref, i.end_date && formatDate(i.end_date)].filter(Boolean).join(" · ")}</span></> },
            { id: "status", header: t("common.status"), value: (i) => i.machine_status, cell: (i) => (
              <span className="badge-rad">{i.machine_status !== "active" && <MachineStatusBadge status={i.machine_status} />}
                <VerificationBadge level={i.verification_level} />
                {i.open_transfer && <StatusBadge kind="vantar">{t("machines.transfer_open")}</StatusBadge>}</span>) },
            ...(insurer ? [{ id: "req", header: t("portfolio.requirement"), value: (i: Item) => i.requires_verification_level ?? 0, cell: (i: Item) => <Requirement item={i} /> }] : []),
            { id: "last", header: t("portfolio.last_event"), value: (i) => i.last_event_at, cell: (i) => formatDateTime(i.last_event_at), sortable: true, hideOnMobile: true },
          ]} />
      )}
    </div>
  );
}

function Requirement({ item }: { item: Item }) {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  if (!canWrite) return <>{item.requires_verification_level ? t(`level.${item.requires_verification_level}.name`) : "–"}</>;
  return (
    <select className="mid-select mid-select-liten" aria-label={t("portfolio.requirement")} value={item.requires_verification_level ?? ""}
      onChange={async (e) => {
        await rpc("set_policy_requirement", { p_org_id: orgId, p_policy_id: item.id, p_level: e.target.value ? Number(e.target.value) : null });
        await queryClient.invalidateQueries({ queryKey: ["rpc"] });
      }}>
      <option value="">{t("portfolio.no_requirement")}</option>
      <option value="1">{t("level.1.name")}</option>
      <option value="2">{t("level.2.name")}</option>
    </select>
  );
}

function ClaimUrl() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const org = useRpc<{ settings?: { claim_url?: string } }>("get_org", { p_org_id: orgId });
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const value = url ?? org.data?.settings?.claim_url ?? "";
  return (
    <form className="panel stack-3" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      try { await rpc("set_claim_url", { p_org_id: orgId, p_url: value }); setSaved(true); } catch (err) { setError(err); }
    }}>
      <FormField label={t("portfolio.claim_url")} hint={t("portfolio.claim_url_hint")}>
        <input className="mid-input" type="url" placeholder="https://" value={value} onChange={(e) => { setUrl(e.target.value); setSaved(false); }} />
      </FormField>
      {error != null && <ErrorNotice error={error} />}
      <div className="mid-rad"><button type="submit" className="mid-knapp mid-knapp-sekundar">{t("common.save")}</button>{saved && <span className="t-liten">{t("common.done")}</span>}</div>
    </form>
  );
}
