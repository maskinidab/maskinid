import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { RegNumber } from "../../../components/RegNumber";
import { MachineStatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { MachineStatus } from "../../../lib/api/types";
import { formatDate } from "../../../lib/format";
import { parseCsv } from "../../../lib/tabular";

interface Watch { id: string; identifier_type: string; identifier_value: string; note: string | null; created_at: string;
  match: { reg_number: string; status: MachineStatus; make: string; model: string } | null }

/** Watchlist ("bevaka serienummer"): get a notice when a watched reg number/serial is registered, flagged, sold … */
export function WatchlistPage() {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const q = useRpc<Watch[]>("list_watch", { p_org_id: orgId });
  const [type, setType] = useState("any");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [bulk, setBulk] = useState("");
  const [error, setError] = useState<unknown>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rpc"] });
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.watchlist")} lead={t("watch.lead")} />
      {canWrite && (
        <form className="panel stack-3" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            if (bulk.trim()) {
              const rows = parseCsv(`v\n${bulk}`).rows.map((r) => r.v!).filter(Boolean).slice(0, 1000);
              for (const v of rows) await rpc("add_watch", { p_org_id: orgId, p_type: "any", p_value: v, p_note: note || null });
              setBulk("");
            } else {
              await rpc("add_watch", { p_org_id: orgId, p_type: type, p_value: value, p_note: note || null });
              setValue("");
            }
            await refresh();
          } catch (err) { setError(err); }
        }}>
          <div className="rutnat">
            <FormField className="kol-3" label={t("common.type")}>
              <select className="mid-select" value={type} onChange={(e) => setType(e.target.value)}>
                {["any", "reg", "pin", "serial", "vin", "road_reg"].map((x) => <option key={x} value={x}>{t(`check.type_${x}`)}</option>)}
              </select>
            </FormField>
            <FormField className="kol-9" label={t("check.query")}><input className="mid-input is-id" value={value} onChange={(e) => setValue(e.target.value)} /></FormField>
          </div>
          <FormField label={t("watch.bulk")} optional hint={t("watch.bulk_hint")}><textarea className="mid-textarea is-id" rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)} /></FormField>
          <FormField label={t("common.note")} optional><input className="mid-input" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          {error != null && <ErrorNotice error={error} />}
          <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!value.trim() && !bulk.trim()}>{t("watch.add")}</button></div>
        </form>
      )}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.watchlist")} rows={q.data ?? []} getKey={(w) => w.id} exportName="bevakning"
          empty={<EmptyState icon="oga" title={t("watch.empty")} />}
          columns={[
            { id: "value", header: t("check.query"), value: (w) => w.identifier_value, cell: (w) => <span className="mid-id">{w.identifier_value}</span> },
            { id: "note", header: t("common.note"), value: (w) => w.note, cell: (w) => w.note ?? "–", hideOnMobile: true },
            { id: "match", header: t("watch.match"), value: (w) => w.match?.reg_number ?? "", cell: (w) => w.match
              ? <span className="mid-rad"><RegNumber value={w.match.reg_number} /><MachineStatusBadge status={w.match.status} /></span> : t("watch.not_registered") },
            { id: "since", header: t("watch.since"), value: (w) => w.created_at, cell: (w) => formatDate(w.created_at), hideOnMobile: true },
            { id: "x", header: "", cell: (w) => canWrite ? <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten"
              onClick={async () => { await rpc("remove_watch", { p_org_id: orgId, p_watch_id: w.id }); await refresh(); }}>{t("common.remove")}</button> : null },
          ]} />
      )}
    </div>
  );
}
