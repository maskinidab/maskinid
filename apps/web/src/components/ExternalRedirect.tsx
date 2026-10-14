import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Notice, Skeleton } from "./Feedback";

/**
 * Sends the browser to the same path on the other deployment (site ↔ app, ADR 0035). A full page load, not a router
 * navigation: the other side is another origin with its own session.
 */
export function ExternalRedirect({ base }: { base: (path: string) => string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const target = base(location.pathname + location.search + location.hash);
  // A deployment without VITE_SITE_URL / VITE_APP_URL would point at itself and reload forever: say so instead.
  const self = new URL(target, window.location.href).origin === window.location.origin;
  useEffect(() => {
    if (!self) window.location.replace(target);
  }, [self, target]);
  if (self) {
    return (
      <div className="behallare sektion">
        <Notice kind="fel" title={t("errors.SURFACE_NOT_CONFIGURED")} />
      </div>
    );
  }
  return <div className="behallare sektion"><Skeleton lines={3} /></div>;
}
