/**
 * Guards a page that belongs to a per-organisation module (ADR 0031).
 *
 * Hiding the menu item is not enough: `appRoutes` carries no role metadata, so every page is reachable by typing
 * its address. Without this, a dealer with Uthyrning switched off could open /rentals and be offered a "Ny
 * uthyrning" button that the server then refuses — an error where a plain explanation belongs.
 *
 * The database stays the authority: the insert triggers refuse the write whatever the client renders.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../auth/OrgContext";
import { Notice } from "./Feedback";
import type { ModuleName } from "../layouts/nav";

export function ModuleGate({ module, children }: { module: ModuleName; children: ReactNode }) {
  const { t } = useTranslation();
  const { moduleOn, isAdmin, path } = useOrg();
  if (moduleOn(module)) return <>{children}</>;
  return (
    <div className="stack-4">
      <Notice kind="info" title={t("org.module_off", { module: t(`org.module.${module}`) })}>
        <p>{t("org.module_off_body")}</p>
      </Notice>
      {isAdmin && (
        <div>
          <Link className="mid-knapp mid-knapp-primar" to={path("settings?tab=modules")}>{t("org.modules_title")}</Link>
        </div>
      )}
    </div>
  );
}
