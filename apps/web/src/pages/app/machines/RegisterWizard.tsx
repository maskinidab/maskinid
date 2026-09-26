import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { CompanyLookupField, type CompanyInfo } from "../../../components/CompanyLookupField";
import { uploadDocument } from "../../../components/DocumentDropzone";
import { ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { ScannerView } from "../../../components/Scanner";
import { SerialInput, type IdentifierCheck } from "../../../components/SerialInput";
import { VerificationBadge } from "../../../components/StatusBadge";
import { rpc, useRpc } from "../../../lib/api/query";
import type { OrgBrief } from "../../../lib/api/types";
import { backend } from "../../../lib/backend";
import { formatDateTime, formatReg, todayIso } from "../../../lib/format";

const CATEGORIES = ["excavator_tracked", "excavator_wheeled", "wheel_loader", "backhoe", "dumper", "dozer", "grader", "roller", "paver",
  "telehandler", "forklift", "crane_mobile", "drill_rig", "crusher", "screener", "compressor", "generator", "forestry_harvester",
  "forestry_forwarder", "skidder", "tractor", "trailer_heavy", "attachment", "other"];
const FUELS = ["diesel", "hvo", "petrol", "gas", "electric", "hybrid", "hydrogen", "other", "unknown"];
const EMISSIONS = ["stage_v", "stage_iv", "stage_iiib", "stage_iiia", "stage_ii", "stage_i", "pre_stage", "zero_emission", "unknown"];

export interface WizardData {
  step: number;
  id_type: "serial" | "pin";
  serial: string;
  engine_serial: string;
  road_reg: string;
  make: string;
  model: string;
  model_id: string;
  variant: string;
  year: string;
  category: string;
  hour_meter: string;
  color: string;
  service_weight_kg: string;
  engine_power_kw: string;
  fuel_type: string;
  emission_stage: string;
  has_lifting_device: boolean;
  registration_type: "permanent" | "temporary";
  valid_until: string;
  origin_country: string;
  owner: "self" | "other";
  owner_org_number: string;
  owner_email: string;
  owner_name: string;
  financing: boolean;
  fin_holder: string;
  fin_type: string;
  fin_ref: string;
  fin_end: string;
  label_code: string;
  nameplate_doc: string;
  photo_doc: string;
  ocr_fields: string[];
}

const EMPTY: WizardData = {
  step: 1, id_type: "serial", serial: "", engine_serial: "", road_reg: "", make: "", model: "", model_id: "", variant: "", year: "", category: "",
  hour_meter: "", color: "", service_weight_kg: "", engine_power_kw: "", fuel_type: "", emission_stage: "", has_lifting_device: false,
  registration_type: "permanent", valid_until: "", origin_country: "", owner: "self", owner_org_number: "", owner_email: "", owner_name: "",
  financing: false, fin_holder: "", fin_type: "ownership_reservation", fin_ref: "", fin_end: "", label_code: "", nameplate_doc: "", photo_doc: "", ocr_fields: [],
};

/** The register payload for register_machine (see app.create_machine). */
export function toRegisterData(d: WizardData): Record<string, unknown> {
  const identifiers = [
    d.serial.trim() && { type: d.id_type, value: d.serial.trim(), source: d.ocr_fields.includes("serial") ? "ocr" : "manual" },
    d.engine_serial.trim() && { type: "engine_serial", value: d.engine_serial.trim() },
    d.road_reg.trim() && { type: "road_reg", value: d.road_reg.trim(), external_system: "transportstyrelsen" },
  ].filter(Boolean);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", ".")));
  return {
    identifiers, make: d.make.trim(), model: d.model.trim(), model_id: d.model_id || null, variant: d.variant.trim() || null, year: num(d.year),
    category: d.category, hour_meter: num(d.hour_meter), color: d.color.trim() || null, service_weight_kg: num(d.service_weight_kg),
    engine_power_kw: num(d.engine_power_kw), fuel_type: d.fuel_type || null, emission_stage: d.emission_stage || null,
    has_lifting_device: d.has_lifting_device, registration_type: d.registration_type,
    valid_until: d.registration_type === "temporary" ? d.valid_until || null : null,
    origin_country: d.registration_type === "temporary" ? d.origin_country.trim().toUpperCase() || null : null,
    owner_org_number: d.owner === "other" ? d.owner_org_number.trim() || null : null,
    owner_email: d.owner === "other" ? d.owner_email.trim() || null : null,
    owner_name: d.owner === "other" ? d.owner_name.trim() || null : null,
    label_code: d.label_code.trim().toUpperCase() || null,
  };
}

/** Required fields per step; returns i18n keys of the errors. */
export function validateStep(d: WizardData, step: number, dup: IdentifierCheck | null): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    if (d.serial.replace(/[\s-]/g, "").length < 4) e.serial = "wizard.err_serial";
    if (dup?.exists) e.serial = "wizard.err_duplicate";
  }
  if (step === 2) {
    if (!d.make.trim()) e.make = "common.required";
    if (!d.model.trim()) e.model = "common.required";
    if (!d.category) e.category = "common.required";
    const y = Number(d.year);
    if (d.year && (!Number.isInteger(y) || y < 1950 || y > new Date().getFullYear() + 1)) e.year = "wizard.err_year";
    if (d.hour_meter && !/^\d[\d\s]*$/.test(d.hour_meter.trim())) e.hour_meter = "wizard.err_number";
    if (d.registration_type === "temporary" && !d.valid_until) e.valid_until = "common.required";
    if (d.registration_type === "temporary" && !/^[A-Za-z]{2}$/.test(d.origin_country.trim())) e.origin_country = "wizard.err_country";
  }
  if (step === 3) {
    if (d.owner === "other" && !d.owner_org_number.trim()) e.owner_org_number = "common.required";
    if (d.owner === "other" && d.owner_email && !/^\S+@\S+\.\S+$/.test(d.owner_email)) e.owner_email = "wizard.err_email";
    if (d.financing && !d.fin_holder) e.fin_holder = "common.required";
    if (d.financing && d.fin_type === "ownership_reservation" && !d.fin_end) e.fin_end = "actions.encumbrance.end_required";
  }
  return e;
}

type Result = { id: string; reg_number: string; status: string; existing_reg_number: string | null; warnings: { code: string }[]; factory_data: boolean };

/** Register machine wizard (SPEC §6.2): 4 steps, autosaved draft, < 2 minutes on mobile. */
export function RegisterWizard() {
  const { t } = useTranslation();
  const { orgId, path, org } = useOrg();
  const [params, setParams] = useSearchParams();
  const draftParam = params.get("draft");
  const [draftId, setDraftId] = useState<string | null>(draftParam);
  const [d, setD] = useState<WizardData>(EMPTY);
  const [loaded, setLoaded] = useState(!draftParam);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dup, setDup] = useState<IdentifierCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);
  const dirty = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Resume a draft.
  useEffect(() => {
    if (!draftParam) return;
    void rpc<{ id: string; draft_data: Partial<WizardData> }[]>("list_machine_drafts", { p_org_id: orgId }).then((list) => {
      const found = list.find((x) => x.id === draftParam);
      if (found) setD({ ...EMPTY, ...found.draft_data });
      setLoaded(true);
    });
  }, [draftParam, orgId]);

  // Autosave (debounced) while the user types.
  useEffect(() => {
    if (!loaded || !dirty.current || result) return;
    const h = setTimeout(async () => {
      try {
        const r = await rpc<{ id: string; saved_at: string }>("save_machine_draft", { p_org_id: orgId, p_data: d, p_draft_id: draftId });
        if (!draftId) {
          setDraftId(r.id);
          setParams({ draft: r.id }, { replace: true });
        }
        setSavedAt(r.saved_at);
      } catch {
        /* autosave is best effort; the register call reports real errors */
      }
    }, 1200);
    return () => clearTimeout(h);
  }, [d, loaded, orgId, draftId, result, setParams]);

  useEffect(() => { heading.current?.focus(); }, [d.step, result]);

  const set = <K extends keyof WizardData>(k: K, v: WizardData[K]) => {
    dirty.current = true;
    setD((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };
  const patch = (p: Partial<WizardData>) => { dirty.current = true; setD((x) => ({ ...x, ...p })); };
  const err = (k: string) => (errors[k] ? t(errors[k]!) : null);

  function next() {
    const e = validateStep(d, d.step, dup);
    setErrors(e);
    if (Object.keys(e).length === 0) patch({ step: d.step + 1 });
  }

  async function ensureDraft(): Promise<string> {
    if (draftId) return draftId;
    const r = await rpc<{ id: string }>("save_machine_draft", { p_org_id: orgId, p_data: d, p_draft_id: null });
    setDraftId(r.id);
    setParams({ draft: r.id }, { replace: true });
    return r.id;
  }

  async function register() {
    for (const s of [1, 2, 3]) {
      const e = validateStep(d, s, dup);
      if (Object.keys(e).length) { setErrors(e); patch({ step: s }); return; }
    }
    setBusy(true);
    setError(null);
    try {
      const r = await rpc<Result>("register_machine", { p_org_id: orgId, p_data: toRegisterData(d), p_draft_id: draftId });
      if (d.photo_doc) await rpc("set_primary_photo", { p_org_id: orgId, p_machine_id: r.id, p_document_id: d.photo_doc }).catch(() => undefined);
      if (d.financing && d.fin_holder) {
        await rpc("request_encumbrance", { p_org_id: orgId, p_machine_id: r.id, p_holder_org_id: d.fin_holder, p_type: d.fin_type,
          p_contract_ref: d.fin_ref || null, p_end_date: d.fin_end || null });
      }
      setResult(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <Skeleton lines={6} />;
  if (result) return <Done r={result} withLabel={!!d.label_code} onNext={() => { setResult(null); setD(EMPTY); setDraftId(null); dirty.current = false; setParams({}, { replace: true }); }} />;

  const steps = [t("wizard.step_identity"), t("wizard.step_machine"), t("wizard.step_owner"), t("wizard.step_label")];
  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("wizard.title")} crumbs={[{ to: path("machines"), label: t("machines.title") }, { label: t("wizard.title") }]} />
      <ol className="guide-steg" aria-label={t("wizard.progress")}>
        {steps.map((s, i) => (
          <li key={s} aria-current={d.step === i + 1 ? "step" : undefined} className={d.step > i + 1 ? "is-klar" : undefined}><span>{s}</span></li>
        ))}
      </ol>
      <p className="t-liten t-sekundar" aria-live="polite">{savedAt ? t("wizard.saved", { at: formatDateTime(savedAt) }) : t("wizard.autosave")}</p>
      <form className="stack-5" noValidate onSubmit={(e) => { e.preventDefault(); if (d.step < 4) next(); else void register(); }}>
        <h2 ref={heading} tabIndex={-1} className="t-rubrik-3">{t("wizard.step_n", { n: d.step, total: 4 })}: {steps[d.step - 1]}</h2>
        {d.step === 1 && <StepIdentity d={d} set={set} patch={patch} err={err} onDup={setDup} ensureDraft={ensureDraft} />}
        {d.step === 2 && <StepMachine d={d} set={set} patch={patch} err={err} ensureDraft={ensureDraft} />}
        {d.step === 3 && <StepOwner d={d} set={set} err={err} orgName={org.name} />}
        {d.step === 4 && <StepLabel d={d} set={set} />}
        {error != null && <ErrorNotice error={error} />}
        <div className="mid-rad mid-rad-mellan">
          {d.step > 1 ? <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => patch({ step: d.step - 1 })}><Icon name="pil-vanster" />{t("common.back")}</button> : <span />}
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}>
            {d.step < 4 ? <>{t("common.next")}<Icon name="pil-hoger" /></> : busy ? t("common.loading") : t("wizard.register")}
          </button>
        </div>
      </form>
    </div>
  );
}

type Setter = <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function StepIdentity({ d, set, patch, err, onDup, ensureDraft }: {
  d: WizardData; set: Setter; patch(p: Partial<WizardData>): void; err(k: string): string | null; onDup(c: IdentifierCheck | null): void; ensureDraft(): Promise<string>;
}) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<unknown>(null);
  const [suggestion, setSuggestion] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [oem, setOem] = useState<IdentifierCheck["oem"]>(null);
  const cam = useRef<HTMLInputElement>(null);

  async function photo(f: File | undefined) {
    if (!f) return;
    setOcrBusy(true);
    setOcrError(null);
    setPreview(URL.createObjectURL(f));
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const media = f.type === "image/png" ? "image/png" : "image/jpeg";
      const s = await backend.invoke<Record<string, unknown>>("ocr-nameplate", { image_base64: toBase64(bytes), media_type: media });
      setSuggestion(s);
      const draft = await ensureDraft();
      const doc = await uploadDocument({ orgId, machineId: draft, type: "photo_nameplate", file: f, visibility: "verifiers" }).catch(() => null);
      if (doc) patch({ nameplate_doc: doc.id });
    } catch (e) {
      setOcrError(e);
    } finally {
      setOcrBusy(false);
    }
  }

  function accept(field: string, value: unknown) {
    const map: Record<string, keyof WizardData> = { serial: "serial", pin: "serial", make: "make", model: "model", year: "year",
      engine_serial: "engine_serial", weight_kg: "service_weight_kg" };
    const k = map[field];
    if (!k) return;
    patch({ [k]: String(value), ...(field === "pin" ? { id_type: "pin" as const } : {}), ocr_fields: [...d.ocr_fields, field === "pin" ? "serial" : field] });
    setSuggestion((s) => (s ? Object.fromEntries(Object.entries(s).filter(([x]) => x !== field)) : s));
  }

  const fields = suggestion ? Object.entries(suggestion).filter(([k, v]) => v !== null && v !== "" && !["confidence", "provider"].includes(k)) : [];
  return (
    <div className="stack-4">
      <section className="panel stack-3">
        <p className="t-brodtext">{t("wizard.photo_lead")}</p>
        <input ref={cam} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={(e) => void photo(e.target.files?.[0])} />
        <div><button type="button" className="mid-knapp mid-knapp-sekundar" onClick={() => cam.current?.click()} disabled={ocrBusy}>
          <Icon name="kamera" />{ocrBusy ? t("wizard.reading") : t("wizard.photo_nameplate")}</button></div>
        {preview && <img className="foto-forhand" src={preview} alt={t("wizard.nameplate_alt")} />}
        {ocrError != null && <ErrorNotice error={ocrError} title={t("wizard.ocr_failed")} />}
        {fields.length > 0 && (
          <div className="stack-2" aria-live="polite">
            <p className="mid-etikett">{t("wizard.ocr_suggestions")}</p>
            <ul className="radlista">
              {fields.map(([k, v]) => (
                <li key={k}>
                  <span><span className="t-liten t-sekundar">{t(`wizard.ocr_field.${k}`, { defaultValue: k })}</span><br /><strong className="mid-id">{String(v)}</strong></span>
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => accept(k, v)}><Icon name="bock" />{t("wizard.use")}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <fieldset className="stack-2">
        <legend className="mid-etikett">{t("wizard.id_type")}</legend>
        <div className="mid-val">
          {(["serial", "pin"] as const).map((x) => (
            <label key={x}><input type="radio" checked={d.id_type === x} onChange={() => set("id_type", x)} />
              <span>{t(`enum.identifier_type.${x}`)}<small>{t(`wizard.id_hint_${x}`)}</small></span></label>
          ))}
        </div>
      </fieldset>
      <FormField label={t(`enum.identifier_type.${d.id_type}`)} error={err("serial")}>
        <SerialInput type={d.id_type} value={d.serial} onChange={(v) => set("serial", v)}
          onCheck={(c) => { onDup(c); setOem(c?.oem ?? null); }} />
      </FormField>
      {oem && !d.make && (
        <Notice kind="ok" title={t("wizard.factory_found", { make: oem.make, model: oem.model })}>
          <p className="t-liten">{t("wizard.factory_body")}</p>
          <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten"
            onClick={() => patch({ make: oem.make, model: oem.model, year: oem.year ? String(oem.year) : d.year,
              category: (oem.category as string) ?? d.category, service_weight_kg: oem.service_weight_kg ? String(oem.service_weight_kg) : d.service_weight_kg,
              engine_power_kw: oem.engine_power_kw ? String(oem.engine_power_kw) : d.engine_power_kw, fuel_type: (oem.fuel_type as string) ?? d.fuel_type,
              emission_stage: (oem.emission_stage as string) ?? d.emission_stage })}>{t("wizard.use_factory")}</button>
        </Notice>
      )}
      <div className="rutnat">
        <FormField className="kol-6" label={t("enum.identifier_type.engine_serial")} optional>
          <input className="mid-input is-id" value={d.engine_serial} onChange={(e) => set("engine_serial", e.target.value)} autoCapitalize="characters" />
        </FormField>
        <FormField className="kol-6" label={t("enum.identifier_type.road_reg")} optional hint={t("wizard.road_reg_hint")}>
          <input className="mid-input is-id" value={d.road_reg} onChange={(e) => set("road_reg", e.target.value.toUpperCase())} maxLength={7} autoCapitalize="characters" />
        </FormField>
      </div>
    </div>
  );
}

interface Model { id: string; make: string; model: string; category: string; weight_kg: number | null; engine_kw: number | null; fuel_type: string | null; emission_stage: string | null; has_lifting_device: boolean | null }

function StepMachine({ d, set, patch, err, ensureDraft }: { d: WizardData; set: Setter; patch(p: Partial<WizardData>): void; err(k: string): string | null; ensureDraft(): Promise<string> }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(h); }, [q]);
  const models = useRpc<Model[]>("search_models", debounced.trim().length >= 2 ? { p_query: debounced, p_limit: 8 } : null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<unknown>(null);
  const cam = useRef<HTMLInputElement>(null);

  function pick(m: Model) {
    patch({ model_id: m.id, make: m.make, model: m.model, category: m.category,
      service_weight_kg: m.weight_kg ? String(m.weight_kg) : d.service_weight_kg, engine_power_kw: m.engine_kw ? String(m.engine_kw) : d.engine_power_kw,
      fuel_type: m.fuel_type ?? d.fuel_type, emission_stage: m.emission_stage ?? d.emission_stage, has_lifting_device: m.has_lifting_device ?? d.has_lifting_device });
    setQ("");
  }

  async function photo(f: File | undefined) {
    if (!f) return;
    setPhotoBusy(true);
    setPhotoErr(null);
    try {
      const draft = await ensureDraft();
      const doc = await uploadDocument({ orgId, machineId: draft, type: "photo_machine", file: f, visibility: "public" });
      patch({ photo_doc: doc.id });
    } catch (e) {
      setPhotoErr(e);
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="stack-4">
      <FormField label={t("wizard.model_search")} hint={t("wizard.model_search_hint")} optional>
        <input className="mid-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Volvo EC220" />
      </FormField>
      {(models.data?.length ?? 0) > 0 && q && (
        <ul className="handlingar" aria-label={t("wizard.model_results")}>
          {models.data!.map((m) => (
            <li key={m.id}><button type="button" className="handling" onClick={() => pick(m)}>
              <strong>{m.make} {m.model}</strong><span className="t-liten t-sekundar">{t(`enum.category.${m.category}`)}{m.weight_kg ? ` · ${m.weight_kg} kg` : ""}</span>
            </button></li>
          ))}
        </ul>
      )}
      <div className="rutnat">
        <FormField className="kol-6" label={t("wizard.make")} error={err("make")}>
          <input className="mid-input" value={d.make} onChange={(e) => { set("make", e.target.value); set("model_id", ""); }} />
        </FormField>
        <FormField className="kol-6" label={t("wizard.model")} error={err("model")}>
          <input className="mid-input" value={d.model} onChange={(e) => { set("model", e.target.value); set("model_id", ""); }} />
        </FormField>
        <FormField className="kol-6" label={t("wizard.category")} error={err("category")}>
          <select className="mid-select" value={d.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">{t("common.select")}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`enum.category.${c}`)}</option>)}
          </select>
        </FormField>
        <FormField className="kol-3" label={t("machines.col_year")} error={err("year")} optional>
          <input className="mid-input" inputMode="numeric" value={d.year} onChange={(e) => set("year", e.target.value)} maxLength={4} />
        </FormField>
        <FormField className="kol-3" label={t("machine.hours")} error={err("hour_meter")} optional>
          <input className="mid-input" inputMode="numeric" value={d.hour_meter} onChange={(e) => set("hour_meter", e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("wizard.variant")} optional>
          <input className="mid-input" value={d.variant} onChange={(e) => set("variant", e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("wizard.color")} optional>
          <input className="mid-input" value={d.color} onChange={(e) => set("color", e.target.value)} />
        </FormField>
      </div>
      <details className="stack-3">
        <summary className="mid-etikett">{t("wizard.technical")}</summary>
        <div className="rutnat">
          <FormField className="kol-6" label={t("wizard.weight")} optional hint={t("wizard.weight_hint")}>
            <input className="mid-input" inputMode="numeric" value={d.service_weight_kg} onChange={(e) => set("service_weight_kg", e.target.value)} />
          </FormField>
          <FormField className="kol-6" label={t("wizard.power")} optional>
            <input className="mid-input" inputMode="decimal" value={d.engine_power_kw} onChange={(e) => set("engine_power_kw", e.target.value)} />
          </FormField>
          <FormField className="kol-6" label={t("wizard.fuel")} optional>
            <select className="mid-select" value={d.fuel_type} onChange={(e) => set("fuel_type", e.target.value)}>
              <option value="">{t("common.select")}</option>
              {FUELS.map((f) => <option key={f} value={f}>{t(`enum.fuel.${f}`)}</option>)}
            </select>
          </FormField>
          <FormField className="kol-6" label={t("wizard.emission")} optional>
            <select className="mid-select" value={d.emission_stage} onChange={(e) => set("emission_stage", e.target.value)}>
              <option value="">{t("common.select")}</option>
              {EMISSIONS.map((f) => <option key={f} value={f}>{t(`enum.emission.${f}`)}</option>)}
            </select>
          </FormField>
        </div>
        <label className="mid-kryss"><input type="checkbox" checked={d.has_lifting_device} onChange={(e) => set("has_lifting_device", e.target.checked)} />{t("wizard.lifting")}</label>
        <label className="mid-kryss"><input type="checkbox" checked={d.registration_type === "temporary"}
          onChange={(e) => set("registration_type", e.target.checked ? "temporary" : "permanent")} />{t("wizard.temporary")}</label>
        {d.registration_type === "temporary" && (
          <div className="rutnat">
            <FormField className="kol-6" label={t("wizard.valid_until")} error={err("valid_until")}>
              <input className="mid-input" type="date" min={todayIso()} value={d.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
            </FormField>
            <FormField className="kol-6" label={t("wizard.origin_country")} error={err("origin_country")} hint="DE, NO, FI …">
              <input className="mid-input is-id" maxLength={2} value={d.origin_country} onChange={(e) => set("origin_country", e.target.value.toUpperCase())} />
            </FormField>
          </div>
        )}
      </details>
      <section className="stack-2">
        <p className="mid-etikett">{t("wizard.machine_photo")}</p>
        <input ref={cam} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => void photo(e.target.files?.[0])} />
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-kontur" disabled={photoBusy} onClick={() => cam.current?.click()}>
            <Icon name="kamera" />{photoBusy ? t("common.loading") : d.photo_doc ? t("wizard.photo_replace") : t("wizard.photo_add")}</button>
          {d.photo_doc && <span className="t-liten"><Icon name="bock" className="ikon-inline" /> {t("wizard.photo_saved")}</span>}
        </div>
        {photoErr != null && <ErrorNotice error={photoErr} />}
      </section>
    </div>
  );
}

function StepOwner({ d, set, err, orgName }: { d: WizardData; set: Setter; err(k: string): string | null; orgName: string }) {
  const { t } = useTranslation();
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const financiers = useRpc<OrgBrief[]>("list_partner_orgs", d.financing ? { p_type: "financier" } : null);
  return (
    <div className="stack-4">
      <fieldset className="stack-2">
        <legend className="mid-etikett">{t("wizard.owner")}</legend>
        <div className="mid-val">
          <label><input type="radio" checked={d.owner === "self"} onChange={() => set("owner", "self")} /><span>{orgName}<small>{t("wizard.owner_self")}</small></span></label>
          <label><input type="radio" checked={d.owner === "other"} onChange={() => set("owner", "other")} /><span>{t("wizard.owner_other")}<small>{t("wizard.owner_other_hint")}</small></span></label>
        </div>
      </fieldset>
      {d.owner === "other" && (
        <>
          <FormField label={t("common.org_number")} error={err("owner_org_number")}>
            <CompanyLookupField value={d.owner_org_number} onChange={(v) => set("owner_org_number", v)}
              onFound={(c) => { setCompany(c); if (c) set("owner_name", c.name); }} />
          </FormField>
          {company && <p className="t-liten">{company.existing_org ? t("wizard.owner_exists", { name: company.name }) : t("wizard.owner_new", { name: company.name })}</p>}
          <FormField label={t("wizard.owner_email")} optional hint={t("wizard.owner_email_hint")} error={err("owner_email")}>
            <input className="mid-input" type="email" value={d.owner_email} onChange={(e) => set("owner_email", e.target.value)} autoComplete="off" />
          </FormField>
        </>
      )}
      <fieldset className="stack-2">
        <legend className="mid-etikett">{t("wizard.financing_question")}</legend>
        <div className="mid-val">
          <label><input type="radio" checked={!d.financing} onChange={() => set("financing", false)} /><span>{t("common.no")}</span></label>
          <label><input type="radio" checked={d.financing} onChange={() => set("financing", true)} /><span>{t("common.yes")}<small>{t("wizard.financing_hint")}</small></span></label>
        </div>
      </fieldset>
      {d.financing && (
        <div className="rutnat">
          <FormField className="kol-6" label={t("actions.encumbrance.holder")} error={err("fin_holder")}>
            <select className="mid-select" value={d.fin_holder} onChange={(e) => set("fin_holder", e.target.value)}>
              <option value="">{t("common.select")}</option>
              {(financiers.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </FormField>
          <FormField className="kol-3" label={t("common.type")}>
            <select className="mid-select" value={d.fin_type} onChange={(e) => set("fin_type", e.target.value)}>
              {["ownership_reservation", "leasing", "rental", "other"].map((x) => <option key={x} value={x}>{t(`enum.encumbrance_type.${x}`)}</option>)}
            </select>
          </FormField>
          <FormField className="kol-3" label={t("actions.encumbrance.contract_ref")} optional>
            <input className="mid-input is-id" value={d.fin_ref} onChange={(e) => set("fin_ref", e.target.value)} />
          </FormField>
          <FormField className="kol-6" label={t("actions.encumbrance.end")} optional={d.fin_type !== "ownership_reservation"} error={err("fin_end")}>
            <input className="mid-input" type="date" min={todayIso()} value={d.fin_end} onChange={(e) => set("fin_end", e.target.value)} />
          </FormField>
        </div>
      )}
    </div>
  );
}

function StepLabel({ d, set }: { d: WizardData; set: Setter }) {
  const { t } = useTranslation();
  const [scan, setScan] = useState(false);
  const [skip, setSkip] = useState(!d.label_code);
  return (
    <div className="stack-4">
      <p className="t-brodtext">{t("wizard.label_lead")}</p>
      {scan ? (
        <ScannerView onResult={(r) => { if (r.kind === "label") { set("label_code", r.code); setScan(false); setSkip(false); } }} />
      ) : (
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={() => setScan(true)}><Icon name="qr" />{t("wizard.label_scan")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={() => { set("label_code", ""); setSkip(true); }}>{t("wizard.label_skip")}</button>
        </div>
      )}
      <FormField label={t("actions.label.code")} optional>
        <input className="mid-input is-id" value={d.label_code} onChange={(e) => { set("label_code", e.target.value); setSkip(false); }} autoCapitalize="characters" placeholder="MID-XXXX-XXXX" />
      </FormField>
      {skip && !d.label_code && <p className="t-liten t-sekundar">{t("wizard.label_reminder")}</p>}
      <section className="panel stack-2" aria-labelledby="sammanfattning">
        <h3 id="sammanfattning" className="t-rubrik-4">{t("wizard.summary")}</h3>
        <dl className="faktarutnat">
          <div><dt>{t(`enum.identifier_type.${d.id_type}`)}</dt><dd className="mid-id">{d.serial}</dd></div>
          <div><dt>{t("wizard.model")}</dt><dd>{d.make} {d.model}{d.year ? ` · ${d.year}` : ""}</dd></div>
          <div><dt>{t("wizard.category")}</dt><dd>{d.category ? t(`enum.category.${d.category}`) : "–"}</dd></div>
          <div><dt>{t("wizard.owner")}</dt><dd>{d.owner === "self" ? t("wizard.owner_self") : d.owner_name || d.owner_org_number}</dd></div>
          <div><dt>{t("wizard.financing_question")}</dt><dd>{d.financing ? t("common.yes") : t("common.no")}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function Done({ r, withLabel, onNext }: { r: Result; withLabel: boolean; onNext(): void }) {
  const { t } = useTranslation();
  const { path, has } = useOrg();
  const nav = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <div className="stack-6 smal smal-bred">
      <section className="panel stack-4" aria-labelledby="klar">
        <h1 id="klar" ref={heading} tabIndex={-1} className="t-rubrik-2">{t("wizard.done_title")}</h1>
        <RegNumber value={r.reg_number} framed size="stor" copy animate />
        <div className="badge-rad"><VerificationBadge level={0} /></div>
        {r.status === "disputed" && (
          <Notice kind="fel" title={t("wizard.done_disputed", { reg: formatReg(r.existing_reg_number) })}><p className="t-liten">{t("wizard.done_disputed_body")}</p></Notice>
        )}
        {r.warnings.some((w) => w.code === "vtr_owner_mismatch") && <Notice kind="info" title={t("wizard.vtr_mismatch")} />}
        {r.factory_data && <p className="t-liten"><Icon name="bock" className="ikon-inline" /> {t("wizard.done_factory")}</p>}
        {!withLabel && <p className="t-liten t-sekundar">{t("wizard.label_reminder")}</p>}
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => nav(path(`machines/${r.id}?tab=documents`))}><Icon name="uppladdning" />{t("wizard.done_upload")}</button>
          {has("dealer") && <Link className="mid-knapp mid-knapp-kontur" to={path(`sales/new?machine=${r.id}`)}>{t("dealer.sell")}</Link>}
          <Link className="mid-knapp mid-knapp-kontur" to={path(`machines/${r.id}`)}>{t("wizard.done_open")}</Link>
          <button type="button" className="mid-knapp mid-knapp-kontur" onClick={onNext}><Icon name="plus" />{t("wizard.done_next")}</button>
        </div>
      </section>
    </div>
  );
}
