import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorNotice } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { formatDate } from "../../lib/format";
import { backend } from "../../lib/backend";

/** "Verifiera identitet" with BankID (SPEC §2.5, §11.1). Demo-BankID in DEMO_MODE, clearly labelled. */
export function IdentityStep({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { context, refresh } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!context) return null;
  if (context.identity_verified_at) {
    return <p className="t-liten"><Icon name="bock" className="ikon-inline" /> {t("identity.verified", { date: formatDate(context.identity_verified_at) })}</p>;
  }
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      if (context!.demo_mode) {
        await backend.rpc("verify_identity", { p_provider: "mock" });
      } else {
        const { url } = await backend.invoke<{ url: string }>("bankid-identify", { return_to: location.href });
        location.assign(url);
        return;
      }
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={compact ? "stack-3" : "panel panel-register stack-4"}>
      <h2 className="t-rubrik-3">{t("identity.title")}</h2>
      <p className="t-brodtext">{t("identity.lead")}</p>
      {context.demo_mode && <p className="mid-hjalp">{t("identity.demo_notice")}</p>}
      {!!error && <ErrorNotice error={error} />}
      <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => void verify()} disabled={busy}>
        <Icon name="skold" />{context.demo_mode ? t("identity.demo_button") : t("identity.button")}
      </button>
    </div>
  );
}
