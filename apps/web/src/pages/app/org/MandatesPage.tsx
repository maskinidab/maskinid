import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { useSign } from "../../../components/Signature";
import { StatusBadge } from "../../../components/StatusBadge";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import type { OrgBrief } from "../../../lib/api/types";
import { formatDate, formatReg } from "../../../lib/format";

interface Mandate {
  id: string; kind: "consignment" | "power_of_attorney"; scopes: string[]; valid_from: string; valid_to: string; note: string | null;
  status: string; effective_status: string; direction: "granted" | "received"; principal: OrgBrief; agent: OrgBrief;
  machine: { id: string; reg_number: string; make: string; model: string } | null;
}
const KIND = { pending: "vantar", active: "verifierad", expired: "neutral", revoked: "neutral", declined: "neutral", completed: "neutral" } as const;

/** Fullmakter och kommission (step 21): what the org has granted and received. */
export function MandatesPage() {
  const { t } = useTranslation();
  const { orgId, path, isAdmin, has } = useOrg();
  const q = useRpc<Mandate[]>("list_mandates", { p_org_id: orgId });
  const [granting, setGranting] = useState(false);
  const respond = useRpcMutation<{ p_org_id: string; p_mandate_id: string; p_accept: boolean }>("respond_mandate");
  const revoke = useRpcMutation<{ p_org_id: string; p_mandate_id: string }>("revoke_mandate");
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.mandates")} lead={t("mandate.lead")}
        actions={isAdmin && has("owner") ? <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setGranting(true)}><Icon name="plus" />{t("mandate.grant_poa")}</button> : undefined} />
      {(respond.error || revoke.error) && <ErrorNotice error={respond.error ?? revoke.error} />}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.mandates")} rows={q.data!} getKey={(d) => d.id} exportName="fullmakter"
          empty={<EmptyState icon="sigill" title={t("mandate.none")} body={t("mandate.none_body")} />}
          filters={[{ id: "dir", label: t("mandate.direction"), options: [{ value: "granted", label: t("mandate.granted") }, { value: "received", label: t("mandate.received") }],
            match: (d, v) => d.direction === v }]}
          columns={[
            { id: "kind", header: t("common.type"), value: (d) => d.kind,
              cell: (d) => <><strong>{t(`mandate.kind.${d.kind}`)}</strong><br /><span className="t-liten t-sekundar">{d.scopes.map((s) => t(`mandate.scope.${s}`)).join(", ")}</span></> },
            { id: "party", header: t("mandate.party"), value: (d) => (d.direction === "granted" ? d.agent.name : d.principal.name),
              cell: (d) => <>{d.direction === "granted" ? t("mandate.to", { org: d.agent.name }) : t("mandate.from", { org: d.principal.name })}</> },
            { id: "machine", header: t("machines.col_machine"), value: (d) => d.machine?.reg_number ?? "",
              cell: (d) => (d.machine ? <Link to={path(`machines/${d.machine.id}`)}><RegNumber value={d.machine.reg_number} /></Link> : t("mandate.all_machines")) },
            { id: "valid", header: t("mandate.valid_to"), value: (d) => d.valid_to, sortable: true, cell: (d) => formatDate(d.valid_to) },
            { id: "status", header: t("common.status"), value: (d) => d.effective_status,
              cell: (d) => <StatusBadge kind={KIND[d.effective_status as keyof typeof KIND] ?? "neutral"}>{t(`mandate.status.${d.effective_status}`)}</StatusBadge> },
            { id: "act", header: "", value: () => "", cell: (d) => isAdmin && (
              <div className="mid-rad">
                {d.direction === "received" && d.status === "pending" && <>
                  <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" onClick={() => respond.mutate({ p_org_id: orgId, p_mandate_id: d.id, p_accept: true })}>{t("mandate.accept")}</button>
                  <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => respond.mutate({ p_org_id: orgId, p_mandate_id: d.id, p_accept: false })}>{t("mandate.decline")}</button>
                </>}
                {["pending", "active"].includes(d.status) && !(d.direction === "received" && d.status === "pending") && (
                  <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => revoke.mutate({ p_org_id: orgId, p_mandate_id: d.id })}>{t("mandate.revoke")}</button>
                )}
              </div>
            ) },
          ]} />
      )}
      {granting && <GrantMandateDialog onClose={() => setGranting(false)} />}
    </div>
  );
}

/** Grant: consignment for one machine (to a dealer) or a power of attorney (one or all machines). Signed with BankID. */
export function GrantMandateDialog({ onClose, machine }: { onClose(): void; machine?: { id: string; reg_number: string } }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  const [kind, setKind] = useState<"consignment" | "power_of_attorney">(machine ? "consignment" : "power_of_attorney");
  const [agent, setAgent] = useState("");
  const [query, setQuery] = useState("");
  const [scopes, setScopes] = useState<string[]>(machine ? ["sell", "view"] : ["fleet"]);
  const [validTo, setValidTo] = useState(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dealers = useRpc<OrgBrief[]>("list_partner_orgs", kind === "consignment" ? { p_type: "dealer" } : null);
  const found = useRpc<OrgBrief[]>("search_orgs", kind === "power_of_attorney" && query.trim().length >= 2 ? { p_query: query.trim() } : null);
  const options = (kind === "consignment" ? dealers.data : found.data) ?? [];
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const sorted = [...new Set(scopes)].sort();
      const sig = await sign(orgId, "grant_mandate", orgId, { agent_org_id: agent, machine_id: machine?.id ?? "", scopes: sorted.join(", "), valid_to: validTo });
      await rpc("grant_mandate", { p_org_id: orgId, p_agent_org_id: agent, p_kind: kind, p_machine_id: machine?.id ?? null, p_scopes: sorted,
        p_valid_to: validTo, p_note: note || null, p_signature_id: sig });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={machine ? t("mandate.grant_for", { reg: formatReg(machine.reg_number) }) : t("mandate.grant_poa")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {machine && (
          <fieldset className="stack-2">
            <legend className="mid-etikett">{t("common.type")}</legend>
            {(["consignment", "power_of_attorney"] as const).map((k) => (
              <label key={k} className="mid-kryss"><input type="radio" checked={kind === k} onChange={() => { setKind(k); setAgent(""); }} />
                <span><strong>{t(`mandate.kind.${k}`)}</strong><br /><span className="t-liten t-sekundar">{t(`mandate.kind_hint.${k}`)}</span></span></label>
            ))}
          </fieldset>
        )}
        {kind === "power_of_attorney" && (
          <FormField label={t("mandate.search_agent")}><input className="mid-input" value={query} onChange={(e) => setQuery(e.target.value)} /></FormField>
        )}
        <FormField label={t("mandate.agent")}>
          <select className="mid-select" value={agent} onChange={(e) => setAgent(e.target.value)} required>
            <option value="">{t("common.select")}</option>
            {options.filter((o) => o.id !== orgId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </FormField>
        <fieldset className="stack-2">
          <legend className="mid-etikett">{t("mandate.scopes")}</legend>
          {["sell", "view", "fleet"].map((s) => (
            <label key={s} className="mid-kryss"><input type="checkbox" checked={scopes.includes(s)}
              onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
              <span>{t(`mandate.scope.${s}`)}<br /><span className="t-liten t-sekundar">{t(`mandate.scope_hint.${s}`)}</span></span></label>
          ))}
        </fieldset>
        <FormField label={t("mandate.valid_to")} hint={t("mandate.valid_hint")}>
          <input className="mid-input" type="date" value={validTo} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setValidTo(e.target.value)} />
        </FormField>
        <FormField label={t("common.notes")} optional><input className="mid-input" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        {!!error && <ErrorNotice error={error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!agent || !scopes.length || busy}><Icon name="skold" />{t("mandate.sign_grant")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
