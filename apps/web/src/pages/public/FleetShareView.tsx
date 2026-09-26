import { useTranslation } from "react-i18next";

/** Shared fleet/procurement report or project list (filled in by step 12). */
export function FleetShareView({ share }: { share: { shared_by: string; data: unknown } }) {
  const { t } = useTranslation();
  return (
    <div className="behallare sektion stack-4">
      <h1 className="t-rubrik-2">{t("enum.document_type.fleet_report")}</h1>
      <p>{share.shared_by}</p>
    </div>
  );
}
