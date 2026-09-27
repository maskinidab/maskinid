import { APP_BASE_URL } from "@maskinid/shared/config.ts";
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
import { formatDate, formatDateTime, formatNumber } from "../../../lib/format";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { OrgStatusBadge, type AdminOrg } from "./AdminOrgs";
import { useAdmin } from "./useAdmin";

function useCrumbs() {
  const { t } = useTranslation();
  const { path } = useOrg();
  return [{ to: path("admin"), label: t("nav.admin") }];
}

// ---------- Label batches ----------
interface Batch {
  id: string; quantity: number; status: "ordered" | "printed" | "shipped" | "cancelled"; medium: string; created_at: string; printed_at: string | null;
  printer_ref: string | null; shipping_address: Record<string, string> | null; assigned_org: OrgBrief | null; ordered_by: OrgBrief | null; bound: number;
}

/** Label batches (SPEC §5): orders from dealers are printed here; the print file holds the codes and their URLs. */
export function AdminLabelsPage() {
  const { t } = useTranslation();
  const crumbs = useCrumbs();
  const { atLeast } = useAdmin();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "ordered";
  const q = useRpc<Batch[]>("admin_list_label_batches", { p_status: status === "all" ? null : status });
  const print = useRpcMutation<{ p_batch_id: string; p_printer_ref: string | null }>("print_label_batch");
  const setStatus = useRpcMutation<{ p_batch_id: string; p_status: string }>("admin_set_label_batch_status");
  const [error, setError] = useState<unknown>(null);
  async function printFile(b: Batch) {
    setError(null);
    try {
      const codes = await rpc<string[]>("admin_label_batch_codes", { p_batch_id: b.id });
      const csv = "code,url\n" + codes.map((c) => `${c},${APP_BASE_URL}/m/${c}`).join("\n") + "\n";
      downloadBytes(new TextEncoder().encode(csv), `markesbatch-${b.id.slice(0, 8)}.csv`, "text/csv");
    } catch (e) {
      setError(e);
    }
  }
  const err = error ?? print.error ?? setStatus.error;
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.labels.title")} lead={t("admin.labels.lead")} crumbs={crumbs} />
      <Tabs label={t("admin.labels.title")} value={status} onChange={(s) => setParams({ status: s }, { replace: true })}
        tabs={["ordered", "printed", "shipped", "cancelled", "all"].map((s) => ({ id: s, label: s === "all" ? t("common.all") : t(`enum.label_batch_status.${s}`) }))} />
      {!!err && <ErrorNotice error={err} />}
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.labels.title")} rows={q.data!} getKey={(b) => b.id} exportName="markesbatcher"
          empty={<EmptyState icon="qr" title={t("admin.labels.empty")} />}
          columns={[
            { id: "org", header: t("admin.labels.org"), value: (b) => b.ordered_by?.name ?? b.assigned_org?.name ?? "",
              cell: (b) => <><strong>{b.ordered_by?.name ?? b.assigned_org?.name ?? t("admin.labels.unassigned")}</strong><br /><span className="t-liten t-sekundar">{formatDateTime(b.created_at)}</span></> },
            { id: "qty", header: t("admin.labels.quantity"), value: (b) => b.quantity, sortable: true,
              cell: (b) => <>{formatNumber(b.quantity)}{b.bound ? <span className="t-liten t-sekundar"> · {t("admin.labels.bound", { count: b.bound })}</span> : null}</> },
            { id: "address", header: t("admin.labels.address"), value: (b) => Object.values(b.shipping_address ?? {}).join(", "), hideOnMobile: true, cell: (b) => Object.values(b.shipping_address ?? {}).join(", ") || "–" },
            { id: "status", header: t("common.status"), value: (b) => b.status,
              cell: (b) => <>{t(`enum.label_batch_status.${b.status}`)}{b.printer_ref ? <><br /><span className="t-liten t-sekundar">{b.printer_ref}</span></> : null}</> },
            { id: "action", header: "", value: () => "", cell: (b) => atLeast("superadmin") && (
              <div className="mid-rad">
                {b.status === "ordered" && <>
                  <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" disabled={print.isPending}
                    onClick={() => print.mutate({ p_batch_id: b.id, p_printer_ref: null })}>{t("admin.labels.print")}</button>
                  <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setStatus.mutate({ p_batch_id: b.id, p_status: "cancelled" })}>{t("common.cancel")}</button>
                </>}
                {(b.status === "printed" || b.status === "shipped") && (
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void printFile(b)}><Icon name="nedladdning" />{t("admin.labels.print_file")}</button>
                )}
                {b.status === "printed" && (
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => setStatus.mutate({ p_batch_id: b.id, p_status: "shipped" })}>{t("admin.labels.mark_shipped")}</button>
                )}
              </div>
            ) },
          ]} />
      )}
    </div>
  );
}

// ---------- Event explorer + anchors ----------
interface Ev { seq: number; type: string; machine_id: string | null; org_id: string | null; actor_type: string; actor_org_id: string | null; payload: Record<string, unknown>; hash: string; prev_hash: string | null; created_at: string }
interface Anchor { day: string; first_seq: number | null; last_seq: number; event_count: number; root_hash: string; published_at: string | null; external_ref: string | null }

/** Event log explorer (SPEC §11.4): filter the hash chain, verify it, and verify daily anchors against the log. */
export function AdminEventsPage() {
  const { t } = useTranslation();
  const crumbs = useCrumbs();
  const { path } = useOrg();
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState(params.get("type") ?? "");
  const filters = { p_type: params.get("type") || null, p_org_id: params.get("org") || null, p_machine_id: params.get("machine") || null, p_limit: 200 };
  const q = useRpc<Ev[]>("admin_list_events", filters);
  const anchors = useRpc<Anchor[]>("list_event_anchors", { p_limit: 14 });
  const [chain, setChain] = useState<{ ok: boolean; checked: number; bad_seq?: number; reason?: string } | null>(null);
  const [anchorResult, setAnchorResult] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null);
  async function verifyChain() {
    setError(null);
    try { setChain(await rpc("admin_verify_chain", {})); } catch (e) { setError(e); }
  }
  async function verifyAnchor(day: string) {
    try {
      const r = await rpc<{ ok: boolean }>("verify_anchor", { p_day: day });
      setAnchorResult((x) => ({ ...x, [day]: r.ok }));
    } catch (e) { setError(e); }
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.events.title")} lead={t("admin.events.lead")} crumbs={crumbs}
        actions={<button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => void verifyChain()}><Icon name="skold" />{t("admin.events.verify_chain")}</button>} />
      {!!error && <ErrorNotice error={error} />}
      {chain && (chain.ok
        ? <Notice kind="ok" title={t("admin.events.chain_ok", { count: chain.checked })} />
        : <Notice kind="fel" title={t("admin.events.chain_broken", { seq: chain.bad_seq, reason: chain.reason })} />)}
      <section className="stack-3">
        <h2 className="t-rubrik-4">{t("admin.events.anchors")}</h2>
        {anchors.data && (anchors.data.length === 0 ? <p className="t-liten t-sekundar">{t("admin.events.no_anchors")}</p> : (
          <ul className="radlista">
            {anchors.data.map((a) => (
              <li key={a.day}>
                <span><strong>{formatDate(a.day)}</strong> · {t("admin.events.anchor_events", { count: a.event_count })}
                  <br /><span className="mid-id t-liten">{a.root_hash.slice(0, 24)}…</span>
                  {a.external_ref && <> · <a className="mid-lank t-liten" href={a.external_ref} target="_blank" rel="noopener noreferrer">{t("admin.events.published")}</a></>}</span>
                {anchorResult[a.day] === undefined
                  ? <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => void verifyAnchor(a.day)}>{t("admin.events.verify_anchor")}</button>
                  : <StatusBadge kind={anchorResult[a.day] ? "verifierad" : "sparr"}>{anchorResult[a.day] ? t("admin.events.anchor_ok") : t("admin.events.anchor_bad")}</StatusBadge>}
              </li>
            ))}
          </ul>
        ))}
      </section>
      <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); const p = new URLSearchParams(params); if (type.trim()) p.set("type", type.trim()); else p.delete("type"); setParams(p); }}>
        <FormField label={t("admin.events.type_filter")} hint={t("admin.events.type_hint")}><input className="mid-input is-id" value={type} onChange={(e) => setType(e.target.value)} /></FormField>
        <button type="submit" className="mid-knapp mid-knapp-sekundar">{t("common.search")}</button>
        {(params.get("org") || params.get("machine")) && <button type="button" className="mid-knapp mid-knapp-text" onClick={() => setParams({})}>{t("admin.events.clear")}</button>}
      </form>
      {q.isLoading ? <Skeleton lines={8} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("admin.events.title")} rows={q.data!} getKey={(e) => String(e.seq)} exportName="handelser"
          columns={[
            { id: "seq", header: "#", value: (e) => e.seq, sortable: true, cell: (e) => <span className="mid-id">{e.seq}</span> },
            { id: "type", header: t("common.type"), value: (e) => e.type, cell: (e) => <><strong className="mid-id">{e.type}</strong><br /><span className="t-liten t-sekundar">{formatDateTime(e.created_at)} · {e.actor_type}</span></> },
            { id: "machine", header: t("machines.col_machine"), value: (e) => e.machine_id ?? "", hideOnMobile: true,
              cell: (e) => (e.machine_id ? <Link className="mid-lank" to={path(`admin/events?machine=${e.machine_id}`)}>{e.machine_id.slice(0, 8)}</Link> : "–") },
            { id: "payload", header: t("admin.events.payload"), value: (e) => JSON.stringify(e.payload), hideOnMobile: true,
              cell: (e) => <code className="t-liten">{JSON.stringify(e.payload).slice(0, 120)}</code> },
            { id: "hash", header: t("admin.events.hash"), value: (e) => e.hash, hideOnMobile: true, cell: (e) => <span className="mid-id t-liten">{e.hash.slice(0, 12)}…</span> },
          ]} />
      )}
    </div>
  );
}

// ---------- Market dashboard (SPEC §8.5) ----------
interface Source { id: string; key: string; name: string; enabled: boolean; tos_status: string; connector: string; last_run_at: string | null; last_run_status: string | null; notes: string | null; config: Record<string, unknown> }
interface Run { id: string; source: string; started_at: string; finished_at: string | null; status: string; fetched: number; new: number; matched: number; alerts: number; error: string | null }
interface MarketAlert {
  id: string; type: string; status: string; created_at: string; details: Record<string, unknown>; machine_id: string | null;
  reg_number: string | null; make: string | null; model: string | null;
  observations: { id: string; url: string | null; source: string; seller: string | null; active: boolean }[] | null;
}

export function AdminMarketPage() {
  const { t } = useTranslation();
  const crumbs = useCrumbs();
  const { path } = useOrg();
  const { atLeast } = useAdmin();
  const [tab, setTab] = useState<"alerts" | "sources" | "runs">("alerts");
  const q = useRpc<{ sources: Source[]; runs: Run[]; volume: { source: string; active: number; matched: number; with_serial: number; private: number }[]; alerts_open: Record<string, number> }>("admin_market_overview", {});
  const alerts = useRpc<MarketAlert[]>("list_market_alerts", { p_status: "open" });
  const setSource = useRpcMutation<{ p_source_id: string; p_enabled: boolean; p_tos_status?: string }>("set_market_source");
  const review = useRpcMutation<{ p_alert_id: string; p_status: string }>("review_market_alert");
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const d = q.data!;
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.market.title")} lead={t("admin.market.lead")} crumbs={crumbs} />
      <dl className="nyckeltal">
        {d.volume.map((v) => <div key={v.source}><dt>{v.source}</dt><dd>{formatNumber(v.active)}</dd><dd className="nyckeltal-not">{t("admin.market.volume", { matched: v.matched, serial: v.with_serial })}</dd></div>)}
        <div><dt>{t("admin.market.alerts_open")}</dt><dd>{Object.values(d.alerts_open).reduce((a, b) => a + b, 0)}</dd></div>
      </dl>
      <Tabs label={t("admin.market.title")} value={tab} onChange={(v) => setTab(v as typeof tab)}
        tabs={[{ id: "alerts", label: t("admin.market.alerts") }, { id: "sources", label: t("admin.market.sources") }, { id: "runs", label: t("admin.market.runs") }]} />
      {(setSource.error || review.error) && <ErrorNotice error={setSource.error ?? review.error} />}
      {tab === "alerts" && (alerts.isLoading ? <Skeleton /> : (
        <DataTable caption={t("admin.market.alerts")} rows={alerts.data ?? []} getKey={(a) => a.id} exportName="marknadslarm"
          empty={<EmptyState icon="bock" title={t("admin.market.no_alerts")} />}
          columns={[
            { id: "type", header: t("common.type"), value: (a) => a.type, cell: (a) => <><strong>{t(`enum.market_alert_type.${a.type}`)}</strong><br /><span className="t-liten t-sekundar">{formatDateTime(a.created_at)}</span></> },
            { id: "machine", header: t("machines.col_machine"), value: (a) => a.reg_number ?? String(a.details.serial ?? ""),
              cell: (a) => (a.machine_id && a.reg_number
                ? <><Link to={path(`machines/${a.machine_id}`)}><RegNumber value={a.reg_number} /></Link><br /><span className="t-liten">{a.make} {a.model}</span></>
                : <span className="mid-id">{String(a.details.serial ?? "–")}</span>) },
            { id: "listing", header: t("admin.market.listing"), value: (a) => (a.observations ?? []).map((o) => o.url).join(" "), hideOnMobile: true,
              cell: (a) => (a.observations ?? []).map((o) => (
                <div key={o.id} className="t-liten">{o.url ? <a className="mid-lank" href={o.url} target="_blank" rel="noopener noreferrer nofollow">{o.source}</a> : o.source}
                  {o.seller ? ` · ${o.seller}` : ""}{o.active ? "" : ` · ${t("admin.market.inactive")}`}</div>
              )) },
            { id: "action", header: "", value: () => "", cell: (a) => atLeast("verifier") && (
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => review.mutate({ p_alert_id: a.id, p_status: "reviewed" })}>{t("enum.market_alert_status.reviewed")}</button>
                <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => review.mutate({ p_alert_id: a.id, p_status: "dismissed" })}>{t("admin.market.dismiss")}</button>
                <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => review.mutate({ p_alert_id: a.id, p_status: "escalated" })}>{t("admin.market.escalate")}</button>
              </div>
            ) },
          ]} />
      ))}
      {tab === "sources" && (
        <DataTable caption={t("admin.market.sources")} rows={d.sources} getKey={(s) => s.id}
          columns={[
            { id: "name", header: t("common.name"), value: (s) => s.name, cell: (s) => <><strong>{s.name}</strong><br /><span className="t-liten t-sekundar mid-id">{s.connector}</span></> },
            { id: "tos", header: t("admin.market.tos"), value: (s) => s.tos_status, cell: (s) => t(`enum.market_tos_status.${s.tos_status}`) },
            { id: "last", header: t("admin.market.last_run"), value: (s) => s.last_run_at ?? "", cell: (s) => (s.last_run_at ? `${formatDateTime(s.last_run_at)} · ${s.last_run_status}` : "–") },
            { id: "enabled", header: t("admin.market.enabled"), value: (s) => String(s.enabled), cell: (s) => (
              <label className="mid-kryss">
                <input type="checkbox" checked={s.enabled} disabled={!atLeast("superadmin") || s.tos_status === "restricted" || setSource.isPending}
                  onChange={(e) => setSource.mutate({ p_source_id: s.id, p_enabled: e.target.checked })} />
                {s.enabled ? t("admin.market.on") : t("admin.market.off")}
              </label>
            ) },
            { id: "notes", header: t("admin.note"), value: (s) => s.notes ?? "", hideOnMobile: true, cell: (s) => s.notes ?? "" },
          ]} />
      )}
      {tab === "sources" && <p className="t-liten t-sekundar">{t("admin.market.tos_hint")}</p>}
      {tab === "runs" && (
        <DataTable caption={t("admin.market.runs")} rows={d.runs} getKey={(r) => r.id} exportName="korningar"
          empty={<EmptyState icon="tid" title={t("admin.market.no_runs")} />}
          columns={[
            { id: "source", header: t("admin.market.source"), value: (r) => r.source, cell: (r) => <><strong>{r.source}</strong><br /><span className="t-liten t-sekundar">{formatDateTime(r.started_at)}</span></> },
            { id: "status", header: t("common.status"), value: (r) => r.status,
              cell: (r) => <StatusBadge kind={r.status === "ok" ? "verifierad" : r.status === "error" ? "sparr" : "vantar"}>{t(`admin.market.run_status.${r.status}`)}</StatusBadge> },
            { id: "counts", header: t("admin.market.counts"), value: (r) => r.fetched, cell: (r) => t("admin.market.run_counts", { fetched: r.fetched, new: r.new, matched: r.matched, alerts: r.alerts }) },
            { id: "error", header: t("admin.market.error"), value: (r) => r.error ?? "", hideOnMobile: true, cell: (r) => r.error ?? "" },
          ]} />
      )}
    </div>
  );
}

// ---------- API usage ----------
export function AdminApiPage() {
  const { t } = useTranslation();
  const crumbs = useCrumbs();
  const [days, setDays] = useState("30");
  const q = useRpc<{
    per_org: { org: OrgBrief | null; requests: number; errors: number; rate_limited: number; p95_ms: number | null; last_at: string }[];
    per_day: { day: string; requests: number; errors: number }[];
    top_endpoints: { endpoint: string; requests: number }[];
    webhooks: { delivered: number; pending: number; failed: number };
  }>("admin_api_usage", { p_days: Number(days) });
  const max = Math.max(1, ...(q.data?.per_day.map((d) => d.requests) ?? [1]));
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.api.title")} lead={t("admin.api.lead")} crumbs={crumbs} />
      <Tabs label={t("admin.api.period")} value={days} onChange={setDays} tabs={["1", "7", "30", "90"].map((d) => ({ id: d, label: t("admin.api.days", { count: Number(d) }) }))} />
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <>
          <dl className="nyckeltal">
            <div><dt>{t("admin.api.requests")}</dt><dd>{formatNumber(q.data!.per_day.reduce((a, d) => a + d.requests, 0))}</dd></div>
            <div><dt>{t("admin.api.errors")}</dt><dd>{formatNumber(q.data!.per_day.reduce((a, d) => a + d.errors, 0))}</dd></div>
            <div><dt>{t("admin.api.webhooks_delivered")}</dt><dd>{formatNumber(q.data!.webhooks.delivered)}</dd></div>
            <div><dt>{t("admin.api.webhooks_failed")}</dt><dd>{formatNumber(q.data!.webhooks.failed)}</dd></div>
          </dl>
          {q.data!.per_day.length > 0 && (
            <figure className="stapeldiagram" aria-label={t("admin.api.per_day")}>
              {q.data!.per_day.map((d) => (
                <div key={d.day} title={`${formatDate(d.day)}: ${d.requests}`} style={{ height: `${Math.max(4, (d.requests / max) * 100)}%` }} />
              ))}
            </figure>
          )}
          <DataTable caption={t("admin.api.per_org")} rows={q.data!.per_org} getKey={(r) => r.org?.id ?? "none"} exportName="api-anvandning"
            empty={<EmptyState icon="diagram" title={t("admin.api.empty")} />}
            columns={[
              { id: "org", header: t("admin.labels.org"), value: (r) => r.org?.name ?? "–", sortable: true, cell: (r) => r.org?.name ?? "–" },
              { id: "requests", header: t("admin.api.requests"), value: (r) => r.requests, sortable: true, cell: (r) => formatNumber(r.requests) },
              { id: "errors", header: t("admin.api.errors"), value: (r) => r.errors, sortable: true,
                cell: (r) => <>{formatNumber(r.errors)}{r.rate_limited ? <span className="t-liten t-sekundar"> · {t("admin.api.rate_limited", { count: r.rate_limited })}</span> : null}</> },
              { id: "p95", header: "p95", value: (r) => r.p95_ms ?? 0, sortable: true, hideOnMobile: true, cell: (r) => (r.p95_ms === null ? "–" : `${r.p95_ms} ms`) },
              { id: "last", header: t("admin.api.last"), value: (r) => r.last_at, hideOnMobile: true, cell: (r) => formatDateTime(r.last_at) },
            ]} />
          <section className="stack-2">
            <h2 className="t-rubrik-4">{t("admin.api.top_endpoints")}</h2>
            <ul className="radlista">{q.data!.top_endpoints.map((e) => <li key={e.endpoint}><span className="mid-id">{e.endpoint}</span><span>{formatNumber(e.requests)}</span></li>)}</ul>
          </section>
        </>
      )}
    </div>
  );
}

// ---------- Support search ----------
interface SupportResult {
  orgs: (Pick<AdminOrg, "id" | "name" | "org_number" | "status" | "types" | "city">)[];
  users: { user_id: string; name: string | null; email: string | null; identity_verified: boolean; deleted: boolean; orgs: { id: string; name: string; role: string; status: string }[] }[];
  machines: { id: string; reg_number: string; make: string; model: string; year: number | null; status: string; owner: OrgBrief | null }[];
}

export function AdminSupportPage() {
  const { t } = useTranslation();
  const crumbs = useCrumbs();
  const { path } = useOrg();
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const q = useRpc<SupportResult>("admin_support_search", query ? { p_query: query } : null);
  const r = q.data;
  const nothing = r && !r.orgs.length && !r.users.length && !r.machines.length;
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.support.title")} lead={t("admin.support.lead")} crumbs={crumbs} />
      <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); if (value.trim().length >= 3) setQuery(value.trim()); }}>
        <FormField label={t("admin.support.query")} hint={t("admin.support.hint")}><input className="mid-input" value={value} onChange={(e) => setValue(e.target.value)} minLength={3} /></FormField>
        <button type="submit" className="mid-knapp mid-knapp-primar" disabled={value.trim().length < 3}><Icon name="sok" />{t("common.search")}</button>
      </form>
      <p className="t-liten t-sekundar"><Icon name="info" className="ikon-inline" /> {t("admin.support.logged")}</p>
      {q.isLoading && <Skeleton />}
      {q.error && <ErrorNotice error={q.error} />}
      {nothing && <EmptyState icon="sok" title={t("admin.support.nothing")} />}
      {r && r.machines.length > 0 && (
        <section className="stack-2"><h2 className="t-rubrik-4">{t("nav.machines")}</h2>
          <ul className="radlista">{r.machines.map((m) => (
            <li key={m.id}><Link to={path(`machines/${m.id}`)}><RegNumber value={m.reg_number} /> <strong>{m.make} {m.model}</strong>{m.year ? ` · ${m.year}` : ""}</Link>
              <span className="t-liten">{t(`enum.machine_status.${m.status}`)} · {m.owner?.name ?? "–"}</span></li>
          ))}</ul>
        </section>
      )}
      {r && r.orgs.length > 0 && (
        <section className="stack-2"><h2 className="t-rubrik-4">{t("admin.orgs.title")}</h2>
          <ul className="radlista">{r.orgs.map((o) => (
            <li key={o.id}><Link to={path(`admin/organizations/${o.id}`)}><strong>{o.name}</strong> <span className="mid-id t-liten">{o.org_number ?? ""}</span></Link>
              <OrgStatusBadge status={o.status} /></li>
          ))}</ul>
        </section>
      )}
      {r && r.users.length > 0 && (
        <section className="stack-2"><h2 className="t-rubrik-4">{t("admin.support.users")}</h2>
          <ul className="radlista">{r.users.map((u) => (
            <li key={u.user_id}><span><strong>{u.name ?? "–"}</strong> <span className="t-liten t-sekundar">{u.email}</span>
              <br /><span className="t-liten">{u.orgs.map((o) => `${o.name} (${t(`enum.member_role.${o.role}`)})`).join(", ") || t("admin.support.no_orgs")}</span></span>
              <span className="t-liten">{u.identity_verified ? t("admin.support.bankid_yes") : t("admin.support.bankid_no")}</span></li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

// ---------- Feature flags ----------
interface ConfigRow { key: string; value: unknown; is_public: boolean; description: string | null; updated_at: string; updated_by: string | null }

export function AdminFlagsPage() {
  const { t } = useTranslation();
  const crumbs = useCrumbs();
  const { atLeast } = useAdmin();
  const q = useRpc<ConfigRow[]>("admin_list_config", {});
  const set = useRpcMutation<{ p_key: string; p_value: unknown }>("admin_set_config");
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.flags.title")} lead={t("admin.flags.lead")} crumbs={crumbs} />
      {!atLeast("superadmin") && <Notice kind="info" title={t("admin.flags.read_only")} />}
      {set.error && <ErrorNotice error={set.error} />}
      {q.isLoading ? <Skeleton lines={8} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <ul className="radlista">
          {q.data!.map((c) => (
            <li key={c.key}>
              <span><strong className="mid-id">{c.key}</strong><br /><span className="t-liten t-sekundar">{t(`admin.flags.desc.${c.key}`, { defaultValue: c.description ?? "" })}</span>
                {c.updated_by && <><br /><span className="t-liten t-sekundar">{t("admin.flags.changed", { who: c.updated_by, at: formatDateTime(c.updated_at) })}</span></>}</span>
              {typeof c.value === "boolean" ? (
                <label className="mid-kryss">
                  <input type="checkbox" role="switch" checked={c.value} disabled={!atLeast("superadmin") || set.isPending}
                    onChange={(e) => set.mutate({ p_key: c.key, p_value: e.target.checked })} />
                  {c.value ? t("admin.market.on") : t("admin.market.off")}
                </label>
              ) : <code className="t-liten">{JSON.stringify(c.value)}</code>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- System health + audit ----------
interface Health {
  checked_at: string; chain: { ok: boolean; checked: number; bad_seq?: number; reason?: string };
  events: { total: number; last_24h: number }; anchors: { last_day: string | null; unpublished: number; missing_days: number };
  webhooks: { pending: number; overdue: number; failed_24h: number }; market: { errors_24h: number; stuck_runs: number };
  email_outbox: { pending: number; overdue: number }; flags: Record<string, boolean>;
}

export function AdminHealthPage() {
  const { t } = useTranslation();
  const crumbs = useCrumbs();
  const { atLeast } = useAdmin();
  const q = useRpc<Health>("admin_system_health", {});
  const audit = useRpc<{ id: number; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string; user: string | null }[]>(
    "admin_list_audit", atLeast("superadmin") ? { p_limit: 100 } : null);
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  const h = q.data!;
  const checks: { label: string; ok: boolean; detail: string }[] = [
    { label: t("admin.health.chain"), ok: h.chain.ok, detail: h.chain.ok ? t("admin.events.chain_ok", { count: h.chain.checked }) : t("admin.events.chain_broken", { seq: h.chain.bad_seq, reason: h.chain.reason }) },
    { label: t("admin.health.anchors"), ok: h.anchors.missing_days === 0 && h.anchors.unpublished === 0,
      detail: t("admin.health.anchors_detail", { day: h.anchors.last_day ? formatDate(h.anchors.last_day) : "–", missing: h.anchors.missing_days, unpublished: h.anchors.unpublished }) },
    { label: t("admin.health.webhooks"), ok: h.webhooks.overdue === 0, detail: t("admin.health.webhooks_detail", h.webhooks) },
    { label: t("admin.health.email"), ok: h.email_outbox.overdue === 0, detail: t("admin.health.email_detail", h.email_outbox) },
    { label: t("admin.health.market"), ok: h.market.errors_24h === 0 && h.market.stuck_runs === 0, detail: t("admin.health.market_detail", { errors: h.market.errors_24h, stuck: h.market.stuck_runs }) },
  ];
  return (
    <div className="stack-6">
      <PageHeader title={t("admin.health.title")} lead={t("admin.health.lead", { at: formatDateTime(h.checked_at) })} crumbs={crumbs} />
      <ul className="radlista">
        {checks.map((c) => (
          <li key={c.label}><span><strong>{c.label}</strong><br /><span className="t-liten t-sekundar">{c.detail}</span></span>
            <StatusBadge kind={c.ok ? "verifierad" : "sparr"} icon={c.ok ? "bock" : "varning"}>{c.ok ? t("admin.health.ok") : t("admin.health.attention")}</StatusBadge></li>
        ))}
      </ul>
      <dl className="nyckeltal">
        <div><dt>{t("admin.health.events_total")}</dt><dd>{formatNumber(h.events.total)}</dd></div>
        <div><dt>{t("admin.health.events_24h")}</dt><dd>{formatNumber(h.events.last_24h)}</dd></div>
      </dl>
      {audit.data && (
        <section className="stack-3">
          <h2 className="t-rubrik-4">{t("admin.health.audit")}</h2>
          <p className="t-liten t-sekundar">{t("admin.health.audit_lead")}</p>
          <DataTable caption={t("admin.health.audit")} rows={audit.data} getKey={(a) => String(a.id)} exportName="operatorslogg"
            columns={[
              { id: "at", header: t("admin.health.when"), value: (a) => a.created_at, cell: (a) => formatDateTime(a.created_at) },
              { id: "who", header: t("admin.health.who"), value: (a) => a.user ?? "", cell: (a) => a.user ?? "–" },
              { id: "action", header: t("admin.health.action"), value: (a) => a.action, cell: (a) => <span className="mid-id">{a.action}</span> },
              { id: "details", header: t("admin.events.payload"), value: (a) => JSON.stringify(a.details), hideOnMobile: true,
                cell: (a) => <code className="t-liten">{[a.target_id, JSON.stringify(a.details)].filter((x) => x && x !== "{}").join(" ")}</code> },
            ]} />
        </section>
      )}
    </div>
  );
}
