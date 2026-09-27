import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { RegNumber } from "../../../components/RegNumber";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import { formatDateTime } from "../../../lib/format";

interface Lead { id: string; name: string; contact: string; message: string | null; status: string; created_at: string; reg_number: string | null; make: string | null; model: string | null }
interface Customer { id: string; name: string; org_number: string | null; city: string | null; email: string | null; phone: string | null; machines_sold: number; machines_registered: number; last_at: string | null }

/** Leads from ad QR codes (SPEC §7.2). Export as CSV; also delivered as webhook lead.created to a DMS. */
export function LeadsPage() {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const q = useRpc<Lead[]>("list_leads", { p_org_id: orgId });
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.leads")} lead={t("dealer.leads_lead")} />
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.leads")} rows={q.data ?? []} getKey={(l) => l.id} exportName="leads"
          empty={<EmptyState icon="personer" title={t("dealer.no_leads")} body={t("dealer.no_leads_body")} />}
          filters={[{ id: "status", label: t("common.status"), options: ["new", "contacted", "won", "lost"].map((s) => ({ value: s, label: t(`dealer.lead_status.${s}`) })), match: (l, v) => l.status === v }]}
          columns={[
            { id: "at", header: t("common.date"), value: (l) => l.created_at, cell: (l) => formatDateTime(l.created_at), sortable: true },
            { id: "name", header: t("common.name"), value: (l) => l.name, cell: (l) => <><strong>{l.name}</strong><br /><span className="t-liten">{l.contact}</span></> },
            { id: "machine", header: t("machines.col_machine"), value: (l) => l.reg_number, cell: (l) => l.reg_number ? <><RegNumber value={l.reg_number} /> {l.make} {l.model}</> : "–" },
            { id: "msg", header: t("dealer.message"), value: (l) => l.message, cell: (l) => l.message ?? "–", hideOnMobile: true },
            { id: "status", header: t("common.status"), value: (l) => l.status, cell: (l) => canWrite ? (
              <select className="mid-select mid-select-liten" aria-label={t("common.status")} value={l.status} onChange={async (e) => {
                await rpc("update_lead", { p_org_id: orgId, p_lead_id: l.id, p_status: e.target.value });
                await queryClient.invalidateQueries({ queryKey: ["rpc"] });
              }}>{["new", "contacted", "won", "lost"].map((s) => <option key={s} value={s}>{t(`dealer.lead_status.${s}`)}</option>)}</select>
            ) : t(`dealer.lead_status.${l.status}`) },
          ]} />
      )}
    </div>
  );
}

/** Customer register built from sales and registrations (SPEC §7.2 "Kunder"). */
export function CustomersPage() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const q = useRpc<Customer[]>("list_customers", { p_org_id: orgId });
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.customers")} lead={t("dealer.customers_lead")} />
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.customers")} rows={q.data ?? []} getKey={(c) => c.id} exportName="kunder"
          empty={<EmptyState icon="lista" title={t("dealer.no_customers")} />}
          columns={[
            { id: "name", header: t("common.name"), value: (c) => c.name, sortable: true, cell: (c) => <><strong>{c.name}</strong><br /><span className="t-liten t-sekundar mid-id">{c.org_number ?? ""}</span></> },
            { id: "city", header: t("common.city"), value: (c) => c.city, cell: (c) => c.city ?? "–", hideOnMobile: true },
            { id: "contact", header: t("dealer.contact"), value: (c) => c.email ?? c.phone, cell: (c) => [c.email, c.phone].filter(Boolean).join(" · ") || "–", hideOnMobile: true },
            { id: "sold", header: t("dealer.machines_sold"), value: (c) => c.machines_sold, cell: (c) => c.machines_sold, sortable: true },
            { id: "reg", header: t("dealer.machines_registered"), value: (c) => c.machines_registered, cell: (c) => c.machines_registered, hideOnMobile: true },
            { id: "last", header: t("dealer.last_deal"), value: (c) => c.last_at, cell: (c) => formatDateTime(c.last_at), sortable: true },
          ]} />
      )}
    </div>
  );
}
