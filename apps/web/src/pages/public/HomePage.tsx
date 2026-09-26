import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { APP_NAME } from "@maskinid/shared/config.ts";
import { ScanButton } from "../../components/Scanner";
import { PublicLookup } from "./PublicLookup";

/** Landing page: what the register is, public lookup and scan (full version in step 9). */
export function HomePage() {
  const { t } = useTranslation();
  return (
    <>
      <section className="hjalte">
        <div className="behallare hjalte-inre">
          <div className="stack-5">
            <h1 className="t-display">{t("public.hero_title", { app: APP_NAME })}</h1>
            <p className="t-ingress">{t("public.hero_lead")}</p>
            <PublicLookup />
            <div className="mid-rad">
              <ScanButton tone="sekundar" />
              <Link className="mid-knapp mid-knapp-kontur" to="/signup">{t("public.register_free")}</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
