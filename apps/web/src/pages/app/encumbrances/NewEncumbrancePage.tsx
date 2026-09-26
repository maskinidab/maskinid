import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { EmptyState, ErrorNotice, Notice, PageHeader } from "../../../components/Feedback";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { ScanButton } from "../../../components/Scanner";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { rpc } from "../../../lib/api/query";
import type { MachineView } from "../../../lib/api/types";
import { EncumbranceDialog } from "../machines/MachineActions";

/** Look up a machine (exact) – used by "Registrera förbehåll", "Begär ägarbyte" and "Rapportera fel". */
export function useMachineLookup() {
  const { orgId } = useOrg();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hits, setHits] = useState<MachineView[] | null>(null);
  async function lookup(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setHits(await rpc<MachineView[]>("lookup_machine", { p_org_id: orgId, p_query: q.trim() }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, hits, lookup };
}

export function MachineLookupForm({ initial = "", onLookup, busy }: { initial?: string; onLookup(q: string): void; busy: boolean }) {
  const { t } = useTranslation();
  const [q, setQ] = useState(initial);
  return (
    <form className="panel stack-3" onSubmit={(e) => { e.preventDefault(); onLookup(q); }}>
      <label className="mid-etikett" htmlFor="maskinsok">{t("encumbrance_new.query")}</label>
      <div className="mid-sok-rad">
        <input id="maskinsok" className="mid-input is-id" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        <button type="submit" className="mid-knapp mid-knapp-sekundar" disabled={busy}><Icon name="sok" />{t("common.search")}</button>
      </div>
      <div><ScanButton onResult={(r) => { const v = r.kind === "reg" ? r.reg : r.code; setQ(v); onLookup(v); }} /></div>
    </form>
  );
}

export function MachineHit({ m, children }: { m: MachineView; children?: React.ReactNode }) {
  return (
    <article className="mid-post stack-2">
      <RegNumber value={m.reg_number} framed />
      <strong>{m.make} {m.model}{m.year ? ` · ${m.year}` : ""}</strong>
      <div className="badge-rad">
        <MachineStatusBadge status={m.status} />
        <VerificationBadge level={m.verification_level} />
        {m.financing && <FinancingBadge hasActive={m.financing.has_active} />}
      </div>
      {m.owner && <p className="t-liten">{m.owner.name}</p>}
      {children}
    </article>
  );
}

/** Financier: register an encumbrance on a machine found by exact lookup (SPEC §6.6 step 4). */
export function NewEncumbrancePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { busy, error, hits, lookup } = useMachineLookup();
  const [picked, setPicked] = useState<MachineView | null>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("actions.encumbrance.title")} lead={t("encumbrance_new.lead")} />
      {done && <Notice kind="ok" title={t("encumbrance_new.done")} />}
      <MachineLookupForm initial={params.get("q") ?? ""} onLookup={(q) => { setDone(false); void lookup(q); }} busy={busy} />
      {error != null && <ErrorNotice error={error} />}
      {hits && hits.length === 0 && <EmptyState icon="sok" title={t("check.not_found")} body={t("encumbrance_new.not_found_body")} />}
      {hits?.map((m) => (
        <MachineHit key={m.id} m={m}>
          {m.financing?.has_active ? <p className="mid-fel">{t("errors.ACTIVE_ENCUMBRANCE_EXISTS", { holder: m.financing.active?.holder.name ?? "" })}</p> : (
            <div><button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setPicked(m)}><Icon name="hanglas" />{t("actions.encumbrance.submit")}</button></div>
          )}
        </MachineHit>
      ))}
      {picked && <EncumbranceDialog m={picked} open onClose={() => { setPicked(null); setDone(true); }} />}
    </div>
  );
}
