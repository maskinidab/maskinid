import { validateRegNumber } from "@maskinid/shared/regnr.ts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorNotice, Skeleton } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { RegNumber } from "../../components/RegNumber";
import { FinancingBadge } from "../../components/StatusBadge";
import { useRpc } from "../../lib/api/query";
import type { PublicCard } from "../../lib/api/types";
import { IdentityStep } from "../onboarding/IdentityStep";

/**
 * /verify – a private buyer signs in with BankID and sees whether financing exists – never who holds it (SPEC §6.6
 * step 6). Each check is logged and visible to the owner.
 */
export function VerifyPage() {
  const { t } = useTranslation();
  const { ready, session, context } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState(params.get("reg") ?? "");
  const reg = params.get("reg");
  const code = params.get("code");
  const verified = !!context?.identity_verified_at;
  const q = useRpc<{ found: boolean; card?: PublicCard; has_active_financing?: boolean }>(
    "private_financing_status", verified && (reg || code) ? { p_reg: reg, p_code: code } : null);
  if (ready && !session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <div className="behallare sektion stack-5 smal-bred">
      <h1 className="t-rubrik-2">{t("public.verify_title")}</h1>
      <p className="t-brodtext">{t("public.verify_lead")}</p>
      {!context ? <Skeleton /> : !verified ? <IdentityStep /> : (
        <>
          <form className="mid-sok-rad" onSubmit={(e) => {
            e.preventDefault();
            const v = validateRegNumber(value);
            if (v.ok) setParams({ reg: v.value });
          }}>
            <FormField label={t("public.lookup_label")}><input className="mid-input is-id" value={value} onChange={(e) => setValue(e.target.value)} /></FormField>
            <button className="mid-knapp mid-knapp-primar" type="submit">{t("public.lookup_button")}</button>
          </form>
          {q.error && <ErrorNotice error={q.error} />}
          {q.data?.found && q.data.card && (
            <div className="panel panel-register stack-3">
              <RegNumber value={q.data.card.reg_number} framed />
              <p><strong>{q.data.card.make} {q.data.card.model}</strong></p>
              <FinancingBadge hasActive={!!q.data.has_active_financing} />
              <p className="t-liten t-sekundar">{t("public.verify_logged")}</p>
              <Link className="mid-lank" to={`/r/${q.data.card.reg_number}`}>{t("common.view")}</Link>
            </div>
          )}
          {q.data && !q.data.found && <p>{t("public.not_in_register")}</p>}
        </>
      )}
    </div>
  );
}
