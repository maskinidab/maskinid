import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { APP_NAME } from "@maskinid/shared/config.ts";
import { Icon } from "../components/Icon";
import { Wordmark } from "../components/Logo";
import { backend, dataSource } from "../lib/backend";
import { useTheme } from "../lib/theme";
import { useAuth } from "../auth/AuthProvider";

/** Visible DEMO banner whenever DEMO_MODE is on (CLAUDE.md rule 10). */
export function DemoBanner() {
  const { t } = useTranslation();
  const { context } = useAuth();
  const demo = dataSource === "local" || context?.demo_mode || import.meta.env.VITE_DEMO_MODE !== "false";
  if (!demo) return null;
  return (
    <div className="demo-rad" role="note">
      <div className="behallare demo-rad-inre">
        <strong>{t("common.demo_banner")}</strong>
        {backend.reset && (
          <button type="button" className="mid-lank-knapp mid-lank" onClick={async () => {
            await backend.reset?.();
            location.assign("/");
          }}>{t("common.demo_reset")}</button>
        )}
      </div>
    </div>
  );
}

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const next = i18n.language === "en" ? "sv" : "en";
  return (
    <button type="button" className="tema-knapp sprak-knapp" lang={next} aria-label={`${t("common.language")}: ${t(`common.lang_${next}`)}`}
      onClick={() => {
        void i18n.changeLanguage(next);
        if (session) void backend.rpc("update_profile", { p_locale: next }).catch(() => undefined);
      }}>
      {next.toUpperCase()}
    </button>
  );
}

export function ThemeSwitch() {
  const { t } = useTranslation();
  const { isDark, toggle } = useTheme();
  return (
    <button type="button" className="tema-knapp" onClick={toggle} aria-label={isDark ? t("common.theme_light") : t("common.theme_dark")}>
      <Icon name={isDark ? "sol" : "mane"} />
    </button>
  );
}

export function LogoLink({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="sidhuvud-logo" aria-label={APP_NAME}>
      <Wordmark height={22} />
    </Link>
  );
}

export function SkipLink() {
  const { t } = useTranslation();
  return <a className="hoppa-till" href="#innehall">{t("common.skip_to_content")}</a>;
}
