import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { ChecklistItems, CheckResultBadge, useChecklistAnswers, type ChecklistTemplate, type CheckResult } from "../../../components/ChecklistForm";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { MachinePhoto } from "../../../components/MachinePhoto";
import { OcrCapture, OcrError, useOcr } from "../../../components/OcrCapture";
import { RegNumber } from "../../../components/RegNumber";
import { ScanButton, type ScanResult } from "../../../components/Scanner";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import { isApiError } from "../../../lib/backend";
import { formatDate, formatDateTime } from "../../../lib/format";
import type { MachineView, PayoffRequest, Transfer } from "../../../lib/api/types";

interface Lookup {
  machine: MachineView;
  financing: { has_active: boolean; type: string | null; holder: string | null; has_pending: boolean; pending_holder: string | null };
  payoff: PayoffRequest | null;
  history: { type: string; created_at: string }[];
  open_transfer: Transfer | null;
  is_owner: boolean;
}

interface TradeInCheck {
  id: string; machine_id: string | null; reg_number: string | null; make: string | null; model: string | null;
  serial_text: string | null; result: CheckResult; created_at: string; template_name: string;
  hours: number | null; note: string | null; by: string | null;
}

type Entry = "serial" | "label" | "photo";

/**
 * Inbytestest: the dealer's own check of a machine before taking it in trade (ADR 0031).
 *
 * "Där ska handlaren kunna fylla i eller scanna serienumret på maskinen och sedan få upp samma kontrollpunkter,
 *  texter och bockrutor som idag finns under 'Daglig kontroll'."
 *
 * Same checklists, same texts, same tick boxes — rendered by the same component as Daglig kontroll. What differs
 * is everything around it: the machine belongs to someone else (or is not in the register at all), the result is
 * the dealer's own and the owner never sees it, and a failed critical item is a reason to adjust the price rather
 * than to take the machine out of service.
 */
export function TradeInCheckPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "new";
  return (
    <div className="stack-6">
      <PageHeader title={t("nav.tradein_check")} lead={t("tradein_check.lead")} />
      <Tabs label={t("nav.tradein_check")} value={tab} onChange={(x) => setParams({ tab: x }, { replace: true })}
        tabs={[{ id: "new", label: t("tradein_check.tab_new") }, { id: "history", label: t("tradein_check.tab_history") }]} />
      {tab === "new" && <NewCheck />}
      {tab === "history" && <History />}
    </div>
  );
}

function NewCheck() {
  const { t, i18n } = useTranslation();
  const { orgId, path, canWrite } = useOrg();
  const [entry, setEntry] = useState<Entry>("serial");
  const [serial, setSerial] = useState("");
  const [reg, setReg] = useState("");
  const [data, setData] = useState<Lookup | null>(null);
  // A machine nobody has registered is the normal case for a trade-in candidate, not an error: the appraisal is
  // saved against the serial the dealer scanned or typed.
  const [unknown, setUnknown] = useState<string | null>(null);
  const [labelCode, setLabelCode] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<unknown>(null);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [done, setDone] = useState<{ result: CheckResult; failed_items: string[] } | null>(null);
  const list = useChecklistAnswers();
  const ocr = useOcr("ocr-nameplate");

  const machineId = data?.machine.id ?? null;
  const templates = useRpc<ChecklistTemplate[]>("list_checklist_templates",
    data || unknown ? { p_org_id: orgId, p_machine_id: machineId } : null);
  const tpl = templates.data?.find((x) => x.id === templateId) ?? templates.data?.[0];
  const missing = tpl ? list.missing(tpl.items) : 0;
  const submit = useRpcMutation<Record<string, unknown>, { result: CheckResult; failed_items: string[] }>(
    "submit_tradein_check", { onSuccess: (r) => setDone(r) });

  function reset() {
    setData(null);
    setUnknown(null);
    setLabelCode(null);
    setLookupError(null);
    setDone(null);
    setHours("");
    setNote("");
    setTemplateId("");
    list.reset();
  }

  async function lookup(q: { code?: string; reg?: string; serial?: string }) {
    reset();
    setLabelCode(q.code ?? null);
    try {
      setData(await rpc<Lookup>("trade_in_lookup", {
        p_org_id: orgId, p_code: q.code ?? null, p_reg: q.reg ?? null, p_serial: q.serial ?? null,
      }));
    } catch (e) {
      if (isApiError(e, "NOT_FOUND") && (q.serial || q.code)) setUnknown(q.serial ?? q.code ?? null);
      else setLookupError(e);
    }
  }

  async function readNameplate(file: File) {
    const s = await ocr.read(file);
    const found = typeof s?.serial === "string" ? s.serial : typeof s?.pin === "string" ? s.pin : null;
    if (!found) return;
    setSerial(found);
    await lookup({ serial: found });
  }

  if (done) {
    return (
      <section className="panel stack-4 smal-bred" aria-live="polite">
        <Notice kind={done.result === "failed" ? "fel" : done.result === "remarks" ? "info" : "ok"} title={t(`tradein_check.done.${done.result}`)}>
          <p>{t("tradein_check.done_body")}</p>
        </Notice>
        <div className="mid-rad">
          {data && !data.is_owner && !data.open_transfer && canWrite && (
            <Link className="mid-knapp mid-knapp-primar" to={path("trade-in")}>
              <Icon name="pil-hoger" />{t("dealer.request_trade_in")}
            </Link>
          )}
          <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => { reset(); setSerial(""); setReg(""); }}>
            {t("tradein_check.next")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="stack-5 smal-bred">
      <section className="panel stack-3">
        <div className="mid-val">
          {(["serial", "label", "photo"] as const).map((x) => (
            <label key={x}>
              <input type="radio" checked={entry === x} onChange={() => setEntry(x)} />
              <span>{t(`tradein_check.by_${x}`)}</span>
            </label>
          ))}
        </div>

        {entry === "serial" && (
          <form className="stack-2" onSubmit={(e) => { e.preventDefault(); void lookup({ serial }); }}>
            <FormField label={t("dealer.trade_in_serial_label")} hint={t("tradein_check.serial_hint")}>
              <input className="mid-input is-id" value={serial} onChange={(e) => setSerial(e.target.value)}
                autoCapitalize="characters" autoComplete="off" spellCheck={false} />
            </FormField>
            <div>
              <button type="submit" className="mid-knapp mid-knapp-primar" disabled={serial.replace(/[\s-]/g, "").length < 4}>
                <Icon name="sok" />{t("common.search")}
              </button>
            </div>
          </form>
        )}

        {entry === "label" && (
          <>
            <ScanButton tone="primar" onResult={(r: ScanResult) => void lookup(r.kind === "label" ? { code: r.code } : { reg: r.reg })} />
            <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); void lookup({ reg }); }}>
              <input className="mid-input is-id" aria-label={t("dealer.reg_or_scan")} placeholder="XXX-XXXX" value={reg}
                onChange={(e) => setReg(e.target.value)} autoCapitalize="characters" spellCheck={false} />
              <button type="submit" className="mid-knapp mid-knapp-sekundar"><Icon name="sok" />{t("common.search")}</button>
            </form>
          </>
        )}

        {entry === "photo" && (
          <>
            <p className="t-brodtext">{t("dealer.trade_in_photo_lead")}</p>
            <OcrCapture fn="ocr-nameplate" camera busy={ocr.busy} label={t("tradein_check.by_photo")} busyLabel={t("wizard.reading")} onFile={readNameplate} />
            <OcrError error={ocr.error} title={t("wizard.ocr_failed")} />
            {serial && <p className="t-liten">{t("dealer.trade_in_serial_label")}: <strong className="mid-id">{serial}</strong></p>}
          </>
        )}
      </section>

      {lookupError != null && <ErrorNotice error={lookupError} />}

      {unknown && (
        <Notice kind="info" title={t("tradein_check.unknown_machine")}>
          <p>{t("tradein_check.unknown_machine_body", { serial: unknown })}</p>
        </Notice>
      )}

      {data && (
        <section className="panel stack-3" aria-labelledby="inbytestest-maskin">
          <div className="maskin-huvud">
            <MachinePhoto path={data.machine.primary_photo_path} category={data.machine.category} size={96} />
            <div className="stack-2">
              <div><RegNumber value={data.machine.reg_number} framed /></div>
              <h2 id="inbytestest-maskin" className="t-rubrik-4">
                {data.machine.make} {data.machine.model}{data.machine.year ? ` · ${data.machine.year}` : ""}
              </h2>
              <div className="badge-rad">
                <MachineStatusBadge status={data.machine.status} />
                <VerificationBadge level={data.machine.verification_level} />
                <FinancingBadge hasActive={data.financing.has_active} pending={data.financing.has_pending}
                  pendingHolder={data.financing.pending_holder ?? undefined} />
              </div>
              {data.financing.has_active && (
                <p className="t-liten">{t("dealer.trade_in_financing", {
                  holder: data.financing.holder ?? "", type: t(`enum.encumbrance_type.${data.financing.type}`) })}</p>
              )}
            </div>
          </div>
          {!!data.history.length && (
            <ol className="mid-historik">
              {data.history.slice(0, 8).map((h, i) => (
                <li key={i}>
                  <time dateTime={h.created_at}>{formatDate(h.created_at)}</time>
                  <p>{i18n.exists(`dealer.history.${h.type}`) ? t(`dealer.history.${h.type}`) : h.type}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {(data || unknown) && templates.isLoading && <Skeleton lines={5} />}
      {(data || unknown) && tpl && (
        <form className="stack-5" onSubmit={(e) => {
          e.preventDefault();
          if (!tpl || missing) return;
          submit.mutate({
            p_org_id: orgId, p_template_id: tpl.id, p_answers: list.payload(tpl.items),
            p_machine_id: machineId, p_serial: data ? null : unknown, p_label_code: labelCode,
            p_hours: hours ? Number(hours.replace(/\s/g, "")) : null, p_note: note || null,
          });
        }}>
          {(templates.data?.length ?? 0) > 1 && (
            <FormField label={t("daily.template")}>
              <select className="mid-select" value={tpl.id} onChange={(e) => { setTemplateId(e.target.value); list.reset(); }}>
                {templates.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </FormField>
          )}
          <FormField label={t("machine.hours")} optional hint={t("tradein_check.hours_hint")}>
            <input className="mid-input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
          </FormField>
          <ChecklistItems items={tpl.items} answers={list.answers} set={list.set} legend={tpl.name} />
          <FormField label={t("tradein_check.note")} optional hint={t("tradein_check.note_hint")}>
            <textarea className="mid-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          {submit.error && <ErrorNotice error={submit.error} />}
          <div className="mid-rad">
            <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!!missing || submit.isPending || !canWrite}>
              {missing ? t("daily.missing", { count: missing }) : t("tradein_check.submit")}
            </button>
            <button type="button" className="mid-knapp mid-knapp-text" onClick={() => list.allOk(tpl.items)}>{t("daily.all_ok")}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function History() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const q = useRpc<TradeInCheck[]>("list_tradein_checks", { p_org_id: orgId, p_limit: 300 });
  if (q.isLoading) return <Skeleton lines={6} />;
  if (q.error) return <ErrorNotice error={q.error} />;
  return (
    <DataTable caption={t("tradein_check.tab_history")} rows={q.data!} getKey={(c) => c.id} exportName="inbytestester"
      empty={<EmptyState icon="bock" title={t("tradein_check.none")} />}
      filters={[{
        id: "result", label: t("daily.result_label"),
        options: (["ok", "remarks", "failed"] as const).map((r) => ({ value: r, label: t(`daily.result.${r}`) })),
        match: (c, v) => c.result === v,
      }]}
      columns={[
        { id: "at", header: t("admin.health.when"), value: (c) => c.created_at, sortable: true, cell: (c) => formatDateTime(c.created_at) },
        {
          id: "machine", header: t("machines.col_machine"), value: (c) => c.reg_number ?? c.serial_text ?? "",
          cell: (c) => (c.machine_id && c.reg_number
            ? <><Link to={path(`machines/${c.machine_id}`)}><RegNumber value={c.reg_number} /></Link><br /><span className="t-liten">{c.make} {c.model}</span></>
            // A machine that was not in the register when it was appraised has only the serial the dealer entered.
            : <span className="mid-id">{c.serial_text}</span>),
        },
        { id: "result", header: t("daily.result_label"), value: (c) => c.result, cell: (c) => <CheckResultBadge result={c.result} /> },
        { id: "hours", header: t("machine.hours"), value: (c) => c.hours ?? 0, hideOnMobile: true, cell: (c) => (c.hours == null ? "–" : `${c.hours} h`) },
        { id: "who", header: t("admin.health.who"), value: (c) => c.by ?? "", hideOnMobile: true, cell: (c) => c.by ?? "–" },
        { id: "note", header: t("tradein_check.note"), value: (c) => c.note ?? "", hideOnMobile: true, cell: (c) => c.note ?? "–" },
      ]} />
  );
}
