import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { Dialog } from "../../../components/Dialog";
import { uploadDocument } from "../../../components/DocumentDropzone";
import { ErrorNotice, Notice } from "../../../components/Feedback";
import { FinancierPicker, type FinancierProfile, type PickedFinancier } from "../../../components/FinancierPicker";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { OcrCapture, OcrError, OcrSuggestionList, useOcr } from "../../../components/OcrCapture";
import { useSign } from "../../../components/Signature";
import { StatusBadge } from "../../../components/StatusBadge";
import { queryClient, rpc } from "../../../lib/api/query";
import type { DocumentItem, Encumbrance, MachineView, PayoffRequest } from "../../../lib/api/types";
import { formatDate, todayIso } from "../../../lib/format";

/** Shared frame: summary + form, inline error, busy state (mirrors ActionDialog in MachineActions). */
function FinancingDialog({ open, onClose, title, submitLabel, onSubmit, children, wide = false, danger = false }: {
  open: boolean; onClose(): void; title: string; submitLabel: string; onSubmit(): Promise<void>;
  children: React.ReactNode; wide?: boolean; danger?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open={open} onClose={onClose} title={title} wide={wide}>
      <form
        className="stack-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSubmit();
            await queryClient.invalidateQueries({ queryKey: ["rpc"] });
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        {error != null && <ErrorNotice error={error} />}
        <div className="mid-rad mid-rad-slut">
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className={danger ? "mid-knapp mid-knapp-fara" : "mid-knapp mid-knapp-primar"} disabled={busy}>
            {busy ? t("common.loading") : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * One in-flight document upload. `await settle()` resolves to the uploaded document, waiting for an upload
 * that is still running — so a submit cannot outrun the file and silently save without its evidence.
 */
function useUpload() {
  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const inFlight = useRef<Promise<DocumentItem | null> | null>(null);
  async function start(p: Promise<DocumentItem>) {
    setUploading(true);
    inFlight.current = p.then((d) => { setDoc(d); return d; }).catch(() => null).finally(() => setUploading(false));
    return inFlight.current;
  }
  const settle = async () => doc ?? (inFlight.current ? await inFlight.current : null);
  return { doc, uploading, start, settle };
}

const ENC_TYPES = ["ownership_reservation", "leasing", "rental", "other"];

interface FinancingForm {
  type: string;
  contract_ref: string;
  start: string;
  end: string;
  term_months: string;
}

const EMPTY_FORM: FinancingForm = { type: "ownership_reservation", contract_ref: "", start: todayIso(), end: "", term_months: "" };

/** end_date from a start date + a term in months, so an agreement that only states "60 months" still fills in. */
function endFromTerm(start: string, months: number): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * "Bifoga dokument": upload or photograph the bank order / leasing agreement, let MaskinID read it, confirm the
 * fields and report the financing to the bank. Available to dealers and ordinary company accounts alike — for a
 * plain owner this is the only way in, which is what was asked for (no manual form to get wrong).
 */
export function AttachFinancingDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const ocr = useOcr("ocr-financing-document");
  const [form, setForm] = useState<FinancingForm>(EMPTY_FORM);
  const [holder, setHolder] = useState<PickedFinancier | null>(null);
  const upload = useUpload();
  const [matchNote, setMatchNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof FinancingForm>(k: K, v: FinancingForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function onFile(file: File) {
    const s = await ocr.read(file);
    // Keep the document whatever the reading produced: the agreement itself is the evidence.
    const type = s?.document_kind === "bank_order" ? "bank_order" : s?.document_kind === "payoff_statement" ? "payoff_statement" : "financing_contract";
    void upload.start(uploadDocument({ orgId, machineId: m.id, type, file, visibility: "owner_and_financier" }));
    if (!s) return;
    // Pre-fill what does not need a decision; the bank and the dates are confirmed field by field below.
    if (typeof s.encumbrance_type === "string" && ENC_TYPES.includes(s.encumbrance_type)) set("type", s.encumbrance_type);
    if (typeof s.contract_ref === "string") set("contract_ref", s.contract_ref);
    if (typeof s.start_date === "string") set("start", s.start_date);
    if (typeof s.end_date === "string") set("end", s.end_date);
    if (typeof s.term_months === "number") set("term_months", String(s.term_months));
    // Resolve the bank the document names, so the user only confirms.
    if (typeof s.financier_name === "string" || typeof s.financier_org_number === "string") {
      try {
        const hit = await rpc<{ org: { id: string; name: string; types?: string[] } | null; eligible: boolean; org_number?: string }>("match_financier", {
          p_org_id: orgId, p_name: (s.financier_name as string) ?? null, p_org_number: (s.financier_org_number as string) ?? null,
        });
        if (hit.org && hit.eligible) {
          setHolder({ holder_org_id: hit.org.id, holder_org_number: null, holder_name: null, unclaimed: false, name: hit.org.name });
          setMatchNote(t("actions.financing.matched", { name: hit.org.name }));
        } else if (typeof s.financier_org_number === "string") {
          setHolder({ holder_org_id: null, holder_org_number: s.financier_org_number as string, holder_name: (s.financier_name as string) ?? null, unclaimed: true, name: (s.financier_name as string) ?? (s.financier_org_number as string) });
          setMatchNote(t("actions.financing.matched_unknown", { name: (s.financier_name as string) ?? (s.financier_org_number as string) }));
        }
      } catch {
        // Matching is a convenience; the user can always pick the bank by hand.
      }
    }
  }

  function acceptField(field: string, value: unknown) {
    if (field === "contract_ref") set("contract_ref", String(value));
    else if (field === "start_date") set("start", String(value));
    else if (field === "end_date") set("end", String(value));
    else if (field === "term_months") set("term_months", String(value));
    else if (field === "encumbrance_type" && ENC_TYPES.includes(String(value))) set("type", String(value));
    ocr.drop(field);
  }

  const endRequired = form.type === "ownership_reservation";
  return (
    <FinancingDialog
      open={open}
      onClose={onClose}
      wide
      title={t("actions.financing.attach")}
      submitLabel={t("actions.financing.submit")}
      onSubmit={async () => {
        setErr(null);
        if (!holder) { setErr(t("common.required")); throw new Error("holder"); }
        const end = form.end || (form.term_months ? endFromTerm(form.start, Number(form.term_months)) : "");
        if (endRequired && !end) { setErr(t("actions.encumbrance.end_required")); throw new Error("end"); }
        // Wait for the document, so the financing never reaches the bank without the agreement behind it.
        const d = await upload.settle();
        await rpc("request_encumbrance", {
          p_org_id: orgId, p_machine_id: m.id, p_holder_org_id: holder.holder_org_id, p_type: form.type,
          p_contract_ref: form.contract_ref || null, p_start_date: form.start, p_end_date: end || null,
          p_holder_org_number: holder.holder_org_number, p_holder_name: holder.holder_name, p_holder_email: null,
          p_document_ids: d ? [d.id] : [],
        });
        onClose();
      }}
    >
      <p className="t-liten t-sekundar">{t("actions.financing.attach_lead")}</p>
      <p className="t-liten t-sekundar">{t("actions.encumbrance.no_amounts")}</p>
      <OcrCapture fn="ocr-financing-document" busy={ocr.busy} label={t("components.dropzone.choose")} busyLabel={t("actions.financing.reading")} onFile={onFile} />
      <OcrCapture fn="ocr-financing-document" camera accept="image/*" busy={ocr.busy} label={t("components.dropzone.camera")} busyLabel={t("actions.financing.reading")} onFile={onFile} />
      <OcrError error={ocr.error} title={t("actions.financing.read_failed")} />
      {upload.doc && <Notice kind="ok" title={t("components.dropzone.uploaded", { name: upload.doc.filename })} />}
      <OcrSuggestionList suggestion={ocr.suggestion} labelKey="financing.ocr_field" onAccept={acceptField} />
      {matchNote && <Notice kind="info" title={matchNote} />}
      <FinancierPicker value={holder} onChange={setHolder} error={err} />
      <FinancingFields form={form} set={set} endRequired={endRequired} />
    </FinancingDialog>
  );
}

function FinancingFields({ form, set, endRequired }: {
  form: FinancingForm; set: <K extends keyof FinancingForm>(k: K, v: FinancingForm[K]) => void; endRequired: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rutnat">
      <FormField className="kol-6" label={t("common.type")}>
        <select className="mid-select" value={form.type} onChange={(e) => set("type", e.target.value)}>
          {ENC_TYPES.map((x) => <option key={x} value={x}>{t(`enum.encumbrance_type.${x}`)}</option>)}
        </select>
      </FormField>
      <FormField className="kol-6" label={t("actions.encumbrance.contract_ref")} optional>
        <input className="mid-input is-id" value={form.contract_ref} onChange={(e) => set("contract_ref", e.target.value)} />
      </FormField>
      <FormField className="kol-4" label={t("actions.encumbrance.start")}>
        <input className="mid-input" type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
      </FormField>
      <FormField className="kol-4" label={t("actions.encumbrance.end")} optional={!endRequired}>
        <input className="mid-input" type="date" min={form.start} value={form.end} onChange={(e) => set("end", e.target.value)} />
      </FormField>
      <FormField className="kol-4" label={t("financier.defaults.default_term_months")} optional>
        <input className="mid-input" type="number" min={1} max={240} value={form.term_months} onChange={(e) => set("term_months", e.target.value)} />
      </FormField>
    </div>
  );
}

/** "Lägg in finansiering manuellt" — dealers only; a plain owner account gets the document path instead. */
export function ManualFinancingDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [form, setForm] = useState<FinancingForm>(EMPTY_FORM);
  const [holder, setHolder] = useState<PickedFinancier | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof FinancingForm>(k: K, v: FinancingForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const endRequired = form.type === "ownership_reservation";
  return (
    <FinancingDialog
      open={open}
      onClose={onClose}
      wide
      title={t("actions.financing.manual")}
      submitLabel={t("actions.financing.submit")}
      onSubmit={async () => {
        setErr(null);
        if (!holder) { setErr(t("common.required")); throw new Error("holder"); }
        const end = form.end || (form.term_months ? endFromTerm(form.start, Number(form.term_months)) : "");
        if (endRequired && !end) { setErr(t("actions.encumbrance.end_required")); throw new Error("end"); }
        await rpc("request_encumbrance", {
          p_org_id: orgId, p_machine_id: m.id, p_holder_org_id: holder.holder_org_id, p_type: form.type,
          p_contract_ref: form.contract_ref || null, p_start_date: form.start, p_end_date: end || null,
          p_holder_org_number: holder.holder_org_number, p_holder_name: holder.holder_name, p_holder_email: null,
          p_document_ids: [],
        });
        onClose();
      }}
    >
      <p className="t-liten t-sekundar">{t("actions.financing.manual_lead")}</p>
      <p className="t-liten t-sekundar">{t("actions.encumbrance.no_amounts")}</p>
      <FinancierPicker
        value={holder}
        onChange={setHolder}
        onProfile={(p: FinancierProfile | null) => {
          const d = p?.financing_defaults;
          if (d?.default_type && ENC_TYPES.includes(d.default_type)) set("type", d.default_type);
          if (d?.default_term_months) set("term_months", String(d.default_term_months));
          if (d?.contract_ref_prefix && !form.contract_ref) set("contract_ref", d.contract_ref_prefix);
        }}
        error={err}
      />
      <FinancingFields form={form} set={set} endRequired={endRequired} />
    </FinancingDialog>
  );
}

/** Lender declines a reported financing. The RPC existed from the start but had no UI. */
export function RejectEncumbranceDialog({ e, onClose }: { e: Encumbrance | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [reason, setReason] = useState("");
  return (
    <FinancingDialog
      open={!!e}
      onClose={onClose}
      danger
      title={t("actions.financing.reject")}
      submitLabel={t("actions.financing.reject")}
      onSubmit={async () => {
        await rpc("reject_encumbrance", { p_org_id: orgId, p_encumbrance_id: e!.id, p_reason: reason || null });
        onClose();
      }}
    >
      <FormField label={t("actions.financing.reject_reason")} optional>
        <textarea className="mid-textarea" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </FormField>
    </FinancingDialog>
  );
}

/** Lender hands the encumbrance to another lender (transfer_encumbrance_holder had no UI either). */
export function TransferHolderDialog({ e, onClose }: { e: Encumbrance | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  const [holder, setHolder] = useState<PickedFinancier | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <FinancingDialog
      open={!!e}
      onClose={onClose}
      title={t("actions.financing.transfer_holder")}
      submitLabel={t("actions.financing.transfer_holder")}
      onSubmit={async () => {
        setErr(null);
        // Only a known organisation can be handed an encumbrance: the new holder has to accept it themselves.
        if (!holder?.holder_org_id) { setErr(t("common.required")); throw new Error("holder"); }
        const sig = await sign(orgId, "transfer_encumbrance_holder", e!.id, { new_holder_org_id: holder.holder_org_id });
        await rpc("transfer_encumbrance_holder", { p_org_id: orgId, p_encumbrance_id: e!.id, p_new_holder_org_id: holder.holder_org_id, p_signature_id: sig });
        onClose();
      }}
    >
      <p className="t-liten t-sekundar">{t("actions.financing.transfer_holder_lead")}</p>
      <FinancierPicker value={holder} onChange={setHolder} error={err} />
    </FinancingDialog>
  );
}

/** The new lender accepts a handover. The inbox used to route this to "Bekräfta", which raised a false conflict. */
export function AcceptTakeoverDialog({ e, m, onClose }: { e: Encumbrance | null; m: MachineView; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  return (
    <FinancingDialog
      open={!!e}
      onClose={onClose}
      title={t("actions.financing.accept_takeover")}
      submitLabel={t("actions.financing.accept_takeover")}
      onSubmit={async () => {
        const sig = await sign(orgId, "accept_encumbrance_transfer", e!.id, {});
        await rpc("accept_encumbrance_transfer", { p_org_id: orgId, p_encumbrance_id: e!.id, p_signature_id: sig });
        onClose();
      }}
    >
      <p className="t-liten">{t("actions.financing.accept_takeover_lead", { from: e?.holder.name ?? "", reg: m.reg_number })}</p>
    </FinancingDialog>
  );
}

export function RequestPayoffDialog({ e, purpose, onClose }: {
  e: Encumbrance | null; purpose: "trade_in" | "sale" | "export" | "owner_request"; onClose(): void;
}) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [message, setMessage] = useState("");
  const [country, setCountry] = useState("");
  return (
    <FinancingDialog
      open={!!e}
      onClose={onClose}
      title={t("payoff.request")}
      submitLabel={t("payoff.request")}
      onSubmit={async () => {
        await rpc("request_payoff", {
          p_org_id: orgId, p_encumbrance_id: e!.id, p_purpose: purpose, p_message: message || null,
          p_export_country: purpose === "export" ? country.trim().toUpperCase() || null : null,
        });
        onClose();
      }}
    >
      <p className="t-liten t-sekundar">{t("payoff.lead_owner")}</p>
      <p className="t-liten t-sekundar">{t("payoff.no_amounts")}</p>
      {purpose === "export" && (
        <FormField label={t("actions.deregister.export_country")} hint={t("actions.deregister.export_country_hint")} optional>
          <input className="mid-input is-id" maxLength={2} value={country} onChange={(ev) => setCountry(ev.target.value)} placeholder="NO" />
        </FormField>
      )}
      <FormField label={t("common.note")} optional>
        <textarea className="mid-textarea" rows={3} value={message} onChange={(ev) => setMessage(ev.target.value)} />
      </FormField>
    </FinancingDialog>
  );
}

/** Lender answers with a payoff statement. The amount is in the attached document, never in the register. */
export function PayoffQuoteDialog({ m, payoff, onClose }: { m: MachineView; payoff: PayoffRequest | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [reference, setReference] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const upload = useUpload();
  return (
    <FinancingDialog
      open={!!payoff}
      onClose={onClose}
      title={t("payoff.quote")}
      submitLabel={t("payoff.quote")}
      onSubmit={async () => {
        // Wait for the file, so the statement never lands without the document that carries the amount.
        const d = await upload.settle();
        await rpc("submit_payoff_quote", {
          p_org_id: orgId, p_payoff_request_id: payoff!.id, p_document_id: d?.id ?? null,
          p_reference: reference || null, p_valid_until: validUntil || null,
        });
        onClose();
      }}
    >
      <p className="t-liten t-sekundar">{t("payoff.quote_hint")}</p>
      <OcrCapture
        fn="ocr-financing-document"
        busy={upload.uploading}
        preview={false}
        label={t("components.dropzone.choose")}
        busyLabel={t("components.dropzone.uploading", { name: "" })}
        onFile={async (file) => { await upload.start(uploadDocument({ orgId, machineId: m.id, type: "payoff_statement", file, visibility: "owner_and_financier" })); }}
      />
      {upload.doc && <Notice kind="ok" title={t("components.dropzone.uploaded", { name: upload.doc.filename })} />}
      <div className="rutnat">
        <FormField className="kol-6" label={t("payoff.quote_reference")} optional>
          <input className="mid-input is-id" value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("payoff.quote_valid_until")} optional>
          <input className="mid-input" type="date" min={todayIso()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </FormField>
      </div>
    </FinancingDialog>
  );
}

/** The requester uploads proof the credit is settled. This does not release anything by itself. */
export function PayoffSettlementDialog({ m, payoff, onClose }: { m: MachineView; payoff: PayoffRequest | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const upload = useUpload();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <FinancingDialog
      open={!!payoff}
      onClose={onClose}
      title={t("payoff.settlement")}
      submitLabel={t("payoff.settlement")}
      onSubmit={async () => {
        setErr(null);
        const d = await upload.settle();
        if (!d) { setErr(t("common.required")); throw new Error("doc"); }
        await rpc("submit_payoff_settlement", { p_org_id: orgId, p_payoff_request_id: payoff!.id, p_document_id: d.id, p_note: note || null });
        onClose();
      }}
    >
      <p className="t-liten t-sekundar">{t("payoff.settlement_hint")}</p>
      <OcrCapture
        fn="ocr-financing-document"
        busy={upload.uploading}
        preview={false}
        label={t("components.dropzone.choose")}
        busyLabel={t("components.dropzone.uploading", { name: "" })}
        onFile={async (file) => { await upload.start(uploadDocument({ orgId, machineId: m.id, type: "payoff_statement", file, visibility: "owner_and_financier" })); }}
      />
      {upload.doc ? <Notice kind="ok" title={t("components.dropzone.uploaded", { name: upload.doc.filename })} /> : err && <p className="mid-fel" role="alert">{err}</p>}
      <FormField label={t("common.note")} optional>
        <textarea className="mid-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </FinancingDialog>
  );
}

/** The lender approves and the block is released in the same signed step. */
export function PayoffSettleDialog({ payoff, onClose }: { payoff: PayoffRequest | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  return (
    <FinancingDialog
      open={!!payoff}
      onClose={onClose}
      title={t("payoff.settle")}
      submitLabel={t("payoff.settle")}
      onSubmit={async () => {
        const sig = await sign(orgId, "release_encumbrance", payoff!.encumbrance_id, {});
        await rpc("settle_payoff", { p_org_id: orgId, p_payoff_request_id: payoff!.id, p_signature_id: sig, p_release: true });
        onClose();
      }}
    >
      <p className="t-liten">{t("payoff.settle_lead")}</p>
    </FinancingDialog>
  );
}

export function PayoffDeclineDialog({ payoff, onClose }: { payoff: PayoffRequest | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [reason, setReason] = useState("");
  return (
    <FinancingDialog
      open={!!payoff}
      onClose={onClose}
      danger
      title={t("payoff.decline")}
      submitLabel={t("payoff.decline")}
      onSubmit={async () => {
        await rpc("decline_payoff", { p_org_id: orgId, p_payoff_request_id: payoff!.id, p_reason: reason || null });
        onClose();
      }}
    >
      <FormField label={t("payoff.decline_reason")} optional>
        <textarea className="mid-textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </FinancingDialog>
  );
}

/**
 * The payoff conversation, shown on the machine's financing tab. Both sides see the same row; the buttons differ
 * by who you are. The amount is never here — only a link to the lender's document.
 */
export function PayoffPanel({ payoff, isHolder, onAction }: {
  payoff: PayoffRequest | null; isHolder: boolean;
  onAction(a: "quote" | "settlement" | "settle" | "decline"): void;
}) {
  const { t } = useTranslation();
  const { canWrite } = useOrg();
  if (!payoff) return null;
  const open = ["requested", "quoted", "settlement_submitted"].includes(payoff.status);
  return (
    <article className="mid-post stack-2">
      <div className="mid-rad mid-rad-mellan">
        <strong>{t("payoff.title")} · {t(`enum.payoff_purpose.${payoff.purpose}`)}</strong>
        <StatusBadge kind={payoff.status === "settled" ? "verifierad" : open ? "vantar" : "neutral"}>
          {t(`enum.payoff_status.${payoff.status}`)}
        </StatusBadge>
      </div>
      <p className="t-liten t-sekundar">{t("payoff.requested_by", { org: payoff.requested_by?.name ?? "" })}</p>
      {payoff.quote_valid_until && <p className="t-liten">{t("payoff.quote_valid", { date: formatDate(payoff.quote_valid_until) })}</p>}
      {payoff.declined_reason && <p className="mid-fel">{t("payoff.declined_by", { holder: payoff.holder?.name ?? "", reason: payoff.declined_reason })}</p>}
      <p className="t-liten t-sekundar">{t("payoff.no_amounts")}</p>
      {canWrite && (
        <div className="mid-rad">
          {isHolder && payoff.status === "requested" && (
            <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" onClick={() => onAction("quote")}>
              <Icon name="dokument" />{t("payoff.quote")}
            </button>
          )}
          {!isHolder && ["requested", "quoted"].includes(payoff.status) && (
            <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten" onClick={() => onAction("settlement")}>
              <Icon name="uppladdning" />{t("payoff.settlement")}
            </button>
          )}
          {isHolder && open && (
            <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" onClick={() => onAction("settle")}>
              <Icon name="hanglas" />{t("payoff.settle")}
            </button>
          )}
          {isHolder && open && (
            <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => onAction("decline")}>
              {t("payoff.decline")}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
