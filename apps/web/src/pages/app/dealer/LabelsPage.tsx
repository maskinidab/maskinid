import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { RegNumber } from "../../../components/RegNumber";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import { formatDate } from "../../../lib/format";

interface Labels {
  batches: { id: string; quantity: number; status: string; created_at: string; shipping_address: Record<string, string> | null }[];
  labels: { id: string; code: string; serial: string; status: string; role: string; machine_id: string | null; reg_number: string | null; bound_at: string | null }[];
}

/** Labels (SPEC §5.2): order tamper-proof labels ("Beställ 50 märken"), see assigned/bound labels. */
export function LabelsPage() {
  const { t } = useTranslation();
  const { orgId, org, path, canWrite } = useOrg();
  const q = useRpc<Labels>("list_labels", { p_org_id: orgId });
  const [qty, setQty] = useState(50);
  const [addr, setAddr] = useState({ street: "", postal_code: "", city: org.city ?? "" });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.labels")} lead={t("labels.lead")} />
      {canWrite && (
        <form className="panel stack-3" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await rpc("order_labels", { p_org_id: orgId, p_quantity: qty, p_shipping_address: addr });
            setDone(true);
            await queryClient.invalidateQueries({ queryKey: ["rpc"] });
          } catch (err) { setError(err); }
        }}>
          <h2 className="t-rubrik-4">{t("labels.order_title")}</h2>
          <div className="rutnat">
            <FormField className="kol-4" label={t("labels.quantity")}>
              <select className="mid-select" value={qty} onChange={(e) => setQty(Number(e.target.value))}>
                {[10, 25, 50, 100, 250, 500].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </FormField>
            <FormField className="kol-8" label={t("common.address")}><input className="mid-input" value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} /></FormField>
            <FormField className="kol-4" label={t("labels.postal_code")}><input className="mid-input" inputMode="numeric" value={addr.postal_code} onChange={(e) => setAddr({ ...addr, postal_code: e.target.value })} /></FormField>
            <FormField className="kol-8" label={t("common.city")}><input className="mid-input" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></FormField>
          </div>
          {done && <Notice kind="ok" title={t("labels.ordered")} />}
          {error != null && <ErrorNotice error={error} />}
          <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!addr.street || !addr.city}>{t("labels.order", { count: qty })}</button></div>
        </form>
      )}
      {q.isLoading ? <Skeleton lines={4} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <>
          {(q.data?.batches ?? []).length > 0 && (
            <section className="stack-3" aria-labelledby="bestallningar">
              <h2 id="bestallningar" className="t-rubrik-4">{t("labels.orders")}</h2>
              <ul className="radlista">
                {q.data!.batches.map((b) => (
                  <li key={b.id}><span>{t("labels.batch", { count: b.quantity, date: formatDate(b.created_at) })}</span>
                    <StatusBadge kind={b.status === "shipped" ? "verifierad" : b.status === "cancelled" ? "neutral" : "vantar"}>{t(`enum.label_batch_status.${b.status}`)}</StatusBadge></li>
                ))}
              </ul>
            </section>
          )}
          <DataTable caption={t("labels.labels")} rows={q.data?.labels ?? []} getKey={(l) => l.id} exportName="marken"
            empty={<EmptyState icon="qr" title={t("labels.none")} body={t("labels.none_body")} />}
            filters={[{ id: "status", label: t("common.status"), options: ["assigned", "bound", "revoked", "lost"].map((s) => ({ value: s, label: t(`enum.label_status.${s}`) })), match: (l, v) => l.status === v }]}
            columns={[
              { id: "serial", header: t("labels.serial"), value: (l) => l.serial, cell: (l) => <span className="mid-id">{l.serial}</span> },
              { id: "status", header: t("common.status"), value: (l) => l.status, cell: (l) => t(`enum.label_status.${l.status}`) },
              { id: "role", header: t("labels.role"), value: (l) => l.role, cell: (l) => t(`labels.role_${l.role}`), hideOnMobile: true },
              { id: "machine", header: t("machines.col_machine"), value: (l) => l.reg_number, cell: (l) => l.machine_id && l.reg_number ? <Link to={path(`machines/${l.machine_id}`)}><RegNumber value={l.reg_number} /></Link> : "–" },
              { id: "bound", header: t("labels.bound_at"), value: (l) => l.bound_at, cell: (l) => formatDate(l.bound_at) || "–", hideOnMobile: true },
            ]} />
        </>
      )}
    </div>
  );
}
