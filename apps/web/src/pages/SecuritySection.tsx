import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ErrorNotice, Skeleton } from "../components/Feedback";
import { Icon } from "../components/Icon";
import { useRpc } from "../lib/api/query";
import { backend } from "../lib/backend";
import { formatDateTime } from "../lib/format";
import { recordSecurityEvent } from "../lib/security";

/** Kontosäkerhet (step 22): recent sign-ins and security events, sign out of all devices. */
export function SecuritySection() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const q = useRpc<{ type: string; ua_family: string | null; created_at: string }[]>("list_security_events", { p_limit: 20 });
  const [error, setError] = useState<unknown>(null);
  async function everywhere() {
    setError(null);
    try {
      await recordSecurityEvent("sign_out_everywhere");
      await backend.auth.signOut({ everywhere: true });
      nav("/login", { replace: true });
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className="panel stack-3" aria-labelledby="sakerhet">
      <h2 id="sakerhet" className="t-rubrik-4">{t("security.title")}</h2>
      <p className="t-liten">{t("security.lead")}</p>
      {q.isLoading ? <Skeleton lines={3} /> : (
        <ul className="radlista">
          {(q.data ?? []).map((e, i) => (
            <li key={i}><span>{t(`security.event.${e.type}`)}{e.ua_family ? <span className="t-liten t-sekundar"> · {e.ua_family}</span> : null}</span>
              <span className="t-liten">{formatDateTime(e.created_at)}</span></li>
          ))}
          {!q.data?.length && <li className="t-liten t-sekundar">{t("security.none")}</li>}
        </ul>
      )}
      {!!error && <ErrorNotice error={error} />}
      <div><button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => void everywhere()}><Icon name="stang" />{t("security.sign_out_everywhere")}</button></div>
      <p className="t-liten t-sekundar">{t("security.suspicious")}</p>
    </section>
  );
}
