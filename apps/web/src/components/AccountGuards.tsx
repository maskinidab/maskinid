import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useOrg } from "../auth/OrgContext";
import { rpc } from "../lib/api/query";
import { formatDateTime } from "../lib/format";
import { Dialog } from "./Dialog";
import { ErrorNotice } from "./Feedback";
import { Icon } from "./Icon";

/** New required terms/privacy/DPA versions must be accepted before the user continues (step 22). */
export function LegalGate() {
  const { t } = useTranslation();
  const { context, refresh } = useAuth();
  const { orgId, viewAs } = useOrg();
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = context?.legal_pending ?? [];
  if (!pending.length || viewAs) return null;
  async function accept() {
    setError(null);
    try {
      await rpc("accept_legal_documents", { p_items: pending, p_org_id: orgId });
      await refresh();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Dialog open onClose={() => undefined} title={t("legal.gate_title")}>
      <div className="stack-4">
        <p>{t("legal.gate_lead")}</p>
        <ul className="stack-1">
          {pending.map((p) => (
            <li key={p.key}><Link className="mid-lank" to={`/legal/${p.key}`} target="_blank" rel="noopener">{t(`legal.keys.${p.key}`)}</Link>
              <span className="t-liten t-sekundar"> · {t("legal.version_short", { version: p.version })}</span></li>
          ))}
        </ul>
        <label className="mid-kryss"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />{t("legal.gate_confirm")}</label>
        {!!error && <ErrorNotice error={error} />}
        <div><button type="button" className="mid-knapp mid-knapp-primar" disabled={!ok} onClick={() => void accept()}>{t("legal.gate_accept")}</button></div>
      </div>
    </Dialog>
  );
}

/** Banner while operator support views the organisation read-only. */
export function ViewAsBanner() {
  const { t } = useTranslation();
  const { org, viewAs, viewAsExpiresAt } = useOrg();
  const { refresh } = useAuth();
  const nav = useNavigate();
  if (!viewAs) return null;
  async function end() {
    await rpc("end_view_as");
    await refresh();
    nav("/admin/organizations");
  }
  return (
    <div className="visa-som" role="status">
      <Icon name="oga" />
      <span>{t("viewas.banner", { org: org.name, until: viewAsExpiresAt ? formatDateTime(viewAsExpiresAt) : "" })}</span>
      <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-kontur" onClick={() => void end()}>{t("viewas.end")}</button>
    </div>
  );
}
