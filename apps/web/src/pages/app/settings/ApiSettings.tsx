import { SCOPES } from "@maskinid/shared/api/routes.ts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, Notice, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import { formatDateTime } from "../../../lib/format";

const EVENTS = ["machine.registered", "machine.verified", "encumbrance.pending", "encumbrance.confirmed", "encumbrance.conflict", "encumbrance.released",
  "transfer.initiated", "transfer.awaiting_you", "transfer.completed", "flag.raised", "flag.cleared", "machine.scanned", "market.alert", "label.bound", "lead.created"];

interface Key { id: string; name: string; prefix: string; scopes: string[]; sandbox: boolean; last_used_at: string | null; revoked_at: string | null;
  created_at: string; requests_30d: number; errors_30d: number }
interface Hook { id: string; url: string; event_types: string[]; delivered_24h: number; failed_24h: number; created_at: string }
interface Delivery { id: string; webhook_id: string; event_type: string; status: string; attempt: number; response_code: number | null;
  last_error: string | null; created_at: string; delivered_at: string | null }

function Secret({ title, value, onClose }: { title: string; value: string; onClose(): void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onClose={onClose} title={title}>
      <div className="stack-4">
        <Notice kind="info" title={t("api.shown_once")} />
        <div className="mid-sok-rad">
          <input className="mid-input is-id" readOnly value={value} aria-label={title} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); }}>
            <Icon name="kopiera" />{copied ? t("common.copied") : t("common.copy")}</button>
        </div>
        <div className="mid-rad mid-rad-slut"><button type="button" className="mid-knapp mid-knapp-primar" onClick={onClose}>{t("common.done")}</button></div>
      </div>
    </Dialog>
  );
}

/** Settings → API (SPEC §12): keys with scopes (shown once), webhooks with deliveries and "Skicka igen", usage. */
export function ApiSettings() {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const keys = useRpc<Key[]>("list_api_keys", { p_org_id: orgId });
  const hooks = useRpc<Hook[]>("list_webhooks", { p_org_id: orgId });
  const deliveries = useRpc<Delivery[]>("list_webhook_deliveries", { p_org_id: orgId, p_limit: 100 });
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["machines:read"]);
  const [sandbox, setSandbox] = useState(false);
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["rpc"] });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="stack-6">
      <p className="t-brodtext">{t("api.lead")} <Link className="mid-lank" to="/api-docs">{t("api.docs")}</Link></p>
      {error != null && <ErrorNotice error={error} />}
      <section className="stack-3" aria-labelledby="api-nycklar">
        <h2 id="api-nycklar" className="t-rubrik-4">{t("api.keys")}</h2>
        <form className="panel stack-3" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const k = await rpc<{ key: string }>("create_api_key", { p_org_id: orgId, p_name: name, p_scopes: scopes, p_sandbox: sandbox });
            setSecret({ title: t("api.new_key"), value: k.key });
            setName("");
            await refresh();
          } catch (err) { setError(err); }
        }}>
          <FormField label={t("common.name")} hint={t("api.name_hint")}><input className="mid-input" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
          <fieldset className="stack-2">
            <legend className="mid-etikett">{t("api.scopes")}</legend>
            <div className="mid-val">{SCOPES.map((s) => (
              <label key={s}><input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes((x) => toggle(x, s))} />
                <span><code className="mid-id">{s}</code><small>{t(`api.scope.${s.replace(":", "_")}`)}</small></span></label>
            ))}</div>
          </fieldset>
          <label className="mid-kryss"><input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />{t("api.sandbox")}</label>
          <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!name.trim() || scopes.length === 0}>{t("api.create_key")}</button></div>
        </form>
        {keys.isLoading ? <Skeleton /> : (
          <DataTable caption={t("api.keys")} rows={keys.data ?? []} getKey={(k) => k.id} exportName="api-nycklar"
            empty={<EmptyState icon="nyckel" title={t("api.no_keys")} />}
            columns={[
              { id: "name", header: t("common.name"), value: (k) => k.name, cell: (k) => <><strong>{k.name}</strong><br /><span className="mid-id t-liten">{k.prefix}…</span></> },
              { id: "scopes", header: t("api.scopes"), value: (k) => k.scopes.join(" "), cell: (k) => <span className="t-liten mid-id">{k.scopes.join(" ")}</span>, hideOnMobile: true },
              { id: "use", header: t("api.requests_30d"), value: (k) => k.requests_30d, cell: (k) => `${k.requests_30d} / ${k.errors_30d}`, hideOnMobile: true },
              { id: "last", header: t("api.last_used"), value: (k) => k.last_used_at, cell: (k) => formatDateTime(k.last_used_at) || "–" },
              { id: "status", header: t("common.status"), value: (k) => (k.revoked_at ? "revoked" : "active"), cell: (k) => k.revoked_at
                ? <StatusBadge kind="neutral">{t("api.revoked")}</StatusBadge>
                : <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void rpc("revoke_api_key", { p_org_id: orgId, p_api_key_id: k.id }).then(refresh, setError)}>{t("api.revoke")}</button> },
            ]} />
        )}
      </section>

      <section className="stack-3" aria-labelledby="webhooks">
        <h2 id="webhooks" className="t-rubrik-4">{t("api.webhooks")}</h2>
        <form className="panel stack-3" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const w = await rpc<{ secret: string }>("create_webhook", { p_org_id: orgId, p_url: url, p_event_types: events });
            setSecret({ title: t("api.webhook_secret"), value: w.secret });
            setUrl("https://");
            await refresh();
          } catch (err) { setError(err); }
        }}>
          <FormField label="URL" hint={t("api.url_hint")}><input className="mid-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></FormField>
          <fieldset className="stack-2">
            <legend className="mid-etikett">{t("api.events")} <span className="t-sekundar">({t("api.events_all")})</span></legend>
            <div className="mid-val">{EVENTS.map((ev) => (
              <label key={ev}><input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents((x) => toggle(x, ev))} /><span className="mid-id">{ev}</span></label>
            ))}</div>
          </fieldset>
          <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!/^https:\/\/.+\..+/.test(url)}>{t("api.create_webhook")}</button></div>
        </form>
        {(hooks.data ?? []).length === 0 ? <p className="t-liten t-sekundar">{t("api.no_webhooks")}</p> : (
          <ul className="radlista">
            {hooks.data!.map((h) => (
              <li key={h.id}>
                <span><span className="mid-id">{h.url}</span><br /><span className="t-liten t-sekundar">
                  {h.event_types.length ? h.event_types.join(", ") : t("api.events_all")} · {t("api.last_24h", { ok: h.delivered_24h, failed: h.failed_24h })}</span></span>
                <span className="mid-rad">
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void rpc("test_webhook", { p_org_id: orgId, p_webhook_id: h.id }).then(refresh, setError)}>{t("api.test")}</button>
                  <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => void rpc("delete_webhook", { p_org_id: orgId, p_webhook_id: h.id }).then(refresh, setError)}>{t("common.remove")}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="t-rubrik-4">{t("api.deliveries")}</h3>
        <DataTable caption={t("api.deliveries")} rows={deliveries.data ?? []} getKey={(d) => d.id} exportName="leveranser"
          empty={<EmptyState icon="lank" title={t("api.no_deliveries")} />}
          filters={[{ id: "status", label: t("common.status"), options: ["pending", "delivered", "failed"].map((s) => ({ value: s, label: t(`api.status.${s}`) })), match: (d, v) => d.status === v }]}
          columns={[
            { id: "at", header: t("common.date"), value: (d) => d.created_at, cell: (d) => formatDateTime(d.created_at), sortable: true },
            { id: "type", header: t("common.type"), value: (d) => d.event_type, cell: (d) => <span className="mid-id">{d.event_type}</span> },
            { id: "status", header: t("common.status"), value: (d) => d.status, cell: (d) => (
              <StatusBadge kind={d.status === "delivered" ? "verifierad" : d.status === "failed" ? "sparr" : "vantar"}>{`${t(`api.status.${d.status}`)}${d.response_code ? ` · ${d.response_code}` : ""}`}</StatusBadge>) },
            { id: "attempt", header: t("api.attempts"), value: (d) => d.attempt, cell: (d) => d.attempt, hideOnMobile: true },
            { id: "x", header: "", cell: (d) => d.status !== "pending" ? <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten"
              onClick={() => void rpc("redeliver_webhook", { p_org_id: orgId, p_delivery_id: d.id }).then(refresh, setError)}>{t("api.redeliver")}</button> : null },
          ]} />
      </section>
      {secret && <Secret title={secret.title} value={secret.value} onClose={() => setSecret(null)} />}
    </div>
  );
}
