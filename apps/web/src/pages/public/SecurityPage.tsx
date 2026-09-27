import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { APP_NAME, SECURITY_EMAIL } from "@maskinid/shared/config.ts";
import { ErrorNotice, Notice, Skeleton } from "../../components/Feedback";
import { useRpc } from "../../lib/api/query";
import { backend } from "../../lib/backend";
import { formatDate } from "../../lib/format";

interface Anchor { day: string; first_seq: number | null; last_seq: number; event_count: number; root_hash: string; chain_hash: string | null; published_at: string | null; external_ref: string | null }

/** /security – how the register protects history, the daily hash anchors and responsible disclosure (SPEC §11.4, §11.8). */
export function SecurityPage() {
  const { t } = useTranslation();
  const anchors = useRpc<Anchor[]>("list_event_anchors", { p_limit: 30 });
  const [result, setResult] = useState<Record<string, { ok: boolean; computed_root: string } | Error>>({});
  async function verify(day: string) {
    try {
      const r = await backend.rpc<{ ok: boolean; computed_root: string }>("verify_anchor", { p_day: day });
      setResult((s) => ({ ...s, [day]: r }));
    } catch (e) {
      setResult((s) => ({ ...s, [day]: e as Error }));
    }
  }
  return (
    <div className="behallare sektion stack-7 smal-bred">
      <div className="stack-3">
        <h1 className="t-rubrik-1">{t("securitypage.title")}</h1>
        <p className="t-ingress">{t("securitypage.lead", { app: APP_NAME })}</p>
      </div>
      <section className="stack-3">
        <h2 className="t-rubrik-3">{t("securitypage.history_title")}</h2>
        <p className="t-brodtext">{t("securitypage.history_body")}</p>
        <pre className="kodblock">sha256(prev_hash|seq|id|type|machine_id|org_id|actor_type|actor_user_id|actor_org_id|payload|created_at)</pre>
        <p className="t-brodtext">{t("securitypage.anchor_body")}</p>
      </section>
      <section className="stack-3" aria-labelledby="ankare">
        <h2 id="ankare" className="t-rubrik-3">{t("securitypage.anchors_title")}</h2>
        {anchors.isLoading ? <Skeleton /> : anchors.error ? <ErrorNotice error={anchors.error} /> : !anchors.data?.length ? <p>{t("common.empty")}</p> : (
          <div className="mid-tabell-wrap">
            <table className="mid-tabell">
              <caption className="visually-hidden">{t("securitypage.anchors_title")}</caption>
              <thead><tr><th>{t("common.date")}</th><th>{t("securitypage.events")}</th><th>{t("securitypage.root")}</th><th>{t("securitypage.published")}</th><th /></tr></thead>
              <tbody>
                {anchors.data.map((a) => {
                  const r = result[a.day];
                  return (
                    <tr key={a.day}>
                      <td>{formatDate(a.day)}</td>
                      <td>{a.event_count}</td>
                      <td className="mid-id" title={a.root_hash}>{a.root_hash.slice(0, 16)}…</td>
                      <td>{a.external_ref?.startsWith("http") ? <a href={a.external_ref} rel="noreferrer" target="_blank">{t("securitypage.commit")}</a> : a.published_at ? formatDate(a.published_at) : "–"}</td>
                      <td>
                        {r instanceof Error ? <span className="mid-fel">{t("errors.UNKNOWN")}</span>
                          : r ? <span className={r.ok ? "t-liten" : "mid-fel"}>{r.ok ? t("securitypage.verified_ok") : t("securitypage.verified_bad")}</span>
                            : <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void verify(a.day)}>{t("securitypage.verify")}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="stack-3">
        <h2 className="t-rubrik-3">{t("securitypage.data_title")}</h2>
        <ul className="t-brodtext stack-2">
          {["data_eu", "data_rls", "data_pnr", "data_backups", "data_sla", "data_exit", "data_pentest"].map((k) => <li key={k}>{t(`securitypage.${k}`)}</li>)}
        </ul>
      </section>
      <section className="stack-3">
        <h2 className="t-rubrik-3">{t("securitypage.disclosure_title")}</h2>
        <p className="t-brodtext">{t("securitypage.disclosure_body")}</p>
        <Notice title={SECURITY_EMAIL}><p className="t-liten"><a className="mid-lank" href="/.well-known/security.txt">security.txt</a></p></Notice>
      </section>
      <p><Link className="mid-lank" to="/legal/privacy">{t("public.privacy")}</Link></p>
    </div>
  );
}
