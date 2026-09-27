import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { recordSecurityEvent } from "../../lib/security";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ErrorNotice, Skeleton } from "../../components/Feedback";
import { backend } from "../../lib/backend";

/** Landing for magic links and e-mail confirmations. */
export function AuthCallbackPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    backend.auth.completeLink(params).then((s) => {
      if (s) void recordSecurityEvent("sign_in").finally(() => navigate(params.get("next") ?? "/app", { replace: true }));
    }).catch(setError);
  }, [params, navigate]);
  return (
    <div className="behallare sektion stack-4">
      <h1 className="t-rubrik-2">{t("auth.callback_title")}</h1>
      {error ? <ErrorNotice error={error} /> : <Skeleton lines={2} />}
    </div>
  );
}
