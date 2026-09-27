import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { Skeleton } from "../../components/Feedback";
import { useRpc } from "../../lib/api/query";
import type { OrgBrief } from "../../lib/api/types";
import { backend } from "../../lib/backend";
import { IdentityStep } from "./IdentityStep";
import { OrgForm } from "./OrgForm";

export function OnboardingPage() {
  const { t } = useTranslation();
  const { ready, session, context, refresh } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const suggested = useRpc<OrgBrief[]>("suggested_orgs", context ? {} : null);
  // Only our own e-mail entry points may be continued after onboarding (no open redirect).
  const next = /^\/(transfer\/[\w-]+(\?token=[\w-]+)?|go\?to=[\w%./-]+)$/.test(params.get("next") ?? "") ? params.get("next")! : null;
  if (ready && !session) return <Navigate to={`/login?next=${encodeURIComponent(`/onboarding${next ? `?next=${encodeURIComponent(next)}` : ""}`)}`} replace />;
  if (!context) return <div className="behallare sektion"><Skeleton lines={5} /></div>;
  if (context.memberships.length && !params.get("new") && context.identity_verified_at) {
    return <Navigate to={next ?? `/o/${context.memberships[0]!.org.slug}/dashboard`} replace />;
  }
  const created = async (org: OrgBrief) => {
    await refresh();
    navigate(next ?? `/o/${org.slug}/dashboard`, { replace: true });
  };
  return (
    <div className="behallare sektion stack-6 smal-bred">
      <div className="stack-2">
        <h1 className="t-rubrik-1">{t("onboarding.title")}</h1>
      </div>
      <IdentityStep />
      {context.identity_verified_at && (
        <>
          {!!context.pending_invites.length && (
            <section className="panel stack-3">
              <h2 className="t-rubrik-3">{t("onboarding.invitations")}</h2>
              <ul className="stack-2">
                {context.pending_invites.map((i) => (
                  <li key={i.membership_id} className="mid-rad">
                    <strong>{i.org.name}</strong> <span className="t-sekundar">{t(`enum.member_role.${i.role}`)}</span>
                    <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten" onClick={async () => {
                      const org = await backend.rpc<OrgBrief>("accept_invite", { p_membership_id: i.membership_id });
                      await created(org);
                    }}>{t("onboarding.accept")}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!suggested.data?.length && (
            <section className="panel stack-3">
              <h2 className="t-rubrik-4">{t("onboarding.suggested")}</h2>
              <ul>{suggested.data.map((o) => <li key={o.id}>{o.name}</li>)}</ul>
            </section>
          )}
          <section className="panel panel-register stack-4">
            <h2 className="t-rubrik-3">{t("onboarding.create_org_title")}</h2>
            <p className="t-brodtext t-sekundar">{t("onboarding.create_org_lead")}</p>
            <OrgForm onCreated={(o) => void created(o)} />
          </section>
        </>
      )}
    </div>
  );
}
