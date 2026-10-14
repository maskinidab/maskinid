import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { CompanyLookupField, type CompanyInfo } from "../../../components/CompanyLookupField";
import { Dialog } from "../../../components/Dialog";
import { FinancierPicker, type PickedFinancier } from "../../../components/FinancierPicker";
import { ErrorNotice, Notice } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { ScannerView, type ScanResult } from "../../../components/Scanner";
import { labelCodeFromScan } from "@maskinid/shared/identifiers.ts";
import { OcrCapture, OcrError, OcrSuggestionList, useOcr } from "../../../components/OcrCapture";
import { uploadDocument } from "../../../components/DocumentDropzone";
import { EMPTY_TERMS, FinancingTermsFields, termsError, termsPayload, type TermsForm } from "../../../components/FinancingTerms";
import { useUpload } from "./FinancingActions";
import { useSign } from "../../../components/Signature";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { DocumentItem, Encumbrance, Flag, MachineView, OrgBrief, Transfer } from "../../../lib/api/types";
import { formatDate, formatReg, todayIso } from "../../../lib/format";
import { siteUrl } from "../../../lib/surfaces";

/** Thrown after an inline field error has been shown; the dialog shows nothing more. */
class FieldError extends Error {}

/** Shared frame for a register action: summary + form, an error inline, busy state, never a bare "OK" (SPEC §10). */
function ActionDialog({ open, onClose, title, submitLabel, onSubmit, children, danger = false, wide = false, disabled = false }: {
  open: boolean; onClose(): void; title: string; submitLabel: string; onSubmit(): Promise<void>; children: ReactNode;
  danger?: boolean; wide?: boolean;
  /** Blocks submit when the action cannot succeed yet, so the user is not sent into a server error. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (err) {
      // Inline field validation already shows its own message.
      if (!(err instanceof FieldError)) setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={title} wide={wide}>
      <form className="stack-4" onSubmit={submit} noValidate>
        {children}
        {error != null && <ErrorNotice error={error} />}
        <div className="mid-rad mid-rad-slut">
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className={danger ? "mid-knapp mid-knapp-fara" : "mid-knapp mid-knapp-primar"} disabled={busy || disabled}>
            {busy ? t("common.loading") : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MachineSummary({ m }: { m: Pick<MachineView, "reg_number" | "make" | "model" | "year"> }) {
  return <p className="t-liten"><strong className="mid-id">{formatReg(m.reg_number)}</strong> · {m.make} {m.model}{m.year ? ` · ${m.year}` : ""}</p>;
}

// ---------- Transfer (SPEC §6.7) ----------
export function TransferDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const nav = useNavigate();
  const [mode, setMode] = useState<"org" | "email">("org");
  const [orgNr, setOrgNr] = useState("");
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [email, setEmail] = useState("");
  const [saleDate, setSaleDate] = useState(todayIso());
  const [withFin, setWithFin] = useState(false);
  const [finHolder, setFinHolder] = useState<PickedFinancier | null>(null);
  const [finType, setFinType] = useState("ownership_reservation");
  const [finRef, setFinRef] = useState("");
  const [finEnd, setFinEnd] = useState("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const docs = useRpc<DocumentItem[]>("list_documents", open ? { p_org_id: orgId, p_machine_id: m.id } : null);
  const privateDocs = (docs.data ?? []).filter((d) => d.visibility === "owner" && d.status === "clean");
  const [err, setErr] = useState<string | null>(null);

  const late = (Date.parse(todayIso()) - Date.parse(saleDate)) / 86_400_000 > 10;
  return (
    <ActionDialog open={open} onClose={onClose} title={t("actions.transfer.title")} submitLabel={t("actions.transfer.submit")} wide
      onSubmit={async () => {
        setErr(null);
        if (mode === "org" && !company) { setErr(t("actions.transfer.buyer_required")); throw new FieldError(); }
        if (mode === "email" && !/^\S+@\S+\.\S+$/.test(email)) { setErr(t("actions.transfer.email_invalid")); throw new FieldError(); }
        if (withFin && (!finHolder || (finType === "ownership_reservation" && !finEnd))) { setErr(t("actions.transfer.financing_incomplete")); throw new FieldError(); }
        const r = await rpc<{ transfer: Transfer }>("initiate_transfer", {
          p_org_id: orgId, p_machine_id: m.id, p_sale_date: saleDate,
          p_to_org_id: mode === "org" ? company?.existing_org?.id ?? null : null,
          p_to_org_number: mode === "org" && !company?.existing_org ? company?.org_number : null,
          p_to_email: mode === "email" ? email : null,
          p_new_financing: withFin && finHolder
          ? { holder_org_id: finHolder.holder_org_id, holder_org_number: finHolder.holder_org_number, holder_name: finHolder.holder_name,
              type: finType, contract_ref: finRef || null, end_date: finEnd || null }
          : null,
          p_document_ids: docIds,
        });
        onClose();
        nav(path(`transfers/${r.transfer.id}`));
      }}>
      <MachineSummary m={m} />
      <p className="t-liten t-sekundar">{t("actions.transfer.lead")}</p>
      {m.financing?.has_active && <Notice kind="info" title={t("actions.transfer.financier_first", { holder: m.financing.active?.holder.name ?? "" })} />}
      <fieldset className="stack-3">
        <legend className="mid-etikett">{t("actions.transfer.buyer")}</legend>
        <div className="mid-val">
          <label><input type="radio" checked={mode === "org"} onChange={() => setMode("org")} /> {t("actions.transfer.by_org")}</label>
          <label><input type="radio" checked={mode === "email"} onChange={() => setMode("email")} /> {t("actions.transfer.by_email")}</label>
        </div>
        {mode === "org" ? (
          <CompanyLookupField value={orgNr} onChange={setOrgNr} onFound={setCompany} label={t("common.org_number")} />
        ) : (
          <FormField label={t("common.email")} hint={t("actions.transfer.email_hint")}>
            <input className="mid-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </FormField>
        )}
        {err && <p className="mid-fel" role="alert">{err}</p>}
      </fieldset>
      <FormField label={t("actions.transfer.sale_date")} hint={late ? t("actions.transfer.late_hint") : t("actions.transfer.sale_date_hint")}>
        <input className="mid-input" type="date" value={saleDate} max={todayIso()} onChange={(e) => setSaleDate(e.target.value)} required />
      </FormField>
      {privateDocs.length > 0 && (
        <fieldset className="stack-2">
          <legend className="mid-etikett">{t("actions.transfer.documents")}</legend>
          <p className="mid-hjalp">{t("actions.transfer.documents_hint")}</p>
          {privateDocs.map((d) => (
            <label key={d.id} className="mid-kryss"><input type="checkbox" checked={docIds.includes(d.id)}
              onChange={(e) => setDocIds((x) => (e.target.checked ? [...x, d.id] : x.filter((y) => y !== d.id)))} />
              {d.filename} <span className="t-sekundar">· {t(`enum.document_type.${d.type}`)}</span></label>
          ))}
        </fieldset>
      )}
      <label className="mid-kryss"><input type="checkbox" checked={withFin} onChange={(e) => setWithFin(e.target.checked)} /> {t("actions.transfer.with_financing")}</label>
      {withFin && (
        <div className="rutnat">
          <div className="kol-12">
            <FinancierPicker value={finHolder} onChange={setFinHolder} />
          </div>
          <FormField className="kol-3" label={t("common.type")}>
            <select className="mid-select" value={finType} onChange={(e) => setFinType(e.target.value)}>
              {["ownership_reservation", "leasing"].map((x) => <option key={x} value={x}>{t(`enum.encumbrance_type.${x}`)}</option>)}
            </select>
          </FormField>
          <FormField className="kol-3" label={t("actions.encumbrance.contract_ref")} optional>
            <input className="mid-input" value={finRef} onChange={(e) => setFinRef(e.target.value)} />
          </FormField>
          <FormField className="kol-6" label={t("actions.encumbrance.end")} optional={finType !== "ownership_reservation"}>
            <input className="mid-input" type="date" min={saleDate} value={finEnd} onChange={(e) => setFinEnd(e.target.value)} />
          </FormField>
        </div>
      )}
    </ActionDialog>
  );
}

// ---------- Flags (SPEC §6.8) ----------
const FLAG_TYPES_FOR = (types: string[], rel: string[], isHolder: boolean): string[] => {
  const out: string[] = [];
  if (rel.includes("owner") || rel.includes("user") || isHolder || types.includes("authority") || types.includes("insurer")) out.push("stolen");
  if (types.includes("authority")) out.push("seized", "blocked", "under_investigation");
  return out;
};

export function FlagDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId, types } = useOrg();
  const sign = useSign();
  const isHolder = m.relations.includes("holder");
  const options = FLAG_TYPES_FOR(types, m.relations, isHolder).filter((x) => !m.flags.some((f) => f.status === "active" && f.type === x));
  const [type, setType] = useState(options[0] ?? "stolen");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [occurred, setOccurred] = useState("");
  const [place, setPlace] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const needsRef = type === "stolen" && !types.includes("authority");
  return (
    <ActionDialog open={open} onClose={onClose} danger title={t("actions.flag.title")} submitLabel={type === "stolen" ? t("actions.flag.submit_stolen") : t("actions.flag.submit")}
      onSubmit={async () => {
        setErr(null);
        if (needsRef && !reference.trim()) { setErr(t("actions.flag.reference_required")); throw new FieldError(); }
        const ref = reference.trim() || null;
        const sig = type === "stolen" ? await sign(orgId, "raise_flag_stolen", m.id, { reference: ref }) : null;
        await rpc("raise_flag", {
          p_org_id: orgId, p_machine_id: m.id, p_type: type, p_reference: ref, p_description: description || null,
          p_occurred_at: occurred ? new Date(occurred).toISOString() : null, p_location_text: place || null, p_signature_id: sig,
        });
        onClose();
      }}>
      <MachineSummary m={m} />
      <FormField label={t("common.type")}>
        <select className="mid-select" value={type} onChange={(e) => setType(e.target.value)}>
          {options.map((x) => <option key={x} value={x}>{t(`enum.flag_type.${x}`)}</option>)}
        </select>
      </FormField>
      {type === "stolen" && <p className="t-liten t-sekundar">{t("actions.flag.stolen_lead")}</p>}
      <FormField label={type === "stolen" ? t("actions.flag.police_report") : t("actions.flag.reference")} optional={!needsRef} error={err}>
        <input className="mid-input is-id" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={type === "stolen" ? "K-123456-26" : undefined} />
      </FormField>
      <div className="rutnat">
        <FormField className="kol-6" label={t("actions.flag.occurred_at")} optional>
          <input className="mid-input" type="datetime-local" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("actions.flag.location")} optional>
          <input className="mid-input" value={place} onChange={(e) => setPlace(e.target.value)} />
        </FormField>
      </div>
      <FormField label={t("common.note")} optional>
        <textarea className="mid-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

export function ClearFlagDialog({ m, flag, onClose }: { m: MachineView; flag: Flag | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <ActionDialog open={!!flag} onClose={onClose} title={t("actions.clear_flag.title")} submitLabel={t("actions.clear_flag.submit")}
      onSubmit={async () => {
        if (!reason.trim()) { setErr(t("common.required")); throw new FieldError(); }
        await rpc("clear_flag", { p_org_id: orgId, p_flag_id: flag!.id, p_reason: reason });
        onClose();
      }}>
      <MachineSummary m={m} />
      {flag && <p className="t-liten">{t(`enum.flag_type.${flag.type}`)} · {formatDate(flag.raised_at)}</p>}
      <FormField label={t("actions.clear_flag.reason")} hint={flag?.type === "stolen" ? t("actions.clear_flag.recovered_hint") : undefined} error={err}>
        <textarea className="mid-textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

// ---------- Deregistration (SPEC §6.9) ----------
export function DeregisterDialog({ m, open, onClose, payoff, onRequestPayoff }: {
  m: MachineView; open: boolean; onClose(): void;
  /** The open or settled payoff for this machine, if any: its country and customs reference prefill the export. */
  payoff?: { status: string; export_country?: string | null; export_customs_ref?: string | null } | null;
  onRequestPayoff?(): void;
}) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  const [reason, setReason] = useState("scrapped");
  const [label, setLabel] = useState("destroyed");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  // The lender has settled the credit, so what the owner told them at the time is what we export with.
  // Derived, not initialised: this dialog is mounted before the payoff is loaded.
  const [typedCountry, setTypedCountry] = useState<string | null>(null);
  const [typedCustoms, setTypedCustoms] = useState<string | null>(null);
  const country = typedCountry ?? payoff?.export_country ?? "";
  const customsRef = typedCustoms ?? payoff?.export_customs_ref ?? "";
  const setCountry = setTypedCountry;
  const setCustomsRef = setTypedCustoms;
  const [err, setErr] = useState<string | null>(null);
  // Export keeps the label on the machine: that is what lets a foreign owner, or a buyer back home, scan it and
  // find the history. The other reasons still revoke it.
  const exporting = reason === "exported";
  const disposition = exporting ? "kept" : label;
  // The block is only released by the lender, with a signature (ADR 0025). Until then, do not let the user
  // submit into a server error - send them to the payoff instead.
  const blockedByFinancing = !!m.financing?.has_active && !m.relations.includes("holder");
  return (
    <ActionDialog open={open} onClose={onClose} danger title={t("actions.deregister.title")} submitLabel={t("actions.deregister.submit")}
      disabled={blockedByFinancing}
      onSubmit={async () => {
        setErr(null);
        if (exporting && country.trim() && !/^[A-Za-z]{2}$/.test(country.trim())) {
          setErr(t("wizard.err_country"));
          throw new FieldError();
        }
        const sig = await sign(orgId, "deregister_machine", m.id, { reason, label_disposition: disposition });
        await rpc("deregister_machine", { p_org_id: orgId, p_machine_id: m.id, p_reason: reason, p_label_disposition: disposition,
          p_signature_id: sig, p_note: note || null, p_date: date,
          p_export_country: exporting ? country.trim().toUpperCase() || null : null,
          p_export_customs_ref: exporting ? customsRef.trim() || null : null });
        onClose();
      }}>
      <MachineSummary m={m} />
      <Notice kind="info" title={t("actions.deregister.warning")} />
      {blockedByFinancing && (
        <Notice kind="fel" title={t("errors.ENCUMBRANCE_BLOCKS_DEREGISTRATION", { holder: m.financing!.active?.holder.name ?? "" })}>
          {onRequestPayoff && (payoff && ["requested", "quoted", "settlement_submitted"].includes(payoff.status)
            ? <p className="t-liten">{t("payoff.export_waiting")}</p>
            : <p>
                <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten" onClick={onRequestPayoff}>
                  {t("payoff.request_for_export")}
                </button>
              </p>)}
        </Notice>
      )}
      <FormField label={t("actions.deregister.reason")}>
        <select className="mid-select" value={reason} onChange={(e) => setReason(e.target.value)}>
          {["scrapped", "exported", "misregistered", "military", "stolen_not_recovered", "other"].map((x) =>
            <option key={x} value={x}>{t(`enum.deregistration_reason.${x}`)}</option>)}
        </select>
      </FormField>
      {exporting ? (
        <>
          <Notice kind="info" title={t("actions.deregister.export_keeps_identity")} />
          <div className="rutnat">
            <FormField className="kol-6" label={t("actions.deregister.export_country")} hint={t("actions.deregister.export_country_hint")} error={err}>
              <input className="mid-input is-id" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)}
                autoCapitalize="characters" placeholder="NO" />
            </FormField>
            <FormField className="kol-6" label={t("actions.deregister.export_customs_ref")} optional>
              <input className="mid-input is-id" value={customsRef} onChange={(e) => setCustomsRef(e.target.value)} />
            </FormField>
          </div>
          <p className="mid-hjalp">{t("actions.deregister.label_kept")}</p>
        </>
      ) : (
        <FormField label={t("actions.deregister.label")}>
          <select className="mid-select" value={label} onChange={(e) => setLabel(e.target.value)}>
            {["destroyed", "removed", "returned"].map((x) => <option key={x} value={x}>{t(`actions.deregister.label_${x}`)}</option>)}
          </select>
        </FormField>
      )}
      <FormField label={t("common.date")}>
        <input className="mid-input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      </FormField>
      <FormField label={t("common.note")} optional>
        <textarea className="mid-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

/** Brings an exported machine back into the register. The export stays in its history (ADR 0026). */
export function ReimportDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  const [note, setNote] = useState("");
  return (
    <ActionDialog open={open} onClose={onClose} title={t("actions.reimport.title")} submitLabel={t("actions.reimport.submit")}
      onSubmit={async () => {
        const sig = await sign(orgId, "reimport_machine", m.id, {});
        await rpc("reimport_machine", { p_org_id: orgId, p_machine_id: m.id, p_signature_id: sig, p_note: note || null });
        onClose();
      }}>
      <MachineSummary m={m} />
      <p className="t-liten">{t("actions.reimport.lead", { country: m.export_country ?? "–" })}</p>
      <FormField label={t("common.note")} optional>
        <textarea className="mid-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

// ---------- Share link (SPEC §6.10) ----------
export function ShareDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [scope, setScope] = useState("buyer_report");
  const [days, setDays] = useState(7);
  const [maxViews, setMaxViews] = useState("");
  const [result, setResult] = useState<{ token: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const url = result ? `${siteUrl()}/s/${result.token}` : "";
  const close = () => { setResult(null); setCopied(false); onClose(); };
  if (result) {
    return (
      <Dialog open={open} onClose={close} title={t("actions.share.created")}>
        <div className="stack-4">
          <p className="t-liten">{t("actions.share.valid_until", { date: formatDate(result.expires_at) })}</p>
          <div className="mid-sok-rad">
            <input className="mid-input is-id" readOnly value={url} aria-label={t("actions.share.link")} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); }}>
              <Icon name="kopiera" />{copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <p className="t-liten t-sekundar">{t("actions.share.once")}</p>
          <div className="mid-rad mid-rad-slut"><button type="button" className="mid-knapp mid-knapp-primar" onClick={close}>{t("common.done")}</button></div>
        </div>
      </Dialog>
    );
  }
  return (
    <ActionDialog open={open} onClose={close} title={t("actions.share.title")} submitLabel={t("actions.share.submit")}
      onSubmit={async () => {
        const r = await rpc<{ token: string; expires_at: string }>("create_share_link", { p_org_id: orgId, p_machine_id: m.id, p_scope: scope,
          p_days: days, p_max_views: maxViews ? Number(maxViews) : null });
        setResult(r);
      }}>
      <MachineSummary m={m} />
      <fieldset className="stack-2">
        <legend className="mid-etikett">{t("actions.share.scope")}</legend>
        <div className="mid-val">{["buyer_report", "public_card"].map((s) => (
          <label key={s}><input type="radio" checked={scope === s} onChange={() => setScope(s)} />
            <span><strong>{t(`enum.share_scope.${s}`)}</strong><br /><small>{t(`actions.share.scope_${s}`)}</small></span></label>
        ))}</div>
      </fieldset>
      <div className="rutnat">
        <FormField className="kol-6" label={t("actions.share.days")}>
          <select className="mid-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{t("actions.share.days_n", { count: d })}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("actions.share.max_views")} optional>
          <input className="mid-input" type="number" min={1} max={1000} value={maxViews} onChange={(e) => setMaxViews(e.target.value)} />
        </FormField>
      </div>
    </ActionDialog>
  );
}

const ENC_KINDS = ["ownership_reservation", "leasing", "rental", "other"];

// ---------- Encumbrances (SPEC §6.5) ----------
export function EncumbranceDialog({ m, open, onClose }: { m: Pick<MachineView, "id" | "reg_number" | "make" | "model" | "year" | "owner">; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  const [type, setType] = useState<Encumbrance["type"]>("ownership_reservation");
  const [ref, setRef] = useState("");
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [endErr, setEndErr] = useState<string | null>(null);
  const [refErr, setRefErr] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermsForm>(EMPTY_TERMS);
  const setTerm = <K extends keyof TermsForm>(k: K, v: TermsForm[K]) => setTerms((f) => ({ ...f, [k]: v }));
  const ocr = useOcr("ocr-financing-document");
  const upload = useUpload();
  const endRequired = type === "ownership_reservation";

  async function onFile(file: File) {
    const sug = await ocr.read(file);
    // Upload with no machine id: create_document_upload only authorises machine-scoped uploads for the
    // machine's own parties, and register_encumbrance adopts an org-level document onto the machine.
    void upload.start(uploadDocument({ orgId, machineId: null, type: "financing_contract", file, visibility: "owner_and_financier" }));
    if (!sug) return;
    if (typeof sug.encumbrance_type === "string" && ENC_KINDS.includes(sug.encumbrance_type)) setType(sug.encumbrance_type as Encumbrance["type"]);
    if (typeof sug.contract_ref === "string") setRef(sug.contract_ref);
    if (typeof sug.start_date === "string") setStart(sug.start_date);
    if (typeof sug.end_date === "string") setEnd(sug.end_date);
    if (typeof sug.term_months === "number") setTerm("amortization_months", String(sug.term_months));
    for (const k of ["financing_amount", "down_payment", "residual_value", "interest_rate"] as const) {
      if (typeof sug[k] === "number") setTerm(k, String(sug[k]));
    }
  }
  return (
    <ActionDialog open={open} onClose={onClose} title={t("actions.encumbrance.title")} submitLabel={t("actions.encumbrance.submit")}
      onSubmit={async () => {
        setEndErr(null);
        setRefErr(null);
        // Mandatory so the lender can tie the machine to the right financing agreement on its own side; SQL
        // enforces it again in app.require_contract_ref.
        if (!ref.trim()) { setRefErr(t("actions.encumbrance.contract_ref_required")); throw new FieldError(); }
        const badTerms = termsError(terms, t);
        if (badTerms) { setRefErr(badTerms); throw new FieldError(); }
        if (endRequired && !end) { setEndErr(t("actions.encumbrance.end_required")); throw new FieldError(); }
        if (end && end < start) { setEndErr(t("actions.encumbrance.end_before_start")); throw new FieldError(); }
        const params = { type, contract_ref: ref, start_date: start, end_date: end || null };
        const doc = await upload.settle();
        const sig = await sign(orgId, "register_encumbrance", m.id, params);
        const r = await rpc<{ ok: boolean }>("register_encumbrance", { p_org_id: orgId, p_machine_id: m.id, p_type: type, p_contract_ref: params.contract_ref,
          p_start_date: start, p_end_date: params.end_date, p_counterparty_org_id: m.owner?.id ?? null, p_notes: notes || null, p_signature_id: sig,
          p_document_ids: doc ? [doc.id] : [], p_terms: termsPayload(terms) });
        if (r.ok) onClose();
      }}>
      <MachineSummary m={m} />
      {m.owner && <p className="t-liten">{t("actions.encumbrance.counterparty", { name: m.owner.name })}</p>}
      <p className="t-liten t-sekundar">{t("actions.encumbrance.no_amounts")}</p>
      <p className="t-liten t-sekundar">{t("actions.encumbrance.attach_lead")}</p>
      <OcrCapture fn="ocr-financing-document" busy={ocr.busy || upload.uploading} label={t("components.dropzone.choose")}
        busyLabel={t("actions.financing.reading")} onFile={onFile} />
      <OcrError error={ocr.error} title={t("actions.financing.read_failed")} />
      {upload.doc && <Notice kind="ok" title={t("components.dropzone.uploaded", { name: upload.doc.filename })} />}
      <OcrSuggestionList suggestion={ocr.suggestion} labelKey="financing.ocr_field" onAccept={(field, value) => {
        if (field === "contract_ref") setRef(String(value));
        else if (field === "start_date") setStart(String(value));
        else if (field === "end_date") setEnd(String(value));
        else if (field === "encumbrance_type" && ENC_KINDS.includes(String(value))) setType(String(value) as Encumbrance["type"]);
        else if (field === "term_months") setTerm("amortization_months", String(value));
        else if (field === "financing_amount" || field === "down_payment" || field === "residual_value" || field === "interest_rate") setTerm(field, String(value));
        ocr.drop(field);
      }} />
      <div className="rutnat">
        <FormField className="kol-6" label={t("common.type")}>
          <select className="mid-select" value={type} onChange={(e) => setType(e.target.value as Encumbrance["type"])}>
            {["ownership_reservation", "leasing", "rental", "other"].map((x) => <option key={x} value={x}>{t(`enum.encumbrance_type.${x}`)}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("actions.encumbrance.contract_ref")} hint={t("actions.encumbrance.contract_ref_hint")} error={refErr}>
          <input className="mid-input is-id" value={ref} onChange={(e) => setRef(e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("actions.encumbrance.start")}>
          <input className="mid-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("actions.encumbrance.end")} optional={!endRequired} error={endErr}>
          <input className="mid-input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </FormField>
      </div>
      <FinancingTermsFields form={terms} set={setTerm} />
      <FormField label={t("common.note")} optional hint={t("actions.encumbrance.notes_hint")}>
        <textarea className="mid-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

/**
 * The lender releases the block. This ends its own `holder` relation to the machine, so the page behind the dialog
 * stops being readable in the same transaction — which is why closing straight away showed "ingen behörighet"
 * instead of a confirmation (ADR 0030). The dialog stays open on a receipt instead.
 */
export function ReleaseEncumbranceDialog({ m, e, onClose }: { m: MachineView; e: Encumbrance | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const sign = useSign();
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  if (e && done) {
    return (
      <Dialog open onClose={onClose} title={t("actions.release.confirmed")}>
        <div className="stack-4">
          <Notice kind="ok" title={t("actions.release.confirmed")}>
            <p>{t("actions.release.confirmed_body", { reg: formatReg(m.reg_number) })}</p>
          </Notice>
          <div className="mid-rad mid-rad-slut">
            <Link className="mid-knapp mid-knapp-primar" to={path("portfolio")} onClick={onClose}>{t("nav.portfolio")}</Link>
          </div>
        </div>
      </Dialog>
    );
  }
  return (
    <ActionDialog open={!!e} onClose={onClose} title={t("actions.release.title")} submitLabel={t("actions.release.submit")}
      onSubmit={async () => {
        const sig = await sign(orgId, "release_encumbrance", e!.id, {});
        await rpc("release_encumbrance", { p_org_id: orgId, p_encumbrance_id: e!.id, p_signature_id: sig, p_reason: reason || null });
        setDone(true);
      }}>
      <MachineSummary m={m} />
      {e && <p className="t-liten">{t(`enum.encumbrance_type.${e.type}`)} · {e.holder.name} · {formatDate(e.start_date)}</p>}
      <FormField label={t("actions.release.reason")} optional>
        <input className="mid-input" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={t("actions.release.reason_placeholder")} />
      </FormField>
    </ActionDialog>
  );
}

export function RequestReleaseDialog({ m, e, onClose }: { m: MachineView; e: Encumbrance | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [message, setMessage] = useState("");
  return (
    <ActionDialog open={!!e} onClose={onClose} title={t("actions.request_release.title")} submitLabel={t("common.send")}
      onSubmit={async () => {
        await rpc("request_encumbrance_release", { p_org_id: orgId, p_encumbrance_id: e!.id, p_message: message || null });
        onClose();
      }}>
      <MachineSummary m={m} />
      <p className="t-liten">{t("actions.request_release.lead", { holder: e?.holder.name ?? "" })}</p>
      <FormField label={t("common.note")} optional>
        <textarea className="mid-textarea" rows={3} value={message} onChange={(ev) => setMessage(ev.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

// ---------- Label binding (SPEC §5.2) ----------
export function BindLabelDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [code, setCode] = useState("");
  const [scan, setScan] = useState(false);
  return (
    <ActionDialog open={open} onClose={onClose} title={t("actions.label.title")} submitLabel={t("actions.label.submit")}
      onSubmit={async () => {
        // Never upper-case: a code is 22 characters of base62, so "aB…" and "Ab…" are two different labels.
        await rpc("bind_label", { p_org_id: orgId, p_machine_id: m.id, p_code: code.trim(), p_role: "primary" });
        onClose();
      }}>
      <MachineSummary m={m} />
      <p className="t-liten t-sekundar">{t("actions.label.lead")}</p>
      {scan ? <ScannerView onResult={(r: ScanResult) => { if (r.kind === "label") { setCode(r.code); setScan(false); } }} /> : (
        <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={() => setScan(true)}><Icon name="qr" />{t("actions.label.scan")}</button>
      )}
      <FormField label={t("actions.label.code")} hint={t("actions.label.code_hint")}>
        <input className="mid-input is-id" value={code} onChange={(e) => setCode(e.target.value)}
          onPaste={(e) => {
            // Pasting the whole https://…/m/<code> URL is the realistic case: the sticker prints only 6 characters.
            const found = labelCodeFromScan(e.clipboardData.getData("text"));
            if (found) { e.preventDefault(); setCode(found); }
          }}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={t("actions.label.code_placeholder")} />
      </FormField>
    </ActionDialog>
  );
}

// ---------- Verification request (SPEC §3.3) ----------
const PROOF_TYPES = ["invoice", "purchase_agreement", "ownership_certificate"];
const EVIDENCE_TYPES = [...PROOF_TYPES, "photo_nameplate", "photo_machine", "photo_label", "inspection_report", "ce_declaration"];

export function VerificationDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [level, setLevel] = useState(Math.min(2, m.verification_level + 1));
  const [partner, setPartner] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const partners = useRpc<(OrgBrief & { address?: unknown })[]>("list_verification_partners", open ? { p_level: level } : null);
  // The machine's documents go with the request as evidence; level 1 needs proof of acquisition + a nameplate photo.
  const docs = useRpc<DocumentItem[]>("list_documents", open ? { p_org_id: orgId, p_machine_id: m.id } : null);
  const evidence = (docs.data ?? []).filter((d) => EVIDENCE_TYPES.includes(d.type));
  const hasProof = evidence.some((d) => PROOF_TYPES.includes(d.type));
  const hasNameplate = evidence.some((d) => d.type === "photo_nameplate");
  const missing = level === 1 && docs.data && !(hasProof && hasNameplate);
  return (
    <ActionDialog open={open} onClose={onClose} title={t("actions.verify.title")} submitLabel={t("actions.verify.submit")}
      onSubmit={async () => {
        await rpc("request_verification", { p_org_id: orgId, p_machine_id: m.id, p_level: level, p_document_ids: evidence.map((d) => d.id),
          p_reviewer_org_id: partner || null, p_note: note || null, p_preferred_date: date || null });
        onClose();
      }}>
      <MachineSummary m={m} />
      <fieldset className="stack-2">
        <legend className="mid-etikett">{t("level.label")}</legend>
        <div className="mid-val">{[1, 2].filter((l) => l > m.verification_level).map((l) => (
          <label key={l}><input type="radio" checked={level === l} onChange={() => setLevel(l)} />
            <span><strong>{t(`level.${l}.name`)}</strong><br /><small>{t(`level.${l}.desc`)}</small></span></label>
        ))}</div>
      </fieldset>
      <div className="stack-1">
        <p className="mid-etikett">{t("actions.verify.evidence")}</p>
        {evidence.length ? (
          <ul className="lista-punkter t-liten">{evidence.map((d) => <li key={d.id}>{t(`enum.document_type.${d.type}`)} · {d.filename}</li>)}</ul>
        ) : <p className="t-liten t-sekundar">{t("actions.verify.no_evidence")}</p>}
        {missing && <Notice kind="fel" title={t("actions.verify.missing", {
          what: [!hasProof && t("actions.verify.need_proof"), !hasNameplate && t("actions.verify.need_nameplate")].filter(Boolean).join(t("common.and")) })} />}
      </div>
      <FormField label={t("actions.verify.partner")} hint={t("actions.verify.partner_hint")} optional>
        <select className="mid-select" value={partner} onChange={(e) => setPartner(e.target.value)}>
          <option value="">{t("actions.verify.operator")}</option>
          {(partners.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ""}</option>)}
        </select>
      </FormField>
      {level === 2 && (
        <FormField label={t("actions.verify.preferred_date")} optional>
          <input className="mid-input" type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      )}
      <FormField label={t("common.note")} optional hint={t("actions.verify.documents_hint")}>
        <textarea className="mid-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}

// ---------- Hour meter / details ----------
export function EditMachineDialog({ m, open, onClose }: { m: MachineView; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [hours, setHours] = useState(m.hour_meter?.toString() ?? "");
  const [color, setColor] = useState(m.color ?? "");
  const [description, setDescription] = useState(m.description ?? "");
  const [year, setYear] = useState(m.year?.toString() ?? "");
  return (
    <ActionDialog open={open} onClose={onClose} title={t("actions.edit.title")} submitLabel={t("common.save")}
      onSubmit={async () => {
        await rpc("update_machine", { p_org_id: orgId, p_machine_id: m.id, p_patch: {
          hour_meter: hours === "" ? null : Number(hours), color: color || null, description: description || null, year: year === "" ? null : Number(year),
        } });
        onClose();
      }}>
      <MachineSummary m={m} />
      <div className="rutnat">
        <FormField className="kol-6" label={t("machine.hours")}>
          <input className="mid-input" type="number" min={m.hour_meter ?? 0} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("machines.col_year")}>
          <input className="mid-input" type="number" min={1950} max={new Date().getFullYear() + 1} value={year} onChange={(e) => setYear(e.target.value)} />
        </FormField>
      </div>
      <FormField label={t("wizard.color")} optional>
        <input className="mid-input" value={color} onChange={(e) => setColor(e.target.value)} />
      </FormField>
      <FormField label={t("wizard.description")} optional>
        <textarea className="mid-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}
