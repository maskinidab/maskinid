import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorNotice, Skeleton } from "../../components/Feedback";
import type { OrgBrief } from "../../lib/api/types";
import { backend } from "../../lib/backend";

/** /invite/:token – accepts an organisation invitation after sign-in. */
export function InvitePage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const { session, ready, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!session || !token) return;
    backend.rpc<OrgBrief>("accept_invite", { p_token: token }).then(async (org) => {
      await refresh();
      navigate(`/o/${org.slug}/dashboard`, { replace: true });
    }).catch(setError);
  }, [session, token, navigate, refresh]);
  if (ready && !session) return <Navigate to={`/signup?next=${encodeURIComponent(location.pathname)}`} replace />;
  return (
    <div className="behallare sektion stack-4">
      <h1 className="t-rubrik-2">{t("inbox.invitation")}</h1>
      {error ? <ErrorNotice error={error} /> : <Skeleton lines={2} />}
    </div>
  );
}
