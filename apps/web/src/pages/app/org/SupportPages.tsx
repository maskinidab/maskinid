import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { StatusBadge } from "../../../components/StatusBadge";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import type { OrgBrief } from "../../../lib/api/types";
import { formatDateTime } from "../../../lib/format";
import { SupportFields } from "../../public/InfoPages";
import { useAdmin } from "../admin/useAdmin";

export interface Ticket {
  id: string; number: number; category: string; subject: string; status: "open" | "waiting_customer" | "closed"; created_at: string; updated_at: string;
  email: string | null; machine_reg: string | null; org: OrgBrief | null; user_name: string | null; last_message_at: string | null;
  messages?: { id: string; from_operator: boolean; body: string; created_at: string; author: string | null }[];
}
const STATUS_KIND = { open: "vantar", waiting_customer: "neutral", closed: "verifierad" } as const;

export function TicketStatus({ s }: { s: Ticket["status"] }) {
  const { t } = useTranslation();
  return <StatusBadge kind={STATUS_KIND[s]}>{t(`support.status.${s}`)}</StatusBadge>;
}

/** Thread view shared by the customer and the operator. */
export function TicketThread({ id, orgId, operator }: { id: string; orgId: string | null; operator: boolean }) {
  const { t } = useTranslation();
  const q = useRpc<Ticket>("get_ticket", { p_org_id: orgId, p_ticket_id: id });
  const [body, setBody] = useState("");
  const reply = useRpcMutation<{ p_org_id: string | null; p_ticket_id: string; p_body: string }>("add_ticket_message", { onSuccess: () => setBody("") });
  const status = useRpcMutation<{ p_org_id: string | null; p_ticket_id: string; p_status: string }>("set_ticket_status");
  if (q.isLoading) return <Skeleton lines={5} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const tk = q.data!;
  return (
    <section className="panel stack-4">
      <div className="mid-rad mid-rad-mellan">
        <h2 className="t-rubrik-4">#{tk.number} {tk.subject}</h2>
        <TicketStatus s={tk.status} />
      </div>
      <p className="t-liten t-sekundar">{[t(`support.categories.${tk.category}`), tk.org?.name, tk.user_name ?? tk.email, formatDateTime(tk.created_at)].filter(Boolean).join(" · ")}</p>
      <ol className="trad">
        {tk.messages?.map((m) => (
          <li key={m.id} className={m.from_operator ? "fran-support" : undefined}>
            <p className="t-liten t-sekundar">{m.author ?? "–"} · {formatDateTime(m.created_at)}</p>
            <p className="trad-text">{m.body}</p>
          </li>
        ))}
      </ol>
      {tk.status !== "closed" && (
        <form className="stack-3" onSubmit={(e) => { e.preventDefault(); if (body.trim()) reply.mutate({ p_org_id: orgId, p_ticket_id: tk.id, p_body: body }); }}>
          <FormField label={t("support.reply")}><textarea className="mid-input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></FormField>
          {(reply.error || status.error) && <ErrorNotice error={reply.error ?? status.error} />}
          <div className="mid-rad">
            <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!body.trim() || reply.isPending}>{t("support.send")}</button>
            <button type="button" className="mid-knapp mid-knapp-text" onClick={() => status.mutate({ p_org_id: orgId, p_ticket_id: tk.id, p_status: "closed" })}>{t("support.close")}</button>
          </div>
        </form>
      )}
      {tk.status === "closed" && operator && (
        <div><button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => status.mutate({ p_org_id: orgId, p_ticket_id: tk.id, p_status: "open" })}>{t("support.reopen")}</button></div>
      )}
    </section>
  );
}

/** Support in the app: the organisation's tickets and a new-ticket form. */
export function SupportPage() {
  const { t } = useTranslation();
  const { orgId, viewAs } = useOrg();
  const [params, setParams] = useSearchParams();
  const open = params.get("ticket");
  const q = useRpc<Ticket[]>("list_my_tickets", { p_org_id: orgId });
  const [d, setD] = useState({ category: "other", subject: "", body: "", machine_reg: "" });
  const [error, setError] = useState<unknown>(null);
  async function create() {
    setError(null);
    try {
      const tk = await rpc<Ticket>("create_support_ticket", { p_org_id: orgId, p_category: d.category, p_subject: d.subject, p_body: d.body, p_machine_reg: d.machine_reg || null });
      setD({ category: "other", subject: "", body: "", machine_reg: "" });
      setParams({ ticket: tk.id });
      await q.refetch();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.support")} lead={t("support.lead")} actions={<Link className="mid-knapp mid-knapp-kontur" to="/help"><Icon name="info" />{t("nav.help")}</Link>} />
      {open && <TicketThread id={open} orgId={orgId} operator={false} />}
      {q.isLoading ? <Skeleton lines={3} /> : !!q.data?.length && (
        <ul className="radlista">
          {q.data.map((tk) => (
            <li key={tk.id}>
              <button type="button" className="mid-knapp-text radlista-knapp" onClick={() => setParams({ ticket: tk.id })}>
                <strong>#{tk.number} {tk.subject}</strong><br /><span className="t-liten t-sekundar">{formatDateTime(tk.last_message_at ?? tk.updated_at)}</span>
              </button>
              <TicketStatus s={tk.status} />
            </li>
          ))}
        </ul>
      )}
      {!viewAs && (
        <form className="panel stack-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <h2 className="t-rubrik-4">{t("support.new")}</h2>
          <SupportFields<typeof d> d={d} setD={setD} />
          <FormField label={t("machines.col_reg")} optional><input className="mid-input is-id" value={d.machine_reg} onChange={(e) => setD({ ...d, machine_reg: e.target.value })} /></FormField>
          {!!error && <ErrorNotice error={error} />}
          <div><button type="submit" className="mid-knapp mid-knapp-primar">{t("support.send")}</button></div>
        </form>
      )}
    </div>
  );
}

/** Operator: support tickets queue with thread. */
export function AdminTicketsPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const open = params.get("ticket");
  const q = useRpc<Ticket[]>("admin_list_tickets", { p_status: status === "all" ? null : status });
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.tickets.title")} lead={t("admin.tickets.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      {open && <TicketThread id={open} orgId={null} operator />}
      <Tabs label={t("admin.tickets.title")} value={status} onChange={(s) => setParams({ status: s }, { replace: true })}
        tabs={["open", "waiting_customer", "closed", "all"].map((s) => ({ id: s, label: s === "all" ? t("common.all") : s === "waiting_customer" ? t("support.status_waiting_customer_admin") : t(`support.status.${s}`) }))} />
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.tickets.title")} rows={q.data!} getKey={(x) => x.id} exportName="supportarenden"
          empty={<EmptyState icon="bock" title={t("admin.tickets.empty")} />}
          columns={[
            { id: "n", header: "#", value: (x) => x.number, sortable: true, cell: (x) => <span className="mid-id">{x.number}</span> },
            { id: "subject", header: t("support.subject"), value: (x) => x.subject,
              cell: (x) => <button type="button" className="mid-knapp-text radlista-knapp" onClick={() => setParams({ status, ticket: x.id })}><strong>{x.subject}</strong><br />
                <span className="t-liten t-sekundar">{t(`support.categories.${x.category}`)}</span></button> },
            { id: "from", header: t("admin.tickets.from"), value: (x) => x.org?.name ?? x.email ?? "", cell: (x) => <>{x.org?.name ?? x.email}<br /><span className="t-liten t-sekundar">{x.user_name ?? ""}</span></> },
            { id: "machine", header: t("machines.col_reg"), value: (x) => x.machine_reg ?? "", hideOnMobile: true, cell: (x) => (x.machine_reg ? <RegNumber value={x.machine_reg} /> : "–") },
            { id: "updated", header: t("admin.api.last"), value: (x) => x.updated_at, sortable: true, cell: (x) => formatDateTime(x.last_message_at ?? x.updated_at) },
            { id: "status", header: t("common.status"), value: (x) => x.status, cell: (x) => <TicketStatus s={x.status} /> },
          ]} />
      )}
    </div>
  );
}

interface Tip {
  id: string; kind: string; reg_or_serial: string | null; message: string; location: { city?: string } | null; listing_url: string | null; contact: string | null;
  status: string; review_note: string | null; created_at: string; machine: { id: string; reg_number: string; make: string; model: string; status: string } | null;
}

/** Operator: tips from the public. Forwarding sends the tip to the police that flagged the machine. */
export function AdminTipsPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { atLeast } = useAdmin();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "new";
  const q = useRpc<Tip[]>("admin_list_tips", { p_status: status === "all" ? null : status });
  const review = useRpcMutation<{ p_tip_id: string; p_status: string; p_note?: string }>("admin_review_tip");
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.tips.title")} lead={t("admin.tips.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      <Tabs label={t("admin.tips.title")} value={status} onChange={(s) => setParams({ status: s }, { replace: true })}
        tabs={["new", "forwarded", "closed", "all"].map((s) => ({ id: s, label: s === "all" ? t("common.all") : t(`admin.tips.status.${s}`) }))} />
      {review.error && <ErrorNotice error={review.error} />}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : !q.data?.length ? <EmptyState icon="bock" title={t("admin.tips.empty")} /> : (
        <ul className="stack-3">
          {q.data.map((tp) => (
            <li key={tp.id} className="panel stack-2">
              <div className="mid-rad mid-rad-mellan">
                <strong>{t(`tips.kind.${tp.kind}`)}</strong>
                <span className="t-liten t-sekundar">{formatDateTime(tp.created_at)}{tp.location?.city ? ` · ${tp.location.city}` : ""}</span>
              </div>
              {tp.machine ? <p><Link to={path(`machines/${tp.machine.id}`)}><RegNumber value={tp.machine.reg_number} /></Link> {tp.machine.make} {tp.machine.model}
                {tp.machine.status === "stolen" && <> <StatusBadge kind="sparr">{t("enum.machine_status.stolen")}</StatusBadge></>}</p>
                : tp.reg_or_serial ? <p className="mid-id">{tp.reg_or_serial} <span className="t-liten t-sekundar">({t("admin.tips.no_match")})</span></p> : null}
              <p className="trad-text">{tp.message}</p>
              {tp.listing_url && <p><a className="mid-lank" href={tp.listing_url} target="_blank" rel="noopener noreferrer nofollow">{tp.listing_url}</a></p>}
              {tp.contact && <p className="t-liten">{t("admin.tips.contact", { contact: tp.contact })}</p>}
              {tp.status === "new" && atLeast("verifier") && (
                <div className="mid-rad">
                  {tp.machine && <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" onClick={() => review.mutate({ p_tip_id: tp.id, p_status: "forwarded" })}>{t("admin.tips.forward")}</button>}
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => review.mutate({ p_tip_id: tp.id, p_status: "closed" })}>{t("admin.tips.close")}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Operator (superadmin): publish a new version of a legal document; required versions must be accepted by all users. */
export function AdminLegalPage() {
  const { t, i18n } = useTranslation();
  const { path } = useOrg();
  const { atLeast } = useAdmin();
  const list = useRpc<{ key: string; version: number; title: string; published_at: string; requires_acceptance: boolean }[]>("list_legal_documents",
    { p_locale: i18n.language.startsWith("en") ? "en" : "sv" });
  const [d, setD] = useState({ key: "terms", title_sv: "", body_sv: "", title_en: "", body_en: "", requires: true });
  const publish = useRpcMutation<Record<string, unknown>, { version: number }>("admin_publish_legal");
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.legal.title")} lead={t("admin.legal.lead")} crumbs={[{ to: path("admin"), label: t("nav.admin") }]} />
      <ul className="radlista">
        {list.data?.map((x) => (
          <li key={x.key}><span><Link className="mid-lank" to={`/legal/${x.key}`}>{x.title}</Link><br />
            <span className="t-liten t-sekundar">{t("legal.version", { version: x.version, date: formatDateTime(x.published_at) })}{x.requires_acceptance ? ` · ${t("admin.legal.requires")}` : ""}</span></span></li>
        ))}
      </ul>
      {atLeast("superadmin") ? (
        <form className="panel stack-4" onSubmit={(e) => { e.preventDefault(); publish.mutate({ p_key: d.key, p_title_sv: d.title_sv, p_body_sv: d.body_sv,
          p_title_en: d.title_en || null, p_body_en: d.body_en || null, p_requires_acceptance: d.requires }); }}>
          <h2 className="t-rubrik-4">{t("admin.legal.new_version")}</h2>
          <FormField label={t("admin.legal.document")}>
            <select className="mid-select" value={d.key} onChange={(e) => setD({ ...d, key: e.target.value })}>
              {["terms", "privacy", "dpa", "cookies"].map((k) => <option key={k} value={k}>{t(`legal.keys.${k}`)}</option>)}
            </select>
          </FormField>
          <FormField label={t("admin.legal.title_sv")}><input className="mid-input" value={d.title_sv} onChange={(e) => setD({ ...d, title_sv: e.target.value })} required /></FormField>
          <FormField label={t("admin.legal.body_sv")}><textarea className="mid-input" rows={10} value={d.body_sv} onChange={(e) => setD({ ...d, body_sv: e.target.value })} required /></FormField>
          <FormField label={t("admin.legal.title_en")} optional><input className="mid-input" value={d.title_en} onChange={(e) => setD({ ...d, title_en: e.target.value })} /></FormField>
          <FormField label={t("admin.legal.body_en")} optional><textarea className="mid-input" rows={10} value={d.body_en} onChange={(e) => setD({ ...d, body_en: e.target.value })} /></FormField>
          <label className="mid-kryss"><input type="checkbox" checked={d.requires} onChange={(e) => setD({ ...d, requires: e.target.checked })} />{t("admin.legal.requires_hint")}</label>
          {publish.error && <ErrorNotice error={publish.error} />}
          {publish.data && <Notice kind="ok" title={t("admin.legal.published", { version: publish.data.version })} />}
          <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={publish.isPending}>{t("admin.legal.publish")}</button></div>
        </form>
      ) : <Notice kind="info" title={t("admin.flags.read_only")} />}
    </div>
  );
}
