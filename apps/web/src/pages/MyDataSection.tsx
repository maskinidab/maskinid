import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorNotice } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { rpc } from "../lib/api/query";
import { downloadBytes } from "../lib/pdf/receipt";

/** Download all data about oneself as JSON (GDPR art. 15/20, step 24). */
export function MyDataSection() {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true); setError(null);
    try {
      const data = await rpc<unknown>("export_my_data");
      downloadBytes(new TextEncoder().encode(JSON.stringify(data, null, 2)), `mina-uppgifter-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <section className="panel stack-3" aria-labelledby="mina-uppgifter">
      <h2 id="mina-uppgifter" className="t-rubrik-4">{t("export.my_title")}</h2>
      <p className="t-liten">{t("export.my_lead")}</p>
      {!!error && <ErrorNotice error={error} />}
      <div><button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy} onClick={() => void download()}><Icon name="nedladdning" />{t("export.my_download")}</button></div>
    </section>
  );
}
