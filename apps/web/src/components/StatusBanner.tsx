import { useTranslation } from "react-i18next";
import type { MachineStatus } from "../lib/api/types";
import { Icon } from "./Icon";

/**
 * Banner for any status other than active (SPEC §5.3, §9.4). Stolen is red and – on the public scan page –
 * full-screen with the police number.
 */
export function StatusBanner({ status, fullscreen = false, children }: { status: MachineStatus; fullscreen?: boolean; children?: React.ReactNode }) {
  const { t } = useTranslation();
  if (status === "active") return null;
  const red = status === "stolen" || status === "blocked" || status === "disputed";
  const title = t(`components.status_banner.${status}_title`);
  const body =
    status === "stolen" ? t("components.status_banner.stolen_body")
      : status === "blocked" ? t("components.status_banner.blocked_body")
        : status === "disputed" ? t("components.status_banner.disputed_body")
          : status === "draft" ? "" : t("components.status_banner.read_only");
  return (
    <div className={["statusbanner", red ? "statusbanner-rod" : "statusbanner-gra", fullscreen && status === "stolen" ? "statusbanner-helskarm" : ""].join(" ")}
      role={red ? "alert" : "status"}>
      <div className="statusbanner-inre">
        <Icon name={red ? "varning" : "info"} />
        <div>
          <strong>{title}</strong>
          {body && <p>{body}</p>}
          {status === "stolen" && (
            <a className="mid-knapp statusbanner-knapp" href="tel:11414">{t("public.call_police")}</a>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
