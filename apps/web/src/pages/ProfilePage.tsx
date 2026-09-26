import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, Notice, PageHeader, Skeleton } from "../components/Feedback";
import { FormField } from "../components/FormField";
import { useRpcMutation } from "../lib/api/query";
import { IdentityStep } from "./onboarding/IdentityStep";
import { MfaSection } from "./MfaSection";

/** The signed-in user's own profile: name, phone, language, identity, two-factor sign-in. */
export function ProfilePage() {
  const { t } = useTranslation();
  const { ready, session, context } = useAuth();
  const save = useRpcMutation<{ p_full_name?: string; p_phone?: string; p_locale?: string }>("update_profile", { raw: true });
  const [form, setForm] = useState<Record<string, string>>({});
  if (ready && !session) return <Navigate to="/login?next=/profile" replace />;
  if (!context) return <div className="behallare sektion"><Skeleton lines={6} /></div>;
  return (
    <div className="behallare sektion stack-6 smal-bred">
      <PageHeader title={t("nav.profile")} lead={context.email} />
      <form className="panel stack-4 formular" onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ p_full_name: form.full_name, p_phone: form.phone, p_locale: form.locale });
      }}>
        {save.isSuccess && <Notice kind="ok" title={t("org.saved")} />}
        {save.error && <ErrorNotice error={save.error} />}
        <FormField label={t("auth.full_name")}><input className="mid-input" defaultValue={context.full_name ?? ""} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} /></FormField>
        <FormField label={t("common.phone")} optional><input className="mid-input" type="tel" defaultValue={context.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></FormField>
        <FormField label={t("common.language")}>
          <select className="mid-select" defaultValue={context.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}>
            <option value="sv">{t("common.lang_sv")}</option><option value="en">{t("common.lang_en")}</option>
          </select>
        </FormField>
        <button className="mid-knapp mid-knapp-primar" type="submit">{t("common.save")}</button>
      </form>
      <section className="panel stack-3"><IdentityStep compact /></section>
      <MfaSection />
    </div>
  );
}
