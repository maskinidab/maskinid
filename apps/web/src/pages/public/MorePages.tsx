import { APP_LEGAL_NAME, APP_NAME } from "@maskinid/shared/config.ts";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ErrorNotice, Skeleton } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { StatusBadge } from "../../components/StatusBadge";
import { useRpc } from "../../lib/api/query";
import { formatDate, formatDateTime } from "../../lib/format";

export const SEGMENTS = ["agare", "handlare", "finansiarer", "forsakring", "myndigheter"] as const;
type Segment = (typeof SEGMENTS)[number];

/** /for/:segment – what the register does for owners, dealers, lenders, insurers and authorities (step 25). */
export function SegmentPage() {
  const { t } = useTranslation();
  const { segment } = useParams();
  const s = (SEGMENTS as readonly string[]).includes(segment ?? "") ? (segment as Segment) : "agare";
  return (
    <div className="behallare sektion stack-7 smal-bred">
      <nav aria-label={t("segments.nav")} className="mid-rad">
        {SEGMENTS.map((x) => <Link key={x} className={`mid-knapp mid-knapp-liten ${x === s ? "mid-knapp-sekundar" : "mid-knapp-kontur"}`} to={`/for/${x}`}
          aria-current={x === s ? "page" : undefined}>{t(`segments.${x}.short`)}</Link>)}
      </nav>
      <div className="stack-3">
        <h1 className="t-rubrik-1">{t(`segments.${s}.title`)}</h1>
        <p className="t-ingress">{t(`segments.${s}.lead`, { app: APP_NAME })}</p>
      </div>
      {[1, 2, 3, 4].map((n) => (
        <section key={n} className="stack-2">
          <h2 className="t-rubrik-3">{t(`segments.${s}.p${n}_title`)}</h2>
          <p className="t-brodtext">{t(`segments.${s}.p${n}_body`, { app: APP_NAME })}</p>
        </section>
      ))}
      <div className="mid-rad">
        <Link className="mid-knapp mid-knapp-primar" to="/login">{t(`segments.${s}.cta`)}</Link>
        <Link className="mid-knapp mid-knapp-kontur" to="/pricing">{t("nav.pricing")}</Link>
      </div>
    </div>
  );
}

/** /about – who runs the register and on what principles. */
export function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className="behallare sektion stack-7 smal-bred">
      <div className="stack-3">
        <h1 className="t-rubrik-1">{t("about.title", { app: APP_NAME })}</h1>
        <p className="t-ingress">{t("about.lead", { app: APP_NAME, legal: APP_LEGAL_NAME })}</p>
      </div>
      {(["independent", "no_amounts", "privacy", "history", "continuity"] as const).map((k) => (
        <section key={k} className="stack-2">
          <h2 className="t-rubrik-3">{t(`about.${k}_title`)}</h2>
          <p className="t-brodtext">{t(`about.${k}_body`, { app: APP_NAME })}</p>
        </section>
      ))}
      <p><Link className="mid-lank" to="/contact">{t("help.contact")}</Link></p>
    </div>
  );
}

/** /integrations – API, telematics, NFC, Transportstyrelsen and Larmtjänst. */
export function IntegrationsPage() {
  const { t } = useTranslation();
  const items = [
    { k: "api", icon: "lank", to: "/api-docs" }, { k: "telematics", icon: "plats" }, { k: "nfc", icon: "qr" },
    { k: "vtr", icon: "sok" }, { k: "theft", icon: "skold" }, { k: "import", icon: "uppladdning" },
  ] as const;
  return (
    <div className="behallare sektion stack-7">
      <div className="stack-3 smal-bred">
        <h1 className="t-rubrik-1">{t("integrations_page.title")}</h1>
        <p className="t-ingress">{t("integrations_page.lead", { app: APP_NAME })}</p>
      </div>
      <div className="plan-rutnat">
        {items.map((i) => (
          <article key={i.k} className="panel stack-2">
            <h2 className="t-rubrik-4"><Icon name={i.icon} className="ikon-inline" /> {t(`integrations_page.${i.k}_title`)}</h2>
            <p className="t-liten">{t(`integrations_page.${i.k}_body`)}</p>
            {"to" in i && <Link className="mid-lank" to={i.to}>{t("integrations_page.read_more")}</Link>}
          </article>
        ))}
      </div>
    </div>
  );
}

interface SystemStatus {
  database: string; demo: boolean; events_last_24h: number; statistics_at: string | null; checked_at: string;
  last_anchor: { day: string; root: string; published_at: string; reference: string | null } | null;
  integrations: Record<string, boolean>;
}

/** /status – live system status and the latest published anchor of the event chain. */
export function StatusPage() {
  const { t } = useTranslation();
  const q = useRpc<SystemStatus>("public_system_status", {}, { refetchInterval: 60_000 });
  return (
    <div className="behallare sektion stack-6 smal-bred">
      <div className="stack-3">
        <h1 className="t-rubrik-1">{t("status.title")}</h1>
        <p className="t-ingress">{t("status.lead")}</p>
      </div>
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} title={t("status.down")} /> : (
        <>
          <section className="panel stack-3">
            <p><StatusBadge kind="verifierad" icon="bock">{t("status.operational")}</StatusBadge></p>
            <dl className="faktarutnat">
              <div><dt>{t("status.register")}</dt><dd>{t("status.ok")}</dd></div>
              <div><dt>{t("status.events_24h")}</dt><dd>{q.data!.events_last_24h}</dd></div>
              <div><dt>{t("status.checked")}</dt><dd>{formatDateTime(q.data!.checked_at)}</dd></div>
              {q.data!.demo && <div><dt>{t("status.mode")}</dt><dd>DEMO</dd></div>}
            </dl>
          </section>
          <section className="panel stack-2" aria-labelledby="ankare">
            <h2 id="ankare" className="t-rubrik-4">{t("status.anchor_title")}</h2>
            {q.data!.last_anchor ? <>
              <p className="t-liten">{t("status.anchor_body", { day: formatDate(q.data!.last_anchor.day) })}</p>
              <p className="mid-id t-liten" style={{ overflowWrap: "anywhere" }}>{q.data!.last_anchor.root}</p>
              {q.data!.last_anchor.reference && <p className="t-liten t-sekundar">{t("status.anchor_ref", { ref: q.data!.last_anchor.reference })}</p>}
            </> : <p className="t-liten">{t("status.no_anchor")}</p>}
            <Link className="mid-lank" to="/security">{t("status.how_verify")}</Link>
          </section>
          <section className="stack-2" aria-labelledby="integrationer">
            <h2 id="integrationer" className="t-rubrik-4">{t("status.integrations")}</h2>
            <ul className="radlista">
              {Object.entries(q.data!.integrations).map(([k, on]) => (
                <li key={k}><span>{t(`status.integration.${k}`)}</span><span className="t-liten">{on ? t("status.on") : t("status.off")}</span></li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
