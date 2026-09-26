import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorNotice, Notice } from "../../../components/Feedback";
import { Icon } from "../../../components/Icon";
import { useRpc, useRpcMutation } from "../../../lib/api/query";
import { formatDate, formatNumber } from "../../../lib/format";

interface Candidate {
  id: string; make: string; model: string; year: number; hours: number | null; category: string | null;
  serial: string; url: string | null; source: string; last_seen_at: string;
}

/**
 * "Vi hittade N maskiner som ni annonserat" (SPEC §8.4): unregistered machines the org advertises (seller org number
 * matches) become prefilled drafts at level 0 – the org still reviews and signs each registration.
 */
export function MarketCandidates({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const q = useRpc<Candidate[]>("list_market_candidates", { p_org_id: orgId });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const create = useRpcMutation<{ p_org_id: string; p_observation_ids: string[] }, { drafts: number }>("create_drafts_from_candidates", {
    onSuccess: (r) => { setDone(r.drafts); setOpen(false); setPicked(null); },
  });
  const items = q.data ?? [];
  if (done !== null) return <Notice kind="ok" title={t("market.candidates_created", { count: done })} />;
  if (!items.length) return null;
  const sel = picked ?? new Set(items.map((c) => c.id));
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setPicked(n);
  };
  return (
    <section className="panel panel-register stack-3" aria-labelledby="kandidater">
      <h2 id="kandidater" className="t-rubrik-4"><Icon name="sok" className="ikon-inline" /> {t("market.candidates_title", { count: items.length })}</h2>
      <p className="t-liten">{t("market.candidates_lead")}</p>
      {!open ? (
        <div><button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" onClick={() => setOpen(true)}>{t("market.candidates_review")}</button></div>
      ) : (
        <>
          <ul className="radlista">
            {items.map((c) => (
              <li key={c.id}>
                <label className="mid-kryss">
                  <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                  <span><strong>{c.make} {c.model}</strong> · {c.year}{c.hours !== null ? ` · ${formatNumber(c.hours)} h` : ""}
                    <br /><span className="t-liten t-sekundar"><span className="mid-id">{c.serial}</span> · {t("market.candidate_seen", { source: c.source, date: formatDate(c.last_seen_at) })}</span></span>
                </label>
                {c.url && <a className="mid-lank t-liten" href={c.url} target="_blank" rel="noopener noreferrer nofollow">{t("machine.market_open")}</a>}
              </li>
            ))}
          </ul>
          {create.error && <ErrorNotice error={create.error} />}
          <div className="mid-rad">
            <button type="button" className="mid-knapp mid-knapp-primar" disabled={!sel.size || create.isPending}
              onClick={() => create.mutate({ p_org_id: orgId, p_observation_ids: [...sel] })}>
              {t("market.candidates_create", { count: sel.size })}
            </button>
            <button type="button" className="mid-knapp mid-knapp-text" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
          </div>
        </>
      )}
    </section>
  );
}
