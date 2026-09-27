import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ScannerView, type ScanResult } from "../../components/Scanner";

/** /scan – full-screen scanner (PWA shortcut). */
export function ScanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onResult = useCallback((r: ScanResult) => navigate(r.kind === "label" ? `/m/${r.code}` : `/r/${r.reg}`), [navigate]);
  return (
    <div className="behallare sektion stack-4 smal">
      <h1 className="t-rubrik-2">{t("components.scan_title")}</h1>
      <ScannerView onResult={onResult} />
    </div>
  );
}
