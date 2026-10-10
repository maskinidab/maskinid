import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { backend } from "../lib/backend";
import { ErrorNotice } from "./Feedback";
import { Icon } from "./Icon";

/**
 * Photograph or pick a file, have an Edge Function read it, and confirm the result field by field.
 *
 * Lifted out of the registration wizard (SPEC §6.2 step 1) so the same pattern serves the nameplate photo, the
 * trade-in "Fota VIN/serienummer" entry and "Bifoga dokument" on a financing. Nothing is written anywhere here:
 * the caller decides what to do with a confirmed field, exactly as the wizard always did.
 */
export type OcrFn = "ocr-nameplate" | "ocr-financing-document";

/** The two functions differ in what they call the payload; keep that detail in one place. */
const BODY_KEY: Record<OcrFn, string> = { "ocr-nameplate": "image_base64", "ocr-financing-document": "file_base64" };
const DEFAULT_ACCEPT: Record<OcrFn, string> = {
  "ocr-nameplate": "image/jpeg,image/png",
  "ocr-financing-document": "application/pdf,image/jpeg,image/png",
};

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function useOcr(fn: OcrFn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [suggestion, setSuggestion] = useState<Record<string, unknown> | null>(null);

  async function read(file: File): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const media = file.type === "application/pdf" ? "application/pdf" : file.type === "image/png" ? "image/png" : "image/jpeg";
      const r = await backend.invoke<Record<string, unknown>>(fn, { [BODY_KEY[fn]]: toBase64(bytes), media_type: media });
      setSuggestion(r);
      return r;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(false);
    }
  }
  /** Drops a field once the user has accepted (or rejected) it, so the list shrinks as they work. */
  const drop = (field: string) => setSuggestion((s) => (s ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== field)) : s));
  return { busy, error, suggestion, read, drop, reset: () => { setSuggestion(null); setError(null); } };
}

/** Never offered for confirmation: scoring and provenance rather than data off the document. */
const META_FIELDS = ["confidence", "field_confidence", "provider", "document_kind"];

export function OcrSuggestionList({ suggestion, labelKey, onAccept, title }: {
  suggestion: Record<string, unknown> | null;
  /** i18n prefix for the field labels, e.g. "wizard.ocr_field" or "financing.ocr_field". */
  labelKey: string;
  onAccept(field: string, value: unknown): void;
  title?: string;
}) {
  const { t } = useTranslation();
  const fields = suggestion
    ? Object.entries(suggestion).filter(([k, v]) => v !== null && v !== "" && v !== undefined && !META_FIELDS.includes(k))
    : [];
  if (!fields.length) return null;
  return (
    <div className="stack-2" aria-live="polite">
      <p className="mid-etikett">{title ?? t("wizard.ocr_suggestions")}</p>
      <ul className="radlista">
        {fields.map(([k, v]) => (
          <li key={k}>
            <span>
              <span className="t-liten t-sekundar">{t(`${labelKey}.${k}`, { defaultValue: k })}</span>
              <br />
              <strong className="mid-id">{String(v)}</strong>
            </span>
            <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => onAccept(k, v)}>
              <Icon name="bock" />
              {t("wizard.use")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The capture button itself. `camera` opens the rear camera straight away on mobile; without it the user gets a
 * normal file picker (which is what you want for a PDF agreement).
 */
export function OcrCapture({ fn, label, busyLabel, accept, camera = false, onFile, busy, preview = true }: {
  fn: OcrFn;
  label: string;
  busyLabel: string;
  accept?: string;
  camera?: boolean;
  onFile(file: File): void | Promise<void>;
  busy: boolean;
  preview?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { t } = useTranslation();
  return (
    <div className="stack-2">
      <input
        ref={input}
        type="file"
        hidden
        accept={accept ?? DEFAULT_ACCEPT[fn]}
        {...(camera ? { capture: "environment" as const } : {})}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (preview && f.type.startsWith("image/")) setPreviewUrl(URL.createObjectURL(f));
          void onFile(f);
        }}
      />
      <div>
        <button type="button" className="mid-knapp mid-knapp-sekundar" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name={camera ? "kamera" : "uppladdning"} />
          {busy ? busyLabel : label}
        </button>
      </div>
      {previewUrl && <img className="foto-forhand" src={previewUrl} alt={t("wizard.nameplate_alt")} />}
    </div>
  );
}

export function OcrError({ error, title }: { error: unknown; title: string }) {
  if (error == null) return null;
  return <ErrorNotice error={error} title={title} />;
}
