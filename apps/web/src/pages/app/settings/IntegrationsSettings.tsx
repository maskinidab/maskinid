import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../auth/AuthProvider";
import { useOrg } from "../../../auth/OrgContext";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, Notice, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import { backend, dataSource } from "../../../lib/backend";
import { formatDateTime } from "../../../lib/format";

type Provider = "caretrack" | "komtrax" | "trackunit" | "iso15143" | "mock";
interface Connection {
  id: string; provider: Provider; name: string; base_url: string | null; status: "active" | "paused" | "error"; has_credential: boolean;
  last_sync_at: string | null; last_error: string | null; last_counts: { matched: number; unmatched: number; hours: number; positions: number } | null;
  sync_requested: boolean; machines: number;
}

const STATUS_KIND = { active: "verifierad", paused: "neutral", error: "sparr" } as const;

/** Settings → Integrationer (org admins): telematics feeds that report hours and position (step 25). */
export function IntegrationsSettings() {
  const { t } = useTranslation();
  const { orgId, isAdmin } = useOrg();
  const q = useRpc<Connection[]>("list_telematics_connections", { p_org_id: orgId });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(c: Connection, action: "sync" | "pause" | "resume" | "delete") {
    setBusy(c.id); setError(null);
    try {
      await rpc("update_telematics_connection", { p_org_id: orgId, p_connection_id: c.id, p_action: action });
      // In the browser demo there is no scheduler: run the sync job right away.
      if ((action === "sync" || action === "resume") && dataSource === "local") await backend.invoke("telematics-sync", {});
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  return (
    <div className="stack-5">
      <div className="stack-2">
        <h2 className="t-rubrik-4">{t("integrations.telematics_title")}</h2>
        <p className="t-liten">{t("integrations.telematics_lead")}</p>
      </div>
      {!!error && <ErrorNotice error={error} />}
      {q.isLoading ? <Skeleton lines={3} /> : q.error ? <ErrorNotice error={q.error} /> : !q.data!.length ? (
        <EmptyState icon="lank" title={t("integrations.none")} body={t("integrations.none_body")}
          action={isAdmin ? { label: t("integrations.add"), onClick: () => setOpen(true) } : undefined} />
      ) : (
        <ul className="radlista">
          {q.data!.map((c) => (
            <li key={c.id}>
              <span className="stack-1">
                <span><strong>{c.name}</strong> · {t(`integrations.provider.${c.provider}`)} <StatusBadge kind={STATUS_KIND[c.status]}>{t(`integrations.status.${c.status}`)}</StatusBadge></span>
                <span className="t-liten t-sekundar">
                  {c.last_sync_at ? t("integrations.last_sync", { at: formatDateTime(c.last_sync_at) }) : t("integrations.never_synced")}
                  {c.last_counts && ` · ${t("integrations.counts", c.last_counts)}`}
                  {` · ${t("integrations.linked", { count: c.machines })}`}
                </span>
                {c.last_error && <span className="t-liten" role="alert">{t("integrations.error", { error: c.last_error })}</span>}
              </span>
              {isAdmin && (
                <span className="mid-rad">
                  {c.status !== "paused" && <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-sekundar" disabled={busy === c.id} onClick={() => void act(c, "sync")}>{t("integrations.sync")}</button>}
                  {c.status === "paused"
                    ? <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-kontur" disabled={busy === c.id} onClick={() => void act(c, "resume")}>{t("integrations.resume")}</button>
                    : <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-kontur" disabled={busy === c.id} onClick={() => void act(c, "pause")}>{t("integrations.pause")}</button>}
                  <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-text" disabled={busy === c.id} onClick={() => void act(c, "delete")}>{t("common.remove")}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && !!q.data?.length && <div><button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setOpen(true)}><Icon name="plus" />{t("integrations.add")}</button></div>}
      <Notice title={t("integrations.privacy_title")}><p className="t-liten">{t("integrations.privacy")}</p></Notice>
      {open && <AddConnection onClose={() => setOpen(false)} />}
    </div>
  );
}

function AddConnection({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const { context } = useAuth();
  const demo = !!context?.demo_mode || dataSource === "local";
  const providers: Provider[] = ["caretrack", "komtrax", "trackunit", "iso15143", ...(demo ? ["mock" as const] : [])];
  const [d, setD] = useState({ provider: (demo ? "mock" : "caretrack") as Provider, name: "", base_url: "", auth: "basic", username: "", password: "", token: "",
    token_url: "", client_id: "", client_secret: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const credential = d.provider === "mock" ? null
    : d.auth === "basic" ? { type: "basic", username: d.username, password: d.password }
      : d.auth === "bearer" ? { type: "bearer", token: d.token }
        : { type: "oauth", token_url: d.token_url, client_id: d.client_id, client_secret: d.client_secret };
  async function save() {
    setBusy(true); setError(null);
    try {
      await rpc("create_telematics_connection", { p_org_id: orgId, p_provider: d.provider, p_name: d.name.trim() || t(`integrations.provider.${d.provider}`),
        p_base_url: d.provider === "mock" ? null : d.base_url.trim(), p_credential: credential });
      if (dataSource === "local") await backend.invoke("telematics-sync", {});
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
      onClose();
    } catch (e) { setError(e); setBusy(false); }
  }
  const field = (k: keyof typeof d, label: string, type = "text") => (
    <FormField label={label}><input className="mid-input" type={type} autoComplete="off" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></FormField>
  );
  return (
    <Dialog open onClose={onClose} title={t("integrations.add")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <FormField label={t("integrations.provider_label")}>
          <select className="mid-select" value={d.provider} onChange={(e) => setD({ ...d, provider: e.target.value as Provider })}>
            {providers.map((p) => <option key={p} value={p}>{t(`integrations.provider.${p}`)}</option>)}
          </select>
        </FormField>
        {field("name", t("integrations.name"))}
        {d.provider !== "mock" && <>
          <FormField label={t("integrations.base_url")} hint={t("integrations.base_url_hint")}>
            <input className="mid-input" type="url" placeholder="https://" value={d.base_url} onChange={(e) => setD({ ...d, base_url: e.target.value })} required />
          </FormField>
          <FormField label={t("integrations.auth")}>
            <select className="mid-select" value={d.auth} onChange={(e) => setD({ ...d, auth: e.target.value })}>
              {["basic", "bearer", "oauth"].map((a) => <option key={a} value={a}>{t(`integrations.auth_${a}`)}</option>)}
            </select>
          </FormField>
          {d.auth === "basic" && <>{field("username", t("integrations.username"))}{field("password", t("integrations.password"), "password")}</>}
          {d.auth === "bearer" && field("token", t("integrations.token"), "password")}
          {d.auth === "oauth" && <>{field("token_url", t("integrations.token_url"), "url")}{field("client_id", t("integrations.client_id"))}{field("client_secret", t("integrations.client_secret"), "password")}</>}
          <p className="t-liten t-sekundar">{t("integrations.credential_note")}</p>
        </>}
        {d.provider === "mock" && <p className="t-liten t-sekundar">{t("integrations.mock_note")}</p>}
        {!!error && <ErrorNotice error={error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}>{t("integrations.connect")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
