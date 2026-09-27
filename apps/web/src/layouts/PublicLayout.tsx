import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router-dom";
import { APP_LEGAL_NAME, APP_NAME } from "@maskinid/shared/config.ts";
import { useAuth } from "../auth/AuthProvider";
import { Icon } from "../components/Icon";
import { Wordmark } from "../components/Logo";
import { ScanButton } from "../components/Scanner";
import { DemoBanner, LanguageSwitch, LogoLink, SkipLink, ThemeSwitch } from "./Chrome";

export function PublicHeader() {
  const { t } = useTranslation();
  const { session, context } = useAuth();
  const [open, setOpen] = useState(false);
  const first = context?.memberships.find((m) => m.org.id === context.last_active_org_id) ?? context?.memberships[0];
  return (
    <header className="sidhuvud">
      <div className="behallare sidhuvud-inre">
        <LogoLink />
        <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten meny-knapp" aria-expanded={open} aria-controls="huvudmeny" onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "stang" : "meny"} />{t("common.menu")}
        </button>
        <nav id="huvudmeny" className={`sidhuvud-nav${open ? " is-oppen" : ""}`} aria-label={t("nav.main")} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
          <NavLink to="/how">{t("nav.how_it_works")}</NavLink>
          <NavLink to="/pricing">{t("nav.pricing")}</NavLink>
          <NavLink to="/security">{t("nav.security")}</NavLink>
          <NavLink to="/help">{t("nav.help")}</NavLink>
          <ScanButton />
          {session ? (
            <Link className="mid-knapp mid-knapp-sekundar mid-knapp-liten" to={first ? `/o/${first.org.slug}/dashboard` : "/onboarding"}>{t("nav.dashboard")}</Link>
          ) : (
            <Link className="mid-knapp mid-knapp-sekundar mid-knapp-liten" to="/login">{t("nav.sign_in")}</Link>
          )}
          <LanguageSwitch />
          <ThemeSwitch />
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="sidfot">
      <div className="behallare sidfot-inre">
        <div className="stack-3">
          <Wordmark height={24} variant="negativ" />
          <p>{t("public.footer_about", { app: APP_NAME })}</p>
        </div>
        <div>
          <h2>{APP_NAME}</h2>
          <ul>
            <li><Link to="/how">{t("nav.how_it_works")}</Link></li>
            <li><Link to="/pricing">{t("nav.pricing")}</Link></li>
            <li><Link to="/statistics">{t("nav.statistics")}</Link></li>
            <li><Link to="/stolen">{t("public.stolen_list")}</Link></li>
            <li><Link to="/tips">{t("tips.link")}</Link></li>
            <li><Link to="/api-docs">{t("nav.api_docs")}</Link></li>
            <li><Link to="/integrations">{t("nav.integrations")}</Link></li>
          </ul>
        </div>
        <div>
          <h2>{t("segments.nav")}</h2>
          <ul>
            {(["agare", "handlare", "finansiarer", "forsakring", "myndigheter"] as const).map((x) => <li key={x}><Link to={`/for/${x}`}>{t(`segments.${x}.short`)}</Link></li>)}
            <li><Link to="/about">{t("nav.about")}</Link></li>
          </ul>
        </div>
        <div>
          <h2>{t("public.footer_trust")}</h2>
          <ul>
            <li><Link to="/security">{t("nav.security")}</Link></li>
            <li><Link to="/legal/terms">{t("public.terms")}</Link></li>
            <li><Link to="/legal/privacy">{t("public.privacy")}</Link></li>
            <li><Link to="/help">{t("nav.help")}</Link></li>
            <li><Link to="/contact">{t("support.contact_title")}</Link></li>
            <li><Link to="/legal/dpa">{t("legal.keys.dpa")}</Link></li>
            <li><Link to="/status">{t("nav.status")}</Link></li>
          </ul>
        </div>
      </div>
      <div className="behallare sidfot-botten">© {new Date().getFullYear()} {APP_LEGAL_NAME}</div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className="sida">
      <SkipLink />
      <DemoBanner />
      <PublicHeader />
      <main id="innehall" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
