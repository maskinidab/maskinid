import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { ErrorNotice, Notice } from "../../../components/Feedback";
import { Icon } from "../../../components/Icon";
import { rpc } from "../../../lib/api/query";
import { downloadBytes } from "../../../lib/pdf/receipt";

/** Settings → Data (org admins): export all of the organisation's data as JSON (step 24). */
export function DataExportSettings() {
  const { t } = useTranslation();
  const { orgId, org } = useOrg();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function run() {
    setBusy(true); setError(null); setDone(null);
    try {
      const data = await rpc<Record<string, unknown>>("export_org_data", { p_org_id: orgId });
      downloadBytes(new TextEncoder().encode(JSON.stringify(data, null, 2)), `${org.slug}-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
      setDone(Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])));
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack-4 smal-bred">
      <h2 className="t-rubrik-4">{t("export.org_title")}</h2>
      <p>{t("export.org_lead")}</p>
      <ul className="lista-punkter t-liten">
        <li>{t("export.org_contents")}</li>
        <li>{t("export.org_not_included")}</li>
        <li>{t("export.org_limit")}</li>
      </ul>
      {!!error && <ErrorNotice error={error} />}
      {done && <Notice kind="ok" title={t("export.org_done", { machines: done.machines ?? 0, events: done.events ?? 0 })} />}
      <div><button type="button" className="mid-knapp mid-knapp-primar" disabled={busy} onClick={() => void run()}><Icon name="nedladdning" />{t("export.org_download")}</button></div>
    </div>
  );
}
