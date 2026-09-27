import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { APP_NAME } from "@maskinid/shared/config.ts";
import { Icon, type IconName } from "../../components/Icon";
import { RegNumber } from "../../components/RegNumber";
import { ScanButton } from "../../components/Scanner";
import { Skeleton } from "../../components/Feedback";
import { useRpc } from "../../lib/api/query";
import { dataSource } from "../../lib/backend";
import { PublicLookup } from "./PublicLookup";

const ACTORS: { key: string; icon: IconName }[] = [
  { key: "dealer", icon: "tagg" }, { key: "owner", icon: "bygg" }, { key: "financier", icon: "bank" }, { key: "insurer", icon: "skold" },
  { key: "authority", icon: "flagga" }, { key: "marketplace", icon: "lank" }, { key: "inspector", icon: "sigill" }, { key: "client", icon: "diagram" },
];

function DemoShortcuts() {
  const { t } = useTranslation();
  const q = useRpc<{ kind: string; reg_number: string; code: string | null }[]>("demo_shortcuts", {});
  // The browser demo always has shortcuts: keep their place while the in-browser register boots (no layout shift).
  const pending = q.isLoading && dataSource === "local";
  if (!pending && !q.data?.length) return null;
  return (
    <section className="sektion-liten sektion-yta2" aria-labelledby="demo-genvagar">
      <div className="behallare stack-4">
        <h2 id="demo-genvagar" className="t-rubrik-3">{t("public.demo_title")}</h2>
        {pending ? <div className="demo-genvagar-plats"><Skeleton lines={2} height={40} /></div> : <ul className="handlingar">
          {(q.data ?? []).map((d) => (
            <li key={d.kind}>
              <Link className="handling" to={d.code ? `/m/${d.code}` : `/r/${d.reg_number}`}>
                <strong><Icon name={d.kind === "stolen" ? "varning" : "qr"} />{t(`public.demo_${d.kind}`)}</strong>
                <span><RegNumber value={d.reg_number} /></span>
              </Link>
            </li>
          ))}
        </ul>}
      </div>
    </section>
  );
}

/** Landing page (SPEC §9.1): what the register is, public lookup + scan, value per actor, how it works. */
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
          <aside className="fakta-kort stack-3" aria-label={t("public.facts_label")}>
            <p className="t-rubrik-4">{t("public.facts_title")}</p>
            <ul className="stack-2">
              {["fact_free", "fact_independent", "fact_no_amounts", "fact_history"].map((k) => (
                <li key={k} className="fakta-rad"><Icon name="bock" /><span>{t(`public.${k}`)}</span></li>
              ))}
            </ul>
          </aside>
        </div>
      </section>
      <DemoShortcuts />
      <section className="sektion">
        <div className="behallare stack-6">
          <h2 className="t-rubrik-2">{t("public.how_title")}</h2>
          <ol className="steg">
            {[1, 2, 3].map((n) => (
              <li key={n}><h3 className="t-rubrik-4">{t(`public.step${n}_title`)}</h3><p className="t-brodtext">{t(`public.step${n}_body`)}</p></li>
            ))}
          </ol>
        </div>
      </section>
      <section className="sektion sektion-yta2">
        <div className="behallare stack-6">
          <h2 className="t-rubrik-2">{t("public.actors_title")}</h2>
          <div className="aktorer aktorer-4">
            {ACTORS.map((a) => (
              <div key={a.key} className="stack-2">
                <Icon name={a.icon} className="aktor-ikon" />
                <h3 className="t-rubrik-4">{t(`enum.org_type.${a.key}`)}</h3>
                <p className="t-liten">{t(`public.value_${a.key}`)}</p>
              </div>
            ))}
          </div>
          <div className="mid-rad">
            <Link className="mid-knapp mid-knapp-primar" to="/onboarding/dealer">{t("public.cta_dealer")}</Link>
            <Link className="mid-knapp mid-knapp-kontur" to="/how">{t("nav.how_it_works")}</Link>
          </div>
        </div>
      </section>
    </>
  );
}
