import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../auth/OrgContext";
import { rpc } from "../lib/api/query";
import { EmptyState, ErrorNotice } from "./Feedback";
import { FormField } from "./FormField";
import { Icon } from "./Icon";
import { RegNumber } from "./RegNumber";
import { StatusBadge } from "./StatusBadge";

interface Hit { id: string; reg_number: string; make: string; model: string; year: number | null; category: string; flagged: boolean; match: string | null; match_type: string | null }

/** Partial search (step 24): ≥ 5 characters of a serial or reg number, e.g. a worn nameplate. Masked candidates only. */
export function PartialSearch({ onPick }: { onPick(reg: string): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const clean = q.replace(/[\s-]/g, "");
  async function search() {
    setBusy(true); setError(null);
    try { setHits(await rpc<Hit[]>("partial_search", { p_org_id: orgId, p_query: clean })); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack-4">
      <form className="panel stack-3" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <FormField label={t("partial.label")} hint={t("partial.hint")}>
          <input className="mid-input is-id" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </FormField>
        <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy || clean.length < 5}><Icon name="sok" />{t("partial.submit")}</button></div>
        <p className="t-liten t-sekundar">{t("partial.privacy")}</p>
      </form>
      {!!error && <ErrorNotice error={error} />}
      {hits && (hits.length === 0 ? <EmptyState icon="sok" title={t("partial.none")} body={t("partial.none_body")} /> : (
        <ul className="radlista">
          {hits.map((h) => (
            <li key={h.id}>
              <span className="stack-1">
                <span><RegNumber value={h.reg_number} /> · {h.make} {h.model}{h.year ? ` · ${h.year}` : ""} {h.flagged && <StatusBadge kind="sparr">{t("partial.flagged")}</StatusBadge>}</span>
                {h.match && <span className="t-liten t-sekundar">{t(`partial.match_${h.match_type === "reg" ? "reg" : "serial"}`)}: <span className="mid-id">{h.match}</span></span>}
              </span>
              <button type="button" className="mid-knapp mid-knapp-liten mid-knapp-sekundar" onClick={() => onPick(h.reg_number)}>{t("partial.check")}</button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
