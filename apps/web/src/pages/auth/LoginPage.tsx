import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { recordSecurityEvent } from "../../lib/security";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ErrorNotice, Notice } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { backend, dataSource } from "../../lib/backend";

const DEMO_ACCOUNTS = [
  ["nordmaskin@demo.se", "Nordmaskin AB", "org_type.dealer"],
  ["berg@demo.se", "Bergs Schakt & Entreprenad AB", "org_type.owner"],
  ["lena@demo.se", "Lena Grävmaskin", "org_type.owner"],
  ["bank@demo.se", "Demo Bank Finans", "org_type.financier"],
  ["finans@demo.se", "Nordisk Maskinfinans", "org_type.financier"],
  ["forsakring@demo.se", "Demo Försäkring", "org_type.insurer"],
  ["polisen@demo.se", "Polisen (demo)", "org_type.authority"],
  ["tull@demo.se", "Tullverket (demo)", "org_type.authority"],
  ["kontroll@demo.se", "Maskinkontroll Sverige AB", "org_type.inspector"],
  ["kommun@demo.se", "Kommunfastigheter Väst", "org_type.client"],
  ["tillverkare@demo.se", "Volvo Construction Equipment (demo)", "org_type.manufacturer"],
  ["admin@demo.se", "MaskinID Sverige AB", "org_type.operator"],
] as const;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/app";
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<{ sentTo: string; demoLink?: string } | null>(null);
  const schema = z.object({
    email: z.string().min(1, t("auth.required_email")).email(t("auth.invalid_email")),
    password: z.string().min(1, t("auth.required_password")),
  });
  const { register, handleSubmit, getValues, setValue, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  async function onSubmit(v: z.infer<typeof schema>) {
    setError(null);
    try {
      await backend.auth.signInWithPassword(v.email, v.password);
      await recordSecurityEvent("sign_in");
      navigate(next, { replace: true });
    } catch (e) {
      setError(e);
    }
  }

  async function sendLink() {
    const email = getValues("email");
    if (!z.string().email().safeParse(email).success) return setError(new Error("email"));
    setError(null);
    try {
      const r = await backend.auth.signInWithOtp(email, `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`);
      setLink({ sentTo: email, demoLink: r.demoLink });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="behallare sektion">
      <div className="inloggning">
        <div className="panel panel-register stack-5">
          <div className="stack-2">
            <h1 className="t-rubrik-2">{t("auth.sign_in_title")}</h1>
            <p className="t-brodtext t-sekundar">{t("auth.sign_in_lead")}</p>
          </div>
          {!!error && <ErrorNotice error={error} />}
          {link && (
            <Notice kind="ok" title={t("auth.link_sent", { email: link.sentTo })}>
              {link.demoLink && <p className="t-liten">{t("auth.demo_link")} <a className="mid-lank" href={link.demoLink}>{t("auth.open_link")}</a></p>}
            </Notice>
          )}
          <form className="stack-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <FormField label={t("auth.email")} error={errors.email?.message}>
              <input className="mid-input" type="email" autoComplete="email" {...register("email")} />
            </FormField>
            <FormField label={t("auth.password")} error={errors.password?.message}>
              <input className="mid-input" type="password" autoComplete="current-password" {...register("password")} />
            </FormField>
            <div className="mid-rad">
              <button className="mid-knapp mid-knapp-primar" type="submit" disabled={isSubmitting}>{isSubmitting ? t("auth.signing_in") : t("auth.sign_in")}</button>
              <button className="mid-knapp mid-knapp-kontur" type="button" onClick={() => void sendLink()}>{t("auth.send_link")}</button>
            </div>
          </form>
          <p className="t-liten">{t("auth.no_account")} <Link className="mid-lank" to={`/signup?next=${encodeURIComponent(next)}`}>{t("auth.create_account")}</Link></p>
        </div>
        {dataSource === "local" && (
          <aside className="panel stack-3" aria-labelledby="demokonton">
            <h2 id="demokonton" className="t-rubrik-4">{t("auth.demo_accounts")}</h2>
            <p className="t-liten t-sekundar">{t("auth.demo_accounts_hint")}</p>
            <ul className="demokonton">
              {DEMO_ACCOUNTS.map(([email, org, type]) => (
                <li key={email}>
                  <button type="button" className="demokonto" onClick={() => { setValue("email", email); setValue("password", "demo1234"); }}>
                    <strong>{org}</strong><span>{t(`enum.${type}`)} · {email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
