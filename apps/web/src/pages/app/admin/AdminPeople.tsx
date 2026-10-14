import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { StatusBadge } from "../../../components/StatusBadge";
import { useRpc } from "../../../lib/api/query";
import type { OrgType } from "../../../lib/api/types";
import { formatDateTime } from "../../../lib/format";
import { OrgStatusBadge, type AdminOrg } from "./AdminOrgs";

/*
 * The operator's view of people, lenders, e-mail and their own actions (ADR 0034). Everything an operator needs to run
 * the closed pilot that the organisation pages did not show. Each look at a person is audited by the database.
 */

interface AdminUser {
  user_id: string; email: string; full_name: string | null; phone: string | null; created_at: string;
  email_confirmed_at: string | null; last_sign_in_at: string | null; identity_verified: boolean; identity_verified_at: string | null;
  identity_provider: string | null; mfa: boolean; operator_role: string | null; deleted: boolean;
  orgs: { id: string; name: string; slug: string; status: AdminOrg["status"]; types: OrgType[]; role: string }[];
}

function YesNo({ ok, yes, no }: { ok: boolean; yes?: string; no?: string }) {
  const { t } = useTranslation();
  return <StatusBadge kind={ok ? "verifierad" : "vantar"}>{ok ? yes ?? t("common.yes") : no ?? t("common.no")}</StatusBadge>;
}

/** Konton: every account, with how far it has come – e-mail confirmed, identity, two-factor, organisations. */
export function AdminUsersPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const q = useRpc<AdminUser[]>("admin_list_users", { p_query: submitted });
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.users.title")} lead={t("admin.users.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim() || null); }}>
        <FormField label={t("admin.users.search")}><input className="mid-input" value={query} onChange={(e) => setQuery(e.target.value)} /></FormField>
        <button type="submit" className="mid-knapp mid-knapp-sekundar">{t("common.search")}</button>
      </form>
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.users.title")} rows={q.data!} getKey={(u) => u.user_id} exportName="konton"
          empty={<EmptyState icon="personer" title={t("admin.users.empty")} />}
          filters={[
            { id: "confirmed", label: t("admin.users.email_confirmed"), options: [{ value: "yes", label: t("common.yes") }, { value: "no", label: t("common.no") }],
              match: (u, v) => !!u.email_confirmed_at === (v === "yes") },
            { id: "org", label: t("admin.users.has_org"), options: [{ value: "yes", label: t("common.yes") }, { value: "no", label: t("common.no") }],
              match: (u, v) => (u.orgs.length > 0) === (v === "yes") },
          ]}
          columns={[
            { id: "name", header: t("common.name"), value: (u) => `${u.full_name ?? ""} ${u.email}`, sortable: true,
              cell: (u) => <><Link className="mid-lank" to={path(`admin/users/${u.user_id}`)}><strong>{u.full_name ?? u.email}</strong></Link><br />
                <span className="t-liten t-sekundar">{u.email}</span>{u.operator_role && <> <StatusBadge kind="neutral">{t(`enum.operator_role.${u.operator_role}`)}</StatusBadge></>}</> },
            { id: "confirmed", header: t("admin.users.email_confirmed"), value: (u) => u.email_confirmed_at ?? "", cell: (u) => <YesNo ok={!!u.email_confirmed_at} /> },
            { id: "identity", header: t("admin.orgs.identity"), value: (u) => String(u.identity_verified), hideOnMobile: true,
              cell: (u) => <YesNo ok={u.identity_verified} yes={u.identity_provider === "mock" ? t("admin.users.demo_bankid") : t("common.yes")} /> },
            { id: "orgs", header: t("admin.users.orgs"), value: (u) => u.orgs.map((o) => o.name).join(", "),
              cell: (u) => u.orgs.length ? u.orgs.map((o) => <div key={o.id}><Link className="mid-lank" to={path(`admin/organizations/${o.id}`)}>{o.name}</Link> <OrgStatusBadge status={o.status} /></div>)
                : <span className="t-sekundar">{t("admin.users.no_org")}</span> },
            { id: "created", header: t("admin.users.created"), value: (u) => u.created_at, sortable: true, hideOnMobile: true, cell: (u) => formatDateTime(u.created_at) },
            { id: "last", header: t("admin.users.last_sign_in"), value: (u) => u.last_sign_in_at ?? "", sortable: true, hideOnMobile: true,
              cell: (u) => (u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "–") },
          ]} />
      )}
    </div>
  );
}

interface UserDetail {
  user: AdminUser;
  orgs: AdminUser["orgs"];
  pending_invites: { org: { id: string; name: string }; role: string; expires_at: string | null }[];
  security_events: { type: string; ua_family: string | null; created_at: string }[];
  emails: EmailRow[];
}

export function AdminUserPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { id } = useParams();
  const q = useRpc<UserDetail>("admin_get_user", { p_user_id: id });
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const { user, orgs, security_events, emails, pending_invites } = q.data!;
  return (
    <div className="stack-6">
      <PageHeader title={user.full_name ?? user.email} lead={user.email}
        crumbs={[{ to: path("admin"), label: t("nav.admin") }, { to: path("admin/users"), label: t("admin.users.title") }]} />
      <section className="panel stack-3">
        <dl className="faktarutnat">
          <div><dt>{t("admin.users.created")}</dt><dd>{formatDateTime(user.created_at)}</dd></div>
          <div><dt>{t("admin.users.email_confirmed")}</dt><dd>{user.email_confirmed_at ? formatDateTime(user.email_confirmed_at) : t("common.no")}</dd></div>
          <div><dt>{t("admin.orgs.identity")}</dt><dd>{user.identity_verified_at
            ? `${formatDateTime(user.identity_verified_at)}${user.identity_provider === "mock" ? ` · ${t("admin.users.demo_bankid")}` : ""}` : t("common.no")}</dd></div>
          <div><dt>{t("admin.users.mfa")}</dt><dd>{user.mfa ? t("common.yes") : t("common.no")}</dd></div>
          <div><dt>{t("admin.users.last_sign_in")}</dt><dd>{user.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : "–"}</dd></div>
          <div><dt>{t("common.phone")}</dt><dd>{user.phone ?? "–"}</dd></div>
        </dl>
      </section>
      <section className="stack-3">
        <h2 className="t-rubrik-4">{t("admin.users.orgs")}</h2>
        {orgs.length ? (
          <ul className="stack-1">{orgs.map((o) => (
            <li key={o.id}><Link className="mid-lank" to={path(`admin/organizations/${o.id}`)}>{o.name}</Link> <OrgStatusBadge status={o.status} />{" "}
              <span className="t-liten t-sekundar">{t(`enum.member_role.${o.role}`)} · {o.types.map((x) => t(`enum.org_type.${x}`)).join(", ")}</span></li>
          ))}</ul>
        ) : <p className="t-sekundar">{t("admin.users.no_org_lead")}</p>}
        {pending_invites.length > 0 && <p className="t-liten">{t("admin.users.invites", { orgs: pending_invites.map((i) => i.org.name).join(", ") })}</p>}
      </section>
      <section className="stack-3">
        <h2 className="t-rubrik-4">{t("admin.emails.title")}</h2>
        <EmailTable rows={emails} />
      </section>
      <section className="stack-3">
        <h2 className="t-rubrik-4">{t("admin.users.security")}</h2>
        {security_events.length ? (
          <ul className="stack-1 t-liten">{security_events.map((s, i) => (
            <li key={i}><span className="mid-id">{s.type}</span> <span className="t-sekundar">· {formatDateTime(s.created_at)}{s.ua_family ? ` · ${s.ua_family}` : ""}</span></li>
          ))}</ul>
        ) : <p className="t-sekundar">{t("admin.users.no_security")}</p>}
      </section>
    </div>
  );
}

interface Financier {
  id: string; slug: string; name: string; org_number: string | null; types: OrgType[]; status: AdminOrg["status"]; lookup_source: string | null;
  created_at: string; members: number; placeholder: boolean; active_encumbrances: number; pending_encumbrances: number; open_payoffs: number;
  last_activity_at: string | null;
}

/** Långivare: every lender – including banks named in a financing that have no account yet – with what they hold. */
export function AdminFinanciersPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const q = useRpc<Financier[]>("admin_list_financiers", {});
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.financiers.title")} lead={t("admin.financiers.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.financiers.title")} rows={q.data!} getKey={(f) => f.id} exportName="langivare"
          empty={<EmptyState icon="bank" title={t("admin.financiers.empty")} />}
          filters={[{ id: "account", label: t("admin.financiers.account"),
            options: [{ value: "yes", label: t("admin.financiers.connected") }, { value: "no", label: t("admin.financiers.placeholder") }],
            match: (f, v) => f.placeholder === (v === "no") }]}
          columns={[
            { id: "name", header: t("common.name"), value: (f) => f.name, sortable: true,
              cell: (f) => <><Link className="mid-lank" to={path(`admin/organizations/${f.id}`)}><strong>{f.name}</strong></Link><br />
                <span className="t-liten t-sekundar mid-id">{f.org_number ?? "–"}</span></> },
            { id: "status", header: t("common.status"), value: (f) => (f.placeholder ? "placeholder" : f.status),
              cell: (f) => f.placeholder ? <StatusBadge kind="neutral">{t("admin.financiers.placeholder")}</StatusBadge> : <OrgStatusBadge status={f.status} /> },
            { id: "active", header: t("admin.financiers.active"), value: (f) => f.active_encumbrances, sortable: true, cell: (f) => f.active_encumbrances },
            { id: "pending", header: t("admin.financiers.pending"), value: (f) => f.pending_encumbrances, sortable: true, cell: (f) => f.pending_encumbrances },
            { id: "payoffs", header: t("admin.financiers.payoffs"), value: (f) => f.open_payoffs, sortable: true, cell: (f) => f.open_payoffs },
            { id: "members", header: t("admin.orgs.members"), value: (f) => f.members, sortable: true, hideOnMobile: true, cell: (f) => f.members },
            { id: "last", header: t("admin.financiers.last_activity"), value: (f) => f.last_activity_at ?? "", sortable: true, hideOnMobile: true,
              cell: (f) => (f.last_activity_at ? formatDateTime(f.last_activity_at) : "–") },
          ]} />
      )}
    </div>
  );
}

interface EmailRow {
  id: string; to_email?: string; template: string; type: string | null; status: "pending" | "sent" | "failed" | "skipped";
  attempts?: number; last_error: string | null; created_at: string; sent_at: string | null;
  org?: { id: string; name: string } | null;
}
const EMAIL_KIND = { pending: "vantar", sent: "verifierad", failed: "sparr", skipped: "neutral" } as const;

function EmailTable({ rows, withRecipient = false }: { rows: EmailRow[]; withRecipient?: boolean }) {
  const { t } = useTranslation();
  return (
    <DataTable caption={t("admin.emails.title")} rows={rows} getKey={(e) => e.id} exportName="epost"
      empty={<EmptyState icon="inkorg" title={t("admin.emails.empty")} />}
      columns={[
        ...(withRecipient ? [{ id: "to", header: t("admin.emails.to"), value: (e: EmailRow) => e.to_email ?? "", sortable: true,
          cell: (e: EmailRow) => <><span>{e.to_email}</span>{e.org && <><br /><span className="t-liten t-sekundar">{e.org.name}</span></>}</> }] : []),
        { id: "what", header: t("admin.emails.what"), value: (e) => e.type ?? e.template,
          cell: (e) => <>{e.type ? t(`notifications.${e.type}.title`, { defaultValue: e.type }) : t(`admin.emails.template.${e.template}`, { defaultValue: e.template })}</> },
        { id: "status", header: t("common.status"), value: (e) => e.status,
          cell: (e) => <><StatusBadge kind={EMAIL_KIND[e.status]}>{t(`admin.emails.status.${e.status}`)}</StatusBadge>
            {e.last_error && <><br /><span className="t-liten" role="note">{e.last_error}{e.attempts ? ` (${e.attempts})` : ""}</span></>}</> },
        { id: "created", header: t("admin.emails.created"), value: (e) => e.created_at, sortable: true, cell: (e) => formatDateTime(e.created_at) },
        { id: "sent", header: t("admin.emails.sent_at"), value: (e) => e.sent_at ?? "", hideOnMobile: true, cell: (e) => (e.sent_at ? formatDateTime(e.sent_at) : "–") },
      ]} />
  );
}

/** E-postlogg: what was sent to whom, what is waiting, and what failed and why. */
export function AdminEmailLogPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const q = useRpc<{ counts: Record<EmailRow["status"], number>; items: EmailRow[] }>("admin_email_log",
    { p_status: status === "all" ? null : status, p_query: submitted }, { refetchInterval: 30_000 });
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.emails.title")} lead={t("admin.emails.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      {q.data && (
        <dl className="nyckeltal">
          {(["pending", "sent", "failed", "skipped"] as const).map((s) => <div key={s}><dt>{t(`admin.emails.status.${s}`)}</dt><dd>{q.data!.counts[s]}</dd></div>)}
        </dl>
      )}
      <Tabs label={t("admin.emails.title")} value={status} onChange={(s) => setParams({ status: s }, { replace: true })}
        tabs={(["all", "pending", "sent", "failed", "skipped"] as const).map((s) => ({ id: s, label: s === "all" ? t("common.all") : t(`admin.emails.status.${s}`) }))} />
      <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim() || null); }}>
        <FormField label={t("admin.emails.search")}><input className="mid-input" value={query} onChange={(e) => setQuery(e.target.value)} /></FormField>
        <button type="submit" className="mid-knapp mid-knapp-sekundar">{t("common.search")}</button>
      </form>
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : <EmailTable rows={q.data!.items} withRecipient />}
    </div>
  );
}

interface AuditRow { id: number; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string; operator_email: string | null; operator_name: string | null }

/** Revisionslogg: what operators have done – approvals, rejections, lookups of people, view-as sessions. */
export function AdminAuditLogPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const q = useRpc<AuditRow[]>("admin_audit_log", { p_limit: 500 });
  const link = (a: AuditRow) => a.target_type === "organization" ? path(`admin/organizations/${a.target_id}`)
    : a.target_type === "user" ? path(`admin/users/${a.target_id}`) : null;
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.audit.title")} lead={t("admin.audit.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.audit.title")} rows={q.data!} getKey={(a) => String(a.id)} exportName="revisionslogg"
          empty={<EmptyState icon="lista" title={t("admin.audit.empty")} />}
          columns={[
            { id: "when", header: t("admin.audit.when"), value: (a) => a.created_at, sortable: true, cell: (a) => formatDateTime(a.created_at) },
            { id: "who", header: t("admin.audit.who"), value: (a) => a.operator_email ?? "", cell: (a) => a.operator_name ?? a.operator_email ?? "–" },
            { id: "action", header: t("admin.audit.action"), value: (a) => a.action,
              cell: (a) => <span className="mid-id">{t(`admin.audit.actions.${a.action.replace(/\./g, "_")}`, { defaultValue: a.action })}</span> },
            { id: "target", header: t("admin.audit.target"), value: (a) => a.target_id ?? "",
              cell: (a) => { const to = link(a); return to ? <Link className="mid-lank" to={to}>{t("common.view")}</Link> : <span className="t-sekundar">–</span>; } },
            { id: "details", header: t("admin.audit.details"), value: (a) => JSON.stringify(a.details), hideOnMobile: true,
              cell: (a) => <span className="t-liten t-sekundar">{Object.entries(a.details ?? {}).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ")}</span> },
          ]} />
      )}
    </div>
  );
}
