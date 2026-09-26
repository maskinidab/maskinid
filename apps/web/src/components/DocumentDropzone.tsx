import { sha256Hex, stripJpegMetadata } from "@maskinid/shared/image.ts";
import { RULES } from "@maskinid/shared/config.ts";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentItem } from "../lib/api/types";
import { backend } from "../lib/backend";
import { useErrorMessage } from "./Feedback";
import { Icon } from "./Icon";

const ACCEPT = RULES.allowedUploadMimes as readonly string[];

/** Uploads one file the way the backend expects (SPEC §11.5): EXIF stripped, sha256, reserved path, finalize, AV scan. */
export async function uploadDocument(opts: {
  orgId: string; machineId: string | null; type: string; file: File; visibility?: string;
}): Promise<DocumentItem> {
  let bytes: Uint8Array = new Uint8Array(await opts.file.arrayBuffer());
  const mime = opts.file.type === "image/jpg" ? "image/jpeg" : opts.file.type;
  if (mime === "image/jpeg") bytes = stripJpegMetadata(bytes).bytes;
  const sha256 = await sha256Hex(bytes);
  const up = await backend.rpc<{ id: string; path: string }>("create_document_upload", {
    p_org_id: opts.orgId, p_machine_id: opts.machineId, p_type: opts.type, p_filename: opts.file.name, p_mime: mime,
    p_size_bytes: bytes.byteLength, p_sha256: sha256, p_visibility: opts.visibility ?? "owner",
  });
  await backend.storage.upload("documents", up.path, new Blob([bytes as BlobPart], { type: mime }), mime);
  const doc = await backend.rpc<DocumentItem>("finalize_document", { p_org_id: opts.orgId, p_document_id: up.id });
  if (backend.kind === "supabase") void backend.invoke("av-scan", { document_id: up.id }).catch(() => undefined);
  return doc;
}

/** Drag & drop, file picker and camera (mobile). Validates type and size inline. */
export function DocumentDropzone({ orgId, machineId, type, visibility, onUploaded, camera = false, multiple = true }: {
  orgId: string; machineId: string | null; type: string; visibility?: string; onUploaded(doc: DocumentItem, file: File): void;
  camera?: boolean; multiple?: boolean;
}) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }[]>([]);

  async function handle(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const mime = f.type === "image/jpg" ? "image/jpeg" : f.type;
      if (!ACCEPT.includes(mime)) {
        setStatus((s) => [...s, { text: t("components.dropzone.wrong_type", { name: f.name }), error: true }]);
        continue;
      }
      if (f.size > RULES.maxUploadBytes) {
        setStatus((s) => [...s, { text: t("components.dropzone.too_large", { name: f.name }), error: true }]);
        continue;
      }
      setStatus((s) => [...s, { text: t("components.dropzone.uploading", { name: f.name }) }]);
      try {
        const doc = await uploadDocument({ orgId, machineId, type, file: f, visibility });
        setStatus((s) => [...s.slice(0, -1), { text: t("components.dropzone.uploaded", { name: f.name }) }]);
        onUploaded(doc, f);
      } catch (e) {
        setStatus((s) => [...s.slice(0, -1), { text: `${f.name}: ${msg(e)}`, error: true }]);
      }
    }
  }

  return (
    <div className="stack-2">
      <div className={over ? "slapp-yta is-over" : "slapp-yta"} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void handle(e.dataTransfer.files); }}>
        <Icon name="uppladdning" />
        <p><strong>{t("components.dropzone.title")}</strong></p>
        <p className="mid-hjalp" id={`${id}-hjalp`}>{t("components.dropzone.hint")}</p>
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => input.current?.click()}>{t("components.dropzone.choose")}</button>
          {camera && <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => cam.current?.click()}><Icon name="kamera" />{t("components.dropzone.camera")}</button>}
        </div>
        <input ref={input} type="file" hidden multiple={multiple} accept={ACCEPT.join(",")} aria-describedby={`${id}-hjalp`}
          onChange={(e) => { void handle(e.target.files); e.target.value = ""; }} />
        {camera && <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void handle(e.target.files); e.target.value = ""; }} />}
      </div>
      <ul className="uppladdning-status" aria-live="polite">
        {status.map((s, i) => <li key={i} className={s.error ? "mid-fel" : "t-liten"}>{s.text}</li>)}
      </ul>
    </div>
  );
}
