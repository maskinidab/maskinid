import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorNotice, Notice, PageHeader } from "../../../components/Feedback";
import { Icon } from "../../../components/Icon";
import { MachineHit, MachineLookupForm, useMachineLookup } from "../encumbrances/NewEncumbrancePage";
import { InspectionDialog } from "../machines/ServiceTab";

/** Accredited inspection body records an inspection directly on a machine (SPEC §7.1, §4.6). */
export function InspectionNewPage() {
  const { t } = useTranslation();
  const { busy, error, hits, lookup } = useMachineLookup();
  const [machine, setMachine] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("inspection_new.title")} lead={t("inspection_new.lead")} />
      {done && <Notice kind="ok" title={t("inspection_new.done")} />}
      <MachineLookupForm onLookup={(q) => { setDone(false); void lookup(q); }} busy={busy} />
      {error != null && <ErrorNotice error={error} />}
      {hits && hits.length === 0 && <EmptyState icon="sok" title={t("check.not_found")} />}
      {hits?.map((m) => (
        <MachineHit key={m.id} m={m}>
          {!m.technical?.has_lifting_device && <p className="t-liten t-sekundar">{t("inspection_new.no_lifting")}</p>}
          <div><button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setMachine(m.id)}><Icon name="sigill" />{t("service.add_inspection")}</button></div>
        </MachineHit>
      ))}
      {machine && <InspectionDialog machineId={machine} onClose={() => { setMachine(null); setDone(true); }} />}
    </div>
  );
}
