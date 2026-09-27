import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ErrorNotice, Notice } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { backend } from "../../lib/backend";

export function SignupPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const schema = z.object({
    full_name: z.string().trim().min(2, t("auth.required_name")),
    email: z.string().min(1, t("auth.required_email")).email(t("auth.invalid_email")),
    password: z.string().min(8, t("auth.password_hint")),
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  async function onSubmit(v: z.infer<typeof schema>) {
    setError(null);
    try {
      const r = await backend.auth.signUp(v.email, v.password, { full_name: v.full_name, locale: i18n.language });
      if (!r.session) return setConfirm(v.email);
      navigate(params.get("next") ?? "/onboarding", { replace: true });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="behallare sektion">
      <div className="panel panel-register stack-5 smal">
        <div className="stack-2">
          <h1 className="t-rubrik-2">{t("auth.sign_up_title")}</h1>
          <p className="t-brodtext t-sekundar">{t("auth.sign_up_lead")}</p>
        </div>
        {!!error && <ErrorNotice error={error} />}
        {confirm && <Notice kind="ok" title={t("auth.link_sent", { email: confirm })} />}
        <form className="stack-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <FormField label={t("auth.full_name")} error={errors.full_name?.message}>
            <input className="mid-input" autoComplete="name" {...register("full_name")} />
          </FormField>
          <FormField label={t("auth.email")} error={errors.email?.message}>
            <input className="mid-input" type="email" autoComplete="email" {...register("email")} />
          </FormField>
          <FormField label={t("auth.password")} hint={t("auth.password_hint")} error={errors.password?.message}>
            <input className="mid-input" type="password" autoComplete="new-password" {...register("password")} />
          </FormField>
          <button className="mid-knapp mid-knapp-primar" type="submit" disabled={isSubmitting}>{t("auth.create_account")}</button>
        </form>
        <p className="t-liten">{t("auth.have_account")} <Link className="mid-lank" to="/login">{t("auth.sign_in")}</Link></p>
      </div>
    </div>
  );
}
