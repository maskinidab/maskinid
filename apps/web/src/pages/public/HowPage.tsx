import { useTranslation } from "react-i18next";
import { APP_NAME } from "@maskinid/shared/config.ts";
import { VerificationBadge } from "../../components/StatusBadge";

/** "Så fungerar det": registration number, labels, verification levels, what is public (SPEC §3, §5). */
export function HowPage() {
  const { t } = useTranslation();
  return (
    <div className="behallare sektion stack-7 smal-bred">
      <div className="stack-3">
        <h1 className="t-rubrik-1">{t("nav.how_it_works")}</h1>
        <p className="t-ingress">{t("how.lead", { app: APP_NAME })}</p>
      </div>
      {(["regnr", "label", "public", "financing", "theft"] as const).map((k) => (
        <section key={k} className="stack-2">
          <h2 className="t-rubrik-3">{t(`how.${k}_title`)}</h2>
          <p className="t-brodtext">{t(`how.${k}_body`)}</p>
        </section>
      ))}
      <section className="stack-3">
        <h2 className="t-rubrik-3">{t("level.label")}</h2>
        <dl className="definitioner">
          {([0, 1, 2] as const).map((l) => (
            <div key={l} style={{ display: "contents" }}>
              <dt><VerificationBadge level={l} /></dt>
              <dd>{t(`level.${l}.desc`)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="t-liten t-sekundar">{t("how.disclaimer", { app: APP_NAME })}</p>
    </div>
  );
}
