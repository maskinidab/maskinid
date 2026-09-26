import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ErrorNotice, Notice, Skeleton } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { MachinePhoto } from "../../components/MachinePhoto";
import { RegNumber } from "../../components/RegNumber";
import { MachineStatusBadge, VerificationBadge } from "../../components/StatusBadge";
import { useRpc } from "../../lib/api/query";
import type { PublicCard } from "../../lib/api/types";
import { backend } from "../../lib/backend";
import { formatNumber } from "../../lib/format";

interface Ad { found: boolean; card?: PublicCard & { hour_meter: number | null }; dealer?: { name: string; city: string | null; phone: string | null; email: string | null } }

/** /ad/:reg – page behind a dealer's ad QR (SPEC §7.2): verified machine card + "Kontakta säljaren" (lead). */
export function AdPage() {
  const { reg } = useParams();
  const { t } = useTranslation();
  const q = useRpc<Ad>("public_ad_card", { p_reg: reg ?? "" });
  const [f, setF] = useState({ name: "", contact: "", message: "", consent: false });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (q.isLoading) return <div className="behallare sektion"><Skeleton lines={6} /></div>;
  if (!q.data?.found || !q.data.card) {
    return (
      <div className="behallare sektion stack-4 smal">
        <Notice kind="info" title={t("ad.not_for_sale")}><p className="t-liten">{t("ad.not_for_sale_body")}</p></Notice>
        <Link className="mid-lank" to={`/r/${reg}`}>{t("ad.see_card")}</Link>
      </div>
    );
  }
  const c = q.data.card;
  const d = q.data.dealer!;
  return (
    <div className="behallare sektion stack-6 smal smal-bred">
      <meta name="robots" content="noindex" />
      <section className="panel maskin-huvud">
        <MachinePhoto path={c.primary_photo_path} category={c.category} size={140} />
        <div className="stack-3">
          <h1 className="t-rubrik-2">{c.make} {c.model}</h1>
          <p className="t-brodtext">{[c.year, t(`enum.category.${c.category}`), c.hour_meter !== null ? `${formatNumber(c.hour_meter)} h` : null].filter(Boolean).join(" · ")}</p>
          <div><RegNumber value={c.reg_number} framed /></div>
          <div className="badge-rad"><MachineStatusBadge status={c.status} /><VerificationBadge level={c.verification_level} /></div>
          <p className="t-liten">{t("ad.serial", { serial: c.serial_masked })}</p>
          <p className="t-liten t-sekundar">{t("ad.register_note")}</p>
        </div>
      </section>
      <section className="panel stack-4" aria-labelledby="kontakta">
        <h2 id="kontakta" className="t-rubrik-3">{t("ad.contact_title", { dealer: d.name })}</h2>
        <p className="t-liten">{[d.city, d.phone, d.email].filter(Boolean).join(" · ")}</p>
        {sent ? <Notice kind="ok" title={t("ad.sent")} /> : (
          <form className="stack-3" noValidate onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await backend.invoke("lead", { reg: c.reg_number, ...f }, { anonymous: true });
              setSent(true);
            } catch (err) { setError(err); }
          }}>
            <FormField label={t("common.name")}><input className="mid-input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
            <FormField label={t("ad.contact")} hint={t("ad.contact_hint")}><input className="mid-input" autoComplete="email" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></FormField>
            <FormField label={t("dealer.message")} optional><textarea className="mid-textarea" rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></FormField>
            <label className="mid-kryss"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />{t("ad.consent", { dealer: d.name })}</label>
            {error != null && <ErrorNotice error={error} />}
            <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={!f.consent || !f.name || !f.contact}>{t("ad.send")}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
