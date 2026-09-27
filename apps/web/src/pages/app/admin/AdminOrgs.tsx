import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth/AuthProvider";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { StatusBadge } from "../../../components/StatusBadge";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import type { OrgType } from "../../../lib/api/types";
import { formatDate, formatDateTime } from "../../../lib/format";
import { useAdmin } from "./useAdmin";

export interface AdminOrg {
  id: string; slug: string; name: string; org_number: string | null; is_sole_trader: boolean; types: OrgType[];
  status: "pending" | "approved" | "suspended"; city: string | null; created_at: string; approved_at: string | null;
  suspended_reason: string | null; lookup_source: string | null; members: number; machines: number;
}

const STATUS_KIND = { pending: "vantar", approved: "verifierad", suspended: "sparr" } as const;
const ORG_TYPES: OrgType[] = ["owner", "dealer", "financier", "insurer", "authority", "inspector", "marketplace", "manufacturer", "client"];

export function OrgStatusBadge({ status }: { status: AdminOrg["status"] }) {
  const { t } = useTranslation();
  return <StatusBadge kind={STATUS_KIND[status]}>{t(`enum.org_status.${status}`)}</StatusBadge>;
}

/** Organisations (SPEC §9 /admin): approval queue first, search over all. */
export function AdminOrgsPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "pending") as AdminOrg["status"] | "all";
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const q = useRpc<AdminOrg[]>("admin_list_orgs", { p_status: status === "all" ? null : status, p_query: submitted });
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.orgs.title")} lead={t("admin.orgs.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      <Tabs label={t("admin.orgs.title")} value={status} onChange={(s) => setParams({ status: s }, { replace: true })}
        tabs={(["pending", "approved", "suspended", "all"] as const).map((s) => ({ id: s, label: s === "all" ? t("common.all") : t(`enum.org_status.${s}`) }))} />
      <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim() || null); }}>
        <FormField label={t("admin.orgs.search")}><input className="mid-input" value={query} onChange={(e) => setQuery(e.target.value)} /></FormField>
        <button type="submit" className="mid-knapp mid-knapp-sekundar">{t("common.search")}</button>
      </form>
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.orgs.title")} rows={q.data!} getKey={(o) => o.id} exportName="organisationer"
          empty={<EmptyState icon="bock" title={t("admin.orgs.empty")} />}
          columns={[
            { id: "name", header: t("common.name"), value: (o) => o.name, sortable: true,
              cell: (o) => <><Link className="mid-lank" to={path(`admin/organizations/${o.id}`)}><strong>{o.name}</strong></Link><br />
                <span className="t-liten t-sekundar mid-id">{o.org_number ?? "–"}</span>{o.city ? <span className="t-liten t-sekundar"> · {o.city}</span> : null}</> },
            { id: "types", header: t("admin.orgs.types"), value: (o) => o.types.join(", "), cell: (o) => o.types.map((x) => t(`enum.org_type.${x}`)).join(", ") },
            { id: "status", header: t("common.status"), value: (o) => o.status, cell: (o) => <OrgStatusBadge status={o.status} /> },
            { id: "members", header: t("admin.orgs.members"), value: (o) => o.members, sortable: true, hideOnMobile: true, cell: (o) => o.members },
            { id: "machines", header: t("dashboard.machines"), value: (o) => o.machines, sortable: true, hideOnMobile: true, cell: (o) => o.machines },
            { id: "created", header: t("admin.orgs.created"), value: (o) => o.created_at, sortable: true, hideOnMobile: true, cell: (o) => formatDate(o.created_at) },
          ]} />
      )}
    </div>
  );
}

interface OrgDetail {
  org: AdminOrg & { dpa_accepted_at: string | null };
  members: { user_id: string | null; name: string | null; email: string | null; role: string; status: string; identity_verified: boolean; accepted_at: string | null }[];
  machines: number; api_keys: number;
  events: { seq: number; type: string; created_at: string; machine_id: string | null }[];
}

export function AdminOrgPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { id } = useParams();
  const { atLeast } = useAdmin();
  const q = useRpc<OrgDetail>("admin_get_org", { p_org_id: id });
  const [dialog, setDialog] = useState<"types" | "suspend" | "viewas" | null>(null);
  const approve = useRpcMutation<{ p_org_id: string }>("approve_org");
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const { org, members, events } = q.data!;
  return (
    <div className="stack-6">
      <PageHeader title={org.name} lead={[org.org_number, org.city].filter(Boolean).join(" · ")}
        crumbs={[{ to: path("admin"), label: t("nav.admin") }, { to: path("admin/organizations"), label: t("admin.orgs.title") }]} />
      <section className="panel stack-3">
        <div className="badge-rad"><OrgStatusBadge status={org.status} />{org.types.map((x) => <StatusBadge key={x} kind="neutral">{t(`enum.org_type.${x}`)}</StatusBadge>)}</div>
        <dl className="faktarutnat">
          <div><dt>{t("admin.orgs.created")}</dt><dd>{formatDateTime(org.created_at)}</dd></div>
          <div><dt>{t("admin.orgs.lookup")}</dt><dd>{org.lookup_source ?? t("admin.orgs.not_looked_up")}</dd></div>
          <div><dt>{t("admin.orgs.dpa")}</dt><dd>{org.dpa_accepted_at ? formatDate(org.dpa_accepted_at) : "–"}</dd></div>
          <div><dt>{t("dashboard.machines")}</dt><dd>{q.data!.machines}</dd></div>
          <div><dt>{t("admin.orgs.api_keys")}</dt><dd>{q.data!.api_keys}</dd></div>
        </dl>
        {org.suspended_reason && <Notice kind="fel" title={t("admin.orgs.suspended_reason", { reason: org.suspended_reason })} />}
        {approve.error && <ErrorNotice error={approve.error} />}
        {atLeast("support") && (
          <div className="mid-rad">
            {atLeast("verifier") && org.status !== "approved" && (
              <button type="button" className="mid-knapp mid-knapp-primar" disabled={approve.isPending} onClick={() => approve.mutate({ p_org_id: org.id })}>
                {org.status === "suspended" ? t("admin.orgs.reactivate") : t("admin.orgs.approve")}
              </button>
            )}
            {atLeast("verifier") && !org.types.includes("operator") && <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setDialog("types")}>{t("admin.orgs.change_types")}</button>}
            {atLeast("superadmin") && org.status !== "suspended" && !org.types.includes("operator") && (
              <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setDialog("suspend")}>{t("admin.orgs.suspend")}</button>
            )}
            {org.status === "approved" && !org.types.includes("operator") && (
              <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setDialog("viewas")}>{t("viewas.start")}</button>
            )}
          </div>
        )}
      </section>
      <section className="stack-3">
        <h2 className="t-rubrik-4">{t("admin.orgs.members")}</h2>
        <DataTable caption={t("admin.orgs.members")} rows={members} getKey={(m) => m.user_id ?? m.email ?? ""}
          columns={[
            { id: "name", header: t("common.name"), value: (m) => m.name ?? "", cell: (m) => <><strong>{m.name ?? "–"}</strong><br /><span className="t-liten t-sekundar">{m.email}</span></> },
            { id: "role", header: t("admin.orgs.role"), value: (m) => m.role, cell: (m) => t(`enum.member_role.${m.role}`) },
            { id: "status", header: t("common.status"), value: (m) => m.status, cell: (m) => t(`enum.membership_status.${m.status}`) },
            { id: "bankid", header: t("admin.orgs.identity"), value: (m) => String(m.identity_verified), cell: (m) => (m.identity_verified ? t("common.yes") : t("common.no")) },
          ]} />
      </section>
      <section className="stack-3">
        <h2 className="t-rubrik-4">{t("admin.events.title")}</h2>
        <ul className="stack-1 t-liten">
          {events.slice(0, 10).map((e) => <li key={e.seq}><span className="mid-id">#{e.seq} {e.type}</span> <span className="t-sekundar">· {formatDateTime(e.created_at)}</span></li>)}
        </ul>
        <Link className="mid-lank" to={path(`admin/events?org=${org.id}`)}>{t("admin.events.all_for_org")}</Link>
      </section>
      {dialog === "types" && <TypesDialog org={org} onClose={() => setDialog(null)} />}
      {dialog === "suspend" && <SuspendDialog org={org} onClose={() => setDialog(null)} />}
      {dialog === "viewas" && <ViewAsDialog org={org} onClose={() => setDialog(null)} />}
    </div>
  );
}

function TypesDialog({ org, onClose }: { org: AdminOrg; onClose(): void }) {
  const { t } = useTranslation();
  const [types, setTypes] = useState<OrgType[]>(org.types);
  const [note, setNote] = useState("");
  const m = useRpcMutation<{ p_org_id: string; p_types: OrgType[]; p_note: string | null }>("admin_set_org_types", { onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={t("admin.orgs.change_types")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ p_org_id: org.id, p_types: types, p_note: note.trim() || null }); }}>
        <fieldset className="stack-2">
          <legend className="mid-etikett">{t("admin.orgs.types")}</legend>
          {ORG_TYPES.map((x) => (
            <label key={x} className="mid-kryss">
              <input type="checkbox" checked={types.includes(x)} onChange={(e) => setTypes(e.target.checked ? [...types, x] : types.filter((y) => y !== x))} />
              {t(`enum.org_type.${x}`)}
            </label>
          ))}
        </fieldset>
        <FormField label={t("admin.note")} optional><input className="mid-input" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!types.length || m.isPending}>{t("common.save")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function SuspendDialog({ org, onClose }: { org: AdminOrg; onClose(): void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const m = useRpcMutation<{ p_org_id: string; p_reason: string }>("suspend_org", { onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={t("admin.orgs.suspend")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ p_org_id: org.id, p_reason: reason.trim() }); }}>
        <p>{t("admin.orgs.suspend_lead", { name: org.name })}</p>
        <FormField label={t("admin.reason")}><textarea className="mid-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required /></FormField>
        {m.error && <ErrorNotice error={m.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-fara" disabled={!reason.trim() || m.isPending}>{t("admin.orgs.suspend")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** "Visa som organisation": read-only, time-limited, logged and announced to the org's admins. */
function ViewAsDialog({ org, onClose }: { org: AdminOrg; onClose(): void }) {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await rpc<{ slug: string }>("admin_start_view_as", { p_org_id: org.id, p_reason: reason.trim() });
      await refresh();
      nav(`/o/${r.slug}/dashboard`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={t("viewas.start")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <p>{t("viewas.lead", { name: org.name })}</p>
        <FormField label={t("admin.reason")}><textarea className="mid-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required /></FormField>
        {!!error && <ErrorNotice error={error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={reason.trim().length < 5 || busy}>{t("viewas.start")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
