import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { FinancingBadge, StatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { MachineListItem, MachineView, Transfer } from "../../../lib/api/types";
import { formatDate, formatNumber } from "../../../lib/format";
import { adSignPdf, lotTagPdf } from "../../../lib/pdf/adQr";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { ShareDialog } from "../machines/MachineActions";

type Tab = "stock" | "trade_in" | "demo" | "consignment" | "sold";
interface Sale extends Transfer { make: string; model: string; is_new_sale: boolean; seller_user: string | null }

/** Stock (SPEC §7.2): machines the dealer owns with status stock/trade-in/demo, plus sold machines; quick actions. */
export function StockPage() {
  const { t } = useTranslation();
  const { orgId, org, path, canWrite, minTrustedLevel } = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "stock";
  const stock = useRpc<{ items: MachineListItem[] }>("list_machines", { p_org_id: orgId, p_scope: "stock", p_limit: 500 });
  const sales = useRpc<Sale[]>("list_sales", tab === "sold" ? { p_org_id: orgId } : null);
  const [share, setShare] = useState<MachineView | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Consignment machines (kommission, step 21) belong to the principal and have no own stock status here.
  const bucket = (m: MachineListItem) => (m.consignment ? "consignment" : m.stock_status);
  const items = (stock.data?.items ?? []).filter((m) => bucket(m) === tab);
  const counts = (s: string) => (stock.data?.items ?? []).filter((m) => bucket(m) === s).length;

  async function adQr(m: MachineListItem) {
    downloadBytes(await adSignPdf({ ...m, dealer: org.name }, t, location.origin), `annons-${m.reg_number}.pdf`);
  }
  async function lotTag(m: MachineListItem) {
    const v = await rpc<MachineView>("get_machine", { p_org_id: orgId, p_machine_id: m.id });
    const label = Array.isArray(v.labels) ? v.labels.find((l) => l.status === "bound")?.code ?? null : null;
    downloadBytes(await lotTagPdf({ ...m, label_code: label }, t, location.origin), `lagerlapp-${m.reg_number}.pdf`);
  }
  async function setStatus(m: MachineListItem, s: string) {
    setError(null);
    try {
      await rpc("set_stock_status", { p_org_id: orgId, p_machine_id: m.id, p_status: s });
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) { setError(e); }
  }

  return (
    <div className="stack-6">
      <PageHeader title={t("nav.stock")} lead={t("dealer.stock_lead")}
        actions={canWrite ? <><Link className="mid-knapp mid-knapp-kontur" to={path("import")}><Icon name="uppladdning" />{t("dealer.import_stock")}</Link>
          <Link className="mid-knapp mid-knapp-primar" to={path("machines/new")}><Icon name="plus" />{t("nav.register")}</Link></> : undefined} />
      <Tabs panels label={t("nav.stock")} value={tab} onChange={(x) => setParams({ tab: x }, { replace: true })}
        tabs={[{ id: "stock", label: t("dealer.tab_stock"), count: counts("stock") }, { id: "trade_in", label: t("dealer.tab_trade_in"), count: counts("trade_in") },
          { id: "demo", label: t("dealer.tab_demo"), count: counts("demo") }, { id: "consignment", label: t("dealer.tab_consignment"), count: counts("consignment") },
          { id: "sold", label: t("dealer.tab_sold") }]} />
      {error != null && <ErrorNotice error={error} />}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`flik-${tab}`}>
        {tab !== "sold" ? (stock.isLoading ? <Skeleton lines={6} /> : (
          <DataTable caption={t("nav.stock")} rows={items} getKey={(m) => m.id} exportName="lager"
            empty={<EmptyState icon="tagg" title={t("dealer.stock_empty")} />}
            columns={[
              { id: "reg", header: t("machines.col_reg"), value: (m) => m.reg_number, cell: (m) => <Link to={path(`machines/${m.id}`)}><RegNumber value={m.reg_number} /></Link> },
              { id: "machine", header: t("machines.col_machine"), value: (m) => `${m.make} ${m.model}`, sortable: true,
                cell: (m) => <><strong>{m.make} {m.model}</strong>{m.year ? ` · ${m.year}` : ""}<br /><span className="t-liten t-sekundar">{m.hour_meter !== null ? `${formatNumber(m.hour_meter)} h` : ""}
                  {m.consignment ? ` · ${t("dealer.consignment_for", { org: (m.consignment as { principal: string }).principal })}` : ""}</span></> },
              { id: "badges", header: t("common.status"), value: (m) => m.verification_level, cell: (m) => (
                <span className="badge-rad"><VerificationBadge level={m.verification_level} minTrusted={minTrustedLevel} />{m.has_active_financing && <FinancingBadge hasActive />}
                  {m.open_transfer_status && <StatusBadge kind="vantar">{t("machines.transfer_open")}</StatusBadge>}</span>) },
              { id: "actions", header: t("common.actions"), cell: (m) => (
                <span className="mid-rad">
                  {canWrite && !m.open_transfer_status && <Link className="mid-knapp mid-knapp-primar mid-knapp-liten" to={path(`sales/new?machine=${m.id}`)}>{t("dealer.sell")}</Link>}
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void adQr(m)}><Icon name="qr" />{t("dealer.ad_qr")}</button>
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void lotTag(m)}><Icon name="skrivare" />{t("dealer.lot_tag")}</button>
                  {!m.consignment && <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={async () => setShare(await rpc<MachineView>("get_machine", { p_org_id: orgId, p_machine_id: m.id }))}>
                    {t("dealer.share_report")}</button>}
                  {canWrite && !m.consignment && (
                    <select className="mid-select mid-select-liten" aria-label={t("dealer.stock_status")} value={m.stock_status ?? ""} onChange={(e) => void setStatus(m, e.target.value)}>
                      {["stock", "trade_in", "demo"].map((s) => <option key={s} value={s}>{t(`dealer.tab_${s}`)}</option>)}
                    </select>
                  )}
                </span>) },
            ]} />
        )) : (sales.isLoading ? <Skeleton lines={6} /> : (
          <DataTable caption={t("dealer.tab_sold")} rows={sales.data ?? []} getKey={(s) => s.id} exportName="forsaljningar"
            empty={<EmptyState icon="pil-hoger" title={t("dealer.no_sales")} />}
            columns={[
              { id: "reg", header: t("machines.col_reg"), value: (s) => s.reg_number, cell: (s) => <Link to={path(`transfers/${s.id}`)}><RegNumber value={s.reg_number} /></Link> },
              { id: "machine", header: t("machines.col_machine"), value: (s) => `${s.make} ${s.model}`, cell: (s) => `${s.make} ${s.model}` },
              { id: "buyer", header: t("transfer.buyer"), value: (s) => s.to?.name ?? s.to_email, cell: (s) => s.to?.name ?? s.to_email ?? "–" },
              { id: "date", header: t("actions.transfer.sale_date"), value: (s) => s.sale_date, cell: (s) => formatDate(s.sale_date), sortable: true },
              { id: "seller", header: t("dealer.sold_by"), value: (s) => s.seller_user, cell: (s) => s.seller_user ?? "–", hideOnMobile: true },
              { id: "status", header: t("common.status"), value: (s) => s.status, cell: (s) => (
                <span className="badge-rad"><StatusBadge kind={s.status === "completed" ? "verifierad" : "vantar"}>{t(`enum.transfer_status.${s.status}`)}</StatusBadge>
                  {s.is_new_sale && <StatusBadge kind="neutral">{t("dealer.new_sale")}</StatusBadge>}</span>) },
            ]} />
        ))}
      </div>
      {share && <ShareDialog m={share} open onClose={() => setShare(null)} />}
    </div>
  );
}
