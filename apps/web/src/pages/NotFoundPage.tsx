import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="behallare sektion stack-4">
      <h1 className="t-rubrik-2">{t("common.not_found_title")}</h1>
      <p className="t-brodtext">{t("common.not_found_body")}</p>
      <Link className="mid-knapp mid-knapp-sekundar" to="/">{t("common.to_start")}</Link>
    </div>
  );
}
