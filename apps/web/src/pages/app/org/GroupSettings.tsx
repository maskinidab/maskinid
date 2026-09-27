import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { RegNumber } from "../../../components/RegNumber";
import { FinancingBadge, MachineStatusBadge } from "../../../components/StatusBadge";
import { useRpc, useRpcMutation } from "../../../lib/api/query";
import type { MachineListItem, OrgBrief } from "../../../lib/api/types";

interface Group {
  parent: OrgBrief | null;
  links: { id: string; status: string; direction: "up" | "down"; child: OrgBrief; parent: OrgBrief; machines: number }[];
}

/** Settings → Koncern: link to a parent company, accept subsidiaries (step 21). */
export function GroupSettings() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const q = useRpc<Group>("get_group", { p_org_id: orgId });
  const [query, setQuery] = useState("");
  const found = useRpc<OrgBrief[]>("search_orgs", query.trim().length >= 2 ? { p_query: query.trim() } : null);
  const [parent, setParent] = useState("");
  const request = useRpcMutation<{ p_org_id: string; p_parent_org_id: string }>("request_group_link");
  const decide = useRpcMutation<{ p_org_id: string; p_link_id: string; p_accept: boolean }>("decide_group_link");
  const end = useRpcMutation<{ p_org_id: string; p_link_id: string }>("end_group_link");
  if (q.isLoading) return <Skeleton lines={4} />;
  const g = q.data!;
  const up = g.links.find((l) => l.direction === "up");
  const down = g.links.filter((l) => l.direction === "down");
  const err = request.error ?? decide.error ?? end.error;
  return (
    <div className="stack-5">
      <p className="t-liten">{t("group.lead")}</p>
      {err && <ErrorNotice error={err} />}
      <section className="panel stack-3">
        <h2 className="t-rubrik-4">{t("group.parent_title")}</h2>
        {up ? (
          <div className="mid-rad mid-rad-mellan">
            <span>{up.parent.name} · {t(`group.status.${up.status}`)}</span>
            <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => end.mutate({ p_org_id: orgId, p_link_id: up.id })}>{t("group.end")}</button>
          </div>
        ) : down.some((l) => l.status === "active") ? <p className="t-liten t-sekundar">{t("group.is_parent")}</p> : (
          <form className="stack-3" onSubmit={(e) => { e.preventDefault(); if (parent) request.mutate({ p_org_id: orgId, p_parent_org_id: parent }); }}>
            <FormField label={t("group.search_parent")}><input className="mid-input" value={query} onChange={(e) => setQuery(e.target.value)} /></FormField>
            {!!found.data?.length && (
              <select className="mid-select" aria-label={t("group.parent_title")} value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">{t("common.select")}</option>
                {found.data.filter((o) => o.id !== orgId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!parent || request.isPending}>{t("group.request")}</button></div>
          </form>
        )}
      </section>
      <section className="panel stack-3">
        <h2 className="t-rubrik-4">{t("group.children_title")}</h2>
        {!down.length ? <p className="t-liten t-sekundar">{t("group.no_children")}</p> : (
          <ul className="radlista">
            {down.map((l) => (
              <li key={l.id}>
                <span><strong>{l.child.name}</strong><br /><span className="t-liten t-sekundar">{t(`group.status.${l.status}`)} · {t("group.machines", { count: l.machines })}</span></span>
                <span className="mid-rad">
                  {l.status === "pending" && <>
                    <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" onClick={() => decide.mutate({ p_org_id: orgId, p_link_id: l.id, p_accept: true })}>{t("mandate.accept")}</button>
                    <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => decide.mutate({ p_org_id: orgId, p_link_id: l.id, p_accept: false })}>{t("mandate.decline")}</button>
                  </>}
                  {l.status === "active" && <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => end.mutate({ p_org_id: orgId, p_link_id: l.id })}>{t("group.end")}</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {down.some((l) => l.status === "active") && <Link className="mid-lank" to={path("group")}>{t("group.open_fleet")}</Link>}
      </section>
    </div>
  );
}

/** Koncernöversikt: the parent's read-only view of all subsidiaries' machines. */
export function GroupFleetPage() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const q = useRpc<(MachineListItem & { company: OrgBrief })[]>("list_group_machines", { p_org_id: orgId });
  const companies = [...new Map((q.data ?? []).map((m) => [m.company.id, m.company.name])).entries()];
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.group")} lead={t("group.fleet_lead")} />
      <Notice kind="info" title={t("group.read_only")} />
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.group")} rows={q.data!} getKey={(m) => m.id} exportName="koncern"
          empty={<EmptyState icon="bygg" title={t("group.no_children")} />}
          filters={[{ id: "company", label: t("group.company"), options: companies.map(([id, name]) => ({ value: id, label: name })), match: (m, v) => m.company.id === v }]}
          columns={[
            { id: "company", header: t("group.company"), value: (m) => m.company.name, sortable: true, cell: (m) => m.company.name },
            { id: "reg", header: t("machines.col_reg"), value: (m) => m.reg_number, cell: (m) => <Link to={path(`machines/${m.id}`)}><RegNumber value={m.reg_number} /></Link> },
            { id: "machine", header: t("machines.col_machine"), value: (m) => `${m.make} ${m.model}`, sortable: true, cell: (m) => `${m.make} ${m.model}` },
            { id: "status", header: t("common.status"), value: (m) => m.status,
              cell: (m) => <span className="badge-rad">{m.status !== "active" && <MachineStatusBadge status={m.status} />}{m.has_active_financing && <FinancingBadge hasActive />}</span> },
          ]} />
      )}
    </div>
  );
}

interface Department { id: string; name: string; code: string | null; active: boolean; machines: number }

/** Settings → Avdelningar: the org's own grouping of machines (cost centres, depots). */
export function DepartmentSettings() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const q = useRpc<Department[]>("list_departments", { p_org_id: orgId });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const save = useRpcMutation<{ p_org_id: string; p_name: string; p_code: string | null; p_department_id?: string; p_active?: boolean }>("save_department",
    { onSuccess: () => { setName(""); setCode(""); } });
  return (
    <div className="stack-5">
      <p className="t-liten">{t("department.lead")}</p>
      <form className="mid-rad" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate({ p_org_id: orgId, p_name: name, p_code: code || null }); }}>
        <FormField label={t("common.name")}><input className="mid-input" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label={t("department.code")} optional><input className="mid-input" value={code} onChange={(e) => setCode(e.target.value)} /></FormField>
        <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!name.trim() || save.isPending}>{t("department.add")}</button></div>
      </form>
      {save.error && <ErrorNotice error={save.error} />}
      {q.isLoading ? <Skeleton lines={3} /> : !q.data?.length ? <p className="t-liten t-sekundar">{t("department.none")}</p> : (
        <ul className="radlista">
          {q.data.map((d) => (
            <li key={d.id}>
              <span><strong>{d.name}</strong>{d.code ? <span className="mid-id"> {d.code}</span> : null}<br />
                <span className="t-liten t-sekundar">{t("group.machines", { count: d.machines })}{d.active ? "" : ` · ${t("equipment.inactive")}`}</span></span>
              <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten"
                onClick={() => save.mutate({ p_org_id: orgId, p_name: d.name, p_code: d.code, p_department_id: d.id, p_active: !d.active })}>
                {d.active ? t("department.deactivate") : t("department.activate")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
