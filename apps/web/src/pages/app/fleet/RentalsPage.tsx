import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { CompanyLookupField, type CompanyInfo } from "../../../components/CompanyLookupField";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { MachineListItem } from "../../../lib/api/types";
import { formatDate, todayIso } from "../../../lib/format";

interface Rental { id: string; machine_id: string; reg_number: string; make: string; model: string; direction: "in" | "out"; lessor: string; lessee: string;
  from_date: string; to_date: string; status: string; reference: string | null }

/** Rentals (SPEC §4.6): machines we rent out (with a rental right in the register) and machines we rent. */
export function RentalsPage() {
  const { t } = useTranslation();
  const { orgId, path, canWrite } = useOrg();
  const q = useRpc<Rental[]>("list_rentals", { p_org_id: orgId });
  const [open, setOpen] = useState(false);
  const kind = (s: string) => (s === "active" ? "verifierad" : s === "overdue" ? "sparr" : s === "planned" ? "vantar" : "neutral") as "verifierad" | "sparr" | "vantar" | "neutral";
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.rentals")} lead={t("rentals.lead")}
        actions={canWrite ? <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setOpen(true)}><Icon name="plus" />{t("rentals.new")}</button> : undefined} />
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.rentals")} rows={q.data ?? []} getKey={(r) => r.id} exportName="uthyrning"
          empty={<EmptyState icon="byt" title={t("rentals.empty")} />}
          filters={[{ id: "dir", label: t("rentals.direction"), options: [{ value: "out", label: t("rentals.out") }, { value: "in", label: t("rentals.in") }], match: (r, v) => r.direction === v }]}
          columns={[
            { id: "reg", header: t("machines.col_reg"), value: (r) => r.reg_number, cell: (r) => r.direction === "out" ? <Link to={path(`machines/${r.machine_id}`)}><RegNumber value={r.reg_number} /></Link> : <RegNumber value={r.reg_number} /> },
            { id: "machine", header: t("machines.col_machine"), value: (r) => `${r.make} ${r.model}`, cell: (r) => `${r.make} ${r.model}` },
            { id: "party", header: t("rentals.party"), value: (r) => (r.direction === "out" ? r.lessee : r.lessor), cell: (r) => (
              <>{r.direction === "out" ? r.lessee : r.lessor}<br /><span className="t-liten t-sekundar">{t(r.direction === "out" ? "rentals.out" : "rentals.in")}</span></>) },
            { id: "period", header: t("fleet.period"), value: (r) => r.from_date, cell: (r) => `${formatDate(r.from_date)} – ${formatDate(r.to_date)}`, sortable: true },
            { id: "status", header: t("common.status"), value: (r) => r.status, cell: (r) => (
              <span className="mid-rad"><StatusBadge kind={kind(r.status)}>{t(`enum.rental_status.${r.status}`)}</StatusBadge>
                {r.direction === "out" && canWrite && r.status !== "returned" && (
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={async () => {
                    await rpc("return_rental", { p_org_id: orgId, p_rental_id: r.id });
                    await queryClient.invalidateQueries({ queryKey: ["rpc"] });
                  }}>{t("rentals.returned")}</button>
                )}</span>) },
          ]} />
      )}
      {open && <NewRental onClose={() => setOpen(false)} />}
    </div>
  );
}

function NewRental({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const machines = useRpc<{ items: MachineListItem[] }>("list_machines", { p_org_id: orgId, p_scope: "owned", p_status: "active", p_limit: 500 });
  const [machine, setMachine] = useState("");
  const [orgNr, setOrgNr] = useState("");
  const [lessee, setLessee] = useState<CompanyInfo | null>(null);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title={t("rentals.new")}>
      <form className="stack-4" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setMsg(null);
        if (!lessee?.existing_org) { setMsg(t("rentals.lessee_needs_account")); return; }
        try {
          await rpc("create_rental", { p_org_id: orgId, p_machine_id: machine, p_lessee_org_id: lessee.existing_org.id, p_from: from, p_to: to, p_reference: ref || null });
          await queryClient.invalidateQueries({ queryKey: ["rpc"] });
          onClose();
        } catch (err) { setError(err); }
      }}>
        <FormField label={t("machines.col_machine")}>
          <select className="mid-select" value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">{t("common.select")}</option>
            {(machines.data?.items ?? []).map((m) => <option key={m.id} value={m.id}>{m.reg_number} · {m.make} {m.model}</option>)}
          </select>
        </FormField>
        <FormField label={t("rentals.lessee")} error={msg}>
          <CompanyLookupField value={orgNr} onChange={setOrgNr} onFound={setLessee} />
        </FormField>
        <div className="rutnat">
          <FormField className="kol-6" label={t("fleet.starts_on")}><input className="mid-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
          <FormField className="kol-6" label={t("fleet.ends_on")}><input className="mid-input" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
        </div>
        <FormField label={t("actions.encumbrance.contract_ref")} optional><input className="mid-input" value={ref} onChange={(e) => setRef(e.target.value)} /></FormField>
        <p className="t-liten t-sekundar">{t("rentals.register_note")}</p>
        {error != null && <ErrorNotice error={error} />}
        <div className="mid-rad mid-rad-slut">
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!machine || !to}>{t("common.save")}</button>
        </div>
      </form>
    </Dialog>
  );
}
