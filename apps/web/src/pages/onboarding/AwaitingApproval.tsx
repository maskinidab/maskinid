import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { Notice } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import type { Membership } from "../../lib/api/types";
import { formatDate } from "../../lib/format";
import { DemoBanner, LanguageSwitch, LogoLink, SkipLink, ThemeSwitch } from "../../layouts/Chrome";
import { MfaSection } from "../MfaSection";

/** Header and frame shared by the screens an account sees before it may use the app. */
function GateFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app">
      <SkipLink />
      <DemoBanner />
      <header className="app-huvud">
        <LogoLink to="/" />
        <div className="app-huvud-hoger">
          <LanguageSwitch />
          <ThemeSwitch />
          <button type="button" className="mid-lank-knapp" onClick={async () => { await signOut(); navigate("/"); }}>
            <Icon name="logga-ut" />{t("nav.sign_out")}
          </button>
        </div>
      </header>
      <main id="innehall" tabIndex={-1} className="behallare sektion stack-6" style={{ maxWidth: "40rem" }}>{children}</main>
    </div>
  );
}

/** Lenders, authorities and the operator need two-factor sign-in outside demo mode (SPEC §11.1); the server refuses
 *  everything else with MFA_REQUIRED, so set it up – or step up the session – here first. */
export function MfaRequired({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  return (
    <GateFrame>
      <h1 className="t-rubrik-1">{t("approval.mfa_title")}</h1>
      <p className="t-brodtext">{t("approval.mfa_lead", { name: membership.org.name })}</p>
      <MfaSection />
    </GateFrame>
  );
}

/**
 * The closed pilot (ADR 0034): an organisation is an application until an operator approves it. The server refuses
 * every request in its name (ORG_NOT_APPROVED), so instead of an app full of errors the member sees where they stand.
 */
export function AwaitingApproval({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  const { context, refresh } = useAuth();
  const org = membership.org;
  const rejected = org.status === "suspended" && !!org.rejection_reason;
  const others = (context?.memberships ?? []).filter((m) => m.org.id !== org.id && m.org.status === "approved");
  return (
    <GateFrame>
        <h1 className="t-rubrik-1">{rejected ? t("approval.rejected_title") : t("approval.pending_title")}</h1>
        <section className="panel stack-4">
          <div className="stack-1">
            <strong>{org.name}</strong>
            <span className="t-liten t-sekundar">
              {[org.org_number, org.types.map((x) => t(`enum.org_type.${x}`)).join(", ")].filter(Boolean).join(" · ")}
            </span>
          </div>
          {rejected ? (
            <Notice kind="fel" title={t("approval.rejected_reason", { reason: org.rejection_reason })}>
              <p className="t-liten">{t("approval.rejected_next")}</p>
            </Notice>
          ) : (
            <>
              <p className="t-brodtext">{t("approval.pending_lead")}</p>
              <ol className="stack-2 t-liten">
                <li><Icon name="bock" className="ikon-inline" /> {t("approval.step_email")}</li>
                <li><Icon name="bock" className="ikon-inline" /> {t("approval.step_identity")}</li>
                <li><Icon name="bock" className="ikon-inline" /> {t("approval.step_applied", { date: org.created_at ? formatDate(org.created_at) : "" })}</li>
                <li><Icon name="tid" className="ikon-inline" /> <strong>{t("approval.step_review")}</strong></li>
              </ol>
              <p className="t-liten t-sekundar">{t("approval.pending_email")}</p>
            </>
          )}
          <div className="mid-rad">
            <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => void refresh()}>{t("approval.check_again")}</button>
            <Link className="mid-knapp mid-knapp-text" to="/contact">{t("approval.contact")}</Link>
          </div>
        </section>
        {others.length > 0 && (
          <section className="stack-2">
            <h2 className="t-rubrik-4">{t("approval.other_orgs")}</h2>
            <ul className="stack-1">
              {others.map((m) => <li key={m.org.id}><Link className="mid-lank" to={`/o/${m.org.slug}/dashboard`}>{m.org.name}</Link></li>)}
            </ul>
          </section>
        )}
    </GateFrame>
  );
}
