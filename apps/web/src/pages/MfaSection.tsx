import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, Notice } from "../components/Feedback";
import { FormField } from "../components/FormField";
import { backend } from "../lib/backend";

/** TOTP two-factor sign-in (SPEC §11.1: required for financier/authority/operator outside DEMO_MODE). */
export function MfaSection() {
  const { t } = useTranslation();
  const { session, refresh } = useAuth();
  const [factors, setFactors] = useState<{ id: string; status: string }[]>([]);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string; img?: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { void backend.auth.mfa.list().then(setFactors); }, [done]);
  const verified = factors.find((f) => f.status === "verified");
  return (
    <section className="panel stack-4" aria-labelledby="mfa">
      <h2 id="mfa" className="t-rubrik-3">{t("security.mfa_title")}</h2>
      <p className="t-brodtext t-sekundar">{t("security.mfa_lead")}</p>
      {!!error && <ErrorNotice error={error} />}
      {done && <Notice kind="ok" title={t("security.mfa_enabled")} />}
      {verified ? (
        <div className="stack-3">
          <p>{t("security.mfa_on")} {session?.aal === "aal2" ? `· ${t("security.mfa_session_ok")}` : ""}</p>
          {session?.aal !== "aal2" && (
            <form className="mid-sok-rad" onSubmit={async (e) => {
              e.preventDefault();
              try { await backend.auth.mfa.verify(verified.id, code); await refresh(); setDone(true); } catch (x) { setError(x); }
            }}>
              <label className="visually-hidden" htmlFor="mfa-kod">{t("auth.mfa_code")}</label>
              <input id="mfa-kod" className="mid-input is-id" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              <button className="mid-knapp mid-knapp-sekundar" type="submit">{t("auth.mfa_verify")}</button>
            </form>
          )}
          <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={async () => { await backend.auth.mfa.unenroll(verified.id); setDone(false); setFactors([]); }}>{t("security.mfa_disable")}</button>
        </div>
      ) : enroll ? (
        <form className="stack-3" onSubmit={async (e) => {
          e.preventDefault();
          try { await backend.auth.mfa.verify(enroll.factorId, code); setEnroll(null); setDone(true); await refresh(); } catch (x) { setError(x); }
        }}>
          <p>{t("security.mfa_scan")}</p>
          {enroll.img && <img src={enroll.img} alt={t("security.mfa_qr_alt")} width={180} height={180} />}
          <p className="mid-id t-liten">{enroll.secret}</p>
          <FormField label={t("auth.mfa_code")}><input className="mid-input is-id" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></FormField>
          <button className="mid-knapp mid-knapp-primar" type="submit">{t("auth.mfa_verify")}</button>
        </form>
      ) : (
        <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={async () => {
          try {
            const r = await backend.auth.mfa.enroll();
            const img = r.qr.startsWith("otpauth:") ? await QRCode.toDataURL(r.qr, { margin: 1, width: 180 }) : r.qr;
            setEnroll({ ...r, img });
          } catch (x) { setError(x); }
        }}>{t("security.mfa_enable")}</button>
      )}
    </section>
  );
}
