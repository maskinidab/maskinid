import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { PartialSearch } from "../../../components/PartialSearch";
import { DataTable } from "../../../components/DataTable";
import { Dialog } from "../../../components/Dialog";
import { EmptyState, ErrorNotice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { ReceiptCard, type CheckReceipt } from "../../../components/ReceiptCard";
import { RegNumber } from "../../../components/RegNumber";
import { ScanButton, type ScanResult } from "../../../components/Scanner";
import { ApiError } from "../../../lib/backend";
import { FinancingBadge } from "../../../components/StatusBadge";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import type { MachineView } from "../../../lib/api/types";
import { formatDate, formatDateTime } from "../../../lib/format";
import { downloadBytes, receiptPdf } from "../../../lib/pdf/receipt";
import { EncumbranceDialog } from "../machines/MachineActions";

const TYPES = ["any", "reg", "pin", "serial", "vin", "road_reg"] as const;

export function useReceiptPdf() {
  const { t } = useTranslation();
  return async (r: CheckReceipt) => downloadBytes(await receiptPdf(r, t), `kontrollkvitto-${r.receipt_number}.pdf`);
}

/** Parses pasted text or a CSV (one identifier per line, optional "type;value") into check queries. */
export function parseBatch(text: string): { type: string; value: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    const [a, b] = l.split(/[;,\t]/).map((x) => x.trim().replace(/^"|"$/g, ""));
    if (b && (TYPES as readonly string[]).includes(a!.toLowerCase())) return [{ type: a!.toLowerCase(), value: b }];
    if (/^(typ|type|value|värde)$/i.test(a!)) return [];
    return [{ type: "any", value: a! }];
  }).slice(0, 500);
}

/** Financing check (SPEC §6.6): exact search, receipt with number, PDF, and "register encumbrance" from the result. */
export function CheckPage() {
  const { t } = useTranslation();
  const { orgId, has, canWrite } = useOrg();
  const pdf = useReceiptPdf();
  const [tab, setTab] = useState<"single" | "batch" | "partial">("single");
  const [type, setType] = useState<(typeof TYPES)[number]>("any");
  const [value, setValue] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<CheckReceipt | null>(null);
  const [machine, setMachine] = useState<MachineView | null>(null);
  const [encOpen, setEncOpen] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batch, setBatch] = useState<(CheckReceipt & { query?: unknown; error?: string })[] | null>(null);

  async function check(v = value, ty = type) {
    if (!v.trim()) return;
    setBusy(true);
    setError(null);
    setReceipt(null);
    setMachine(null);
    try {
      const r = await rpc<CheckReceipt & { result: { machine_id?: string } }>("perform_check", {
        p_org_id: orgId, p_query: ty === "any" ? { type: "any", value: v.trim() } : { type: ty, value: v.trim() }, p_purpose: purpose || null,
      });
      setReceipt(r);
      if (r.result.found && r.result.machine_id && has("financier")) {
        setMachine(await rpc<MachineView>("get_machine", { p_org_id: orgId, p_machine_id: r.result.machine_id }).catch(() => null));
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // A scanned label resolves to its machine's registration number first (labels are not identifiers).
  async function checkScan(r: ScanResult) {
    let reg = r.kind === "reg" ? r.reg : null;
    if (r.kind === "label") {
      const c = await rpc<{ found: boolean; card?: { reg_number: string } }>("public_machine_card", { p_code: r.code }).catch(() => null);
      reg = c?.found && c.card ? c.card.reg_number : null;
      if (!reg) { setError(new ApiError("LABEL_NOT_FOUND")); return; }
    }
    setType("reg");
    setValue(reg!);
    await check(reg!, "reg");
  }

  async function runBatch() {
    const queries = parseBatch(batchText);
    if (!queries.length) return;
    setBusy(true);
    setError(null);
    try {
      setBatch(await rpc("perform_check_batch", { p_org_id: orgId, p_queries: queries, p_purpose: purpose || null }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-6">
      <PageHeader title={t("check.title")} lead={t("check.lead")} />
      <Tabs label={t("check.title")} value={tab} onChange={(v) => setTab(v as "single" | "batch" | "partial")}
        tabs={[{ id: "single", label: t("check.tab_single") }, { id: "batch", label: t("check.tab_batch") }, { id: "partial", label: t("check.tab_partial") }]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`flik-${tab}`} className="stack-5">
        {tab === "partial" ? (
          <PartialSearch onPick={(reg) => { setTab("single"); setType("reg"); setValue(reg); void check(reg, "reg"); }} />
        ) : tab === "single" ? (
          <form className="panel stack-3" onSubmit={(e) => { e.preventDefault(); void check(); }}>
            <div className="rutnat">
              <FormField className="kol-3" label={t("common.type")}>
                <select className="mid-select" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
                  {TYPES.map((x) => <option key={x} value={x}>{t(`check.type_${x}`)}</option>)}
                </select>
              </FormField>
              <FormField className="kol-9" label={t("check.query")} hint={t("check.query_hint")}>
                <input className="mid-input is-id" value={value} onChange={(e) => setValue(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
              </FormField>
            </div>
            <FormField label={t("check.purpose")} optional hint={t("check.purpose_hint")}>
              <input className="mid-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} />
            </FormField>
            <div className="mid-rad">
              <button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}><Icon name="sok" />{busy ? t("common.loading") : t("check.submit")}</button>
              <ScanButton onResult={(r) => void checkScan(r)} />
            </div>
          </form>
        ) : (
          <form className="panel stack-3" onSubmit={(e) => { e.preventDefault(); void runBatch(); }}>
            <FormField label={t("check.batch_label")} hint={t("check.batch_hint")}>
              <textarea className="mid-textarea is-id" rows={8} value={batchText} onChange={(e) => setBatchText(e.target.value)} spellCheck={false} />
            </FormField>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label={t("check.batch_file")}
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) setBatchText(await f.text()); }} />
            <p className="t-liten t-sekundar">{t("check.batch_count", { count: parseBatch(batchText).length })}</p>
            <div><button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}>{busy ? t("common.loading") : t("check.submit_batch")}</button></div>
          </form>
        )}
        {error != null && <ErrorNotice error={error} />}
        {tab === "single" && receipt && (
          <div className="stack-3">
            <ReceiptCard r={receipt} onPdf={() => void pdf(receipt)} />
            {receipt.result.found && canWrite && receipt.id && <WatchAfterCheck receiptId={receipt.id} />}
            {machine && canWrite && has("financier") && (
              <div className="mid-rad">
                {!receipt.result.has_active_financing && (
                  <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => setEncOpen(true)}><Icon name="hanglas" />{t("actions.encumbrance.title")}</button>
                )}
                {receipt.result.has_active_financing && (
                  <p className="t-liten">{t("check.blocked_hint")}</p>
                )}
              </div>
            )}
            {machine && <EncumbranceDialog m={machine} open={encOpen} onClose={() => setEncOpen(false)} />}
          </div>
        )}
        {tab === "batch" && batch && (
          <DataTable caption={t("check.batch_results")} rows={batch} getKey={(r) => r.receipt_number ?? JSON.stringify(r.query)} exportName="kontroller"
            columns={[
              { id: "receipt", header: t("components.receipt.number"), value: (r) => r.receipt_number, cell: (r) => <span className="mid-id">{r.receipt_number ?? "–"}</span> },
              { id: "reg", header: t("machines.col_reg"), value: (r) => r.result?.reg_number, cell: (r) => r.result?.reg_number ? <RegNumber value={r.result.reg_number} /> : r.error ? t("errors.VALIDATION") : t("check.not_found") },
              { id: "machine", header: t("machines.col_machine"), value: (r) => r.result?.found ? `${r.result.make} ${r.result.model}` : "", cell: (r) => r.result?.found ? `${r.result.make} ${r.result.model}` : "–" },
              { id: "fin", header: t("check.result_financing"), value: (r) => (r.result?.has_active_financing ? "JA" : r.result?.found ? "NEJ" : ""),
                cell: (r) => r.result?.found ? <FinancingBadge hasActive={!!r.result.has_active_financing} /> : "–" },
              { id: "holder", header: t("actions.encumbrance.holder"), value: (r) => r.result?.financing?.holder, cell: (r) => r.result?.financing?.holder ?? "–", hideOnMobile: true },
              { id: "flags", header: t("pdf.flags"), value: (r) => r.result?.flags?.map((f) => f.type).join(" "), cell: (r) => r.result?.flags?.map((f) => t(`enum.flag_type.${f.type}`)).join(", ") || "–", hideOnMobile: true },
            ]} />
        )}
      </div>
    </div>
  );
}

/** Receipts archive (SPEC §9.2 financier): every check with number, PDF on demand. */
export function ReceiptsPage() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const pdf = useReceiptPdf();
  const q = useRpc<(CheckReceipt & { id: string; machine_id: string | null; purpose: string | null; query: { type: string; value: string } })[]>(
    "list_check_receipts", { p_org_id: orgId, p_limit: 500 });
  const [open, setOpen] = useState<CheckReceipt | null>(null);
  return (
    <div className="stack-6">
      <PageHeader title={t("receipts.title")} lead={t("receipts.lead")}
        actions={<Link className="mid-knapp mid-knapp-primar" to={path("check")}><Icon name="sok" />{t("check.title")}</Link>} />
      {q.isLoading ? <Skeleton lines={6} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("receipts.title")} rows={q.data ?? []} getKey={(r) => r.id} exportName="kontrollkvitton"
          empty={<EmptyState icon="kvitto" title={t("receipts.empty")} />}
          columns={[
            { id: "nr", header: t("components.receipt.number"), value: (r) => r.receipt_number,
              cell: (r) => <button type="button" className="mid-lank-knapp mid-lank mid-id" onClick={() => setOpen(r)}>{r.receipt_number}</button> },
            { id: "at", header: t("common.date"), value: (r) => r.created_at, cell: (r) => formatDateTime(r.created_at), sortable: true },
            { id: "q", header: t("check.query"), value: (r) => r.query?.value, cell: (r) => <span className="mid-id">{r.query?.value}</span>, hideOnMobile: true },
            { id: "reg", header: t("machines.col_reg"), value: (r) => r.result.reg_number, cell: (r) => r.result.reg_number ? <RegNumber value={r.result.reg_number} /> : t("check.not_found") },
            { id: "fin", header: t("check.result_financing"), value: (r) => (r.result.found ? (r.result.has_active_financing ? "JA" : "NEJ") : ""),
              cell: (r) => r.result.found ? <FinancingBadge hasActive={!!r.result.has_active_financing} /> : "–" },
            { id: "purpose", header: t("check.purpose"), value: (r) => r.purpose, cell: (r) => r.purpose ?? "–", hideOnMobile: true },
          ]} />
      )}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={t("components.receipt.title")} wide>
        {open && <ReceiptCard r={open} onPdf={() => void pdf(open)} />}
      </Dialog>
    </div>
  );
}

/** Monitoring after a check: the checker is notified of new encumbrances, flags, transfers or listings (step 21). */
function WatchAfterCheck({ receiptId }: { receiptId: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [until, setUntil] = useState<string | null>(null);
  const m = useRpcMutation<{ p_org_id: string; p_receipt_id: string; p_days: number }, { watch: { expires_at: string | null } }>("watch_after_check",
    { onSuccess: (r) => setUntil(r.watch.expires_at ?? "") });
  return (
    <section className="panel stack-2" aria-labelledby="bevaka">
      <h2 id="bevaka" className="t-rubrik-4">{t("risk.watch_title")}</h2>
      {until !== null ? (
        <p role="status"><Icon name="bock" className="ikon-inline" /> {until ? t("risk.watching_until", { date: formatDate(until) }) : t("risk.watching_permanent")}</p>
      ) : (
        <>
          <p className="t-liten">{t("risk.watch_lead")}</p>
          <div className="mid-rad">
            {[30, 90, 180].map((d) => (
              <button key={d} type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" disabled={m.isPending}
                onClick={() => m.mutate({ p_org_id: orgId, p_receipt_id: receiptId, p_days: d })}>{t("risk.watch_days", { count: d })}</button>
            ))}
          </div>
        </>
      )}
      {m.error && <ErrorNotice error={m.error} />}
    </section>
  );
}
