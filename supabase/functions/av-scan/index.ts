// Edge Function: av-scan (SPEC §11.5)
//
// Called after finalize_document (client) or by the jobs runner for documents in status "scanning":
//   1. downloads the object, 2. strips JPEG metadata (EXIF/GPS) and re-uploads if anything was removed,
//   3. scans with the VirusScanner adapter (ClamAV over HTTP, mock in DEMO_MODE),
//   4. records the result; primary photos (public photo_machine) are copied to the public machine-photos bucket.
import { serviceClient, envRecord } from "../_shared/db.ts";
import { isInternalCall, json, preflight, rpcError } from "../_shared/http.ts";
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { sha256Hex, stripJpegMetadata } from "../_shared/shared/image.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("av-scan", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req) && !req.headers.get("Authorization")) return json(401, { code: "NOT_AUTHENTICATED" });
  const { document_id } = await req.json().catch(() => ({}));
  if (!document_id) return json(400, { code: "VALIDATION" });
  const db = serviceClient();
  const { data: doc, error } = await db.from("documents").select("*").eq("id", document_id).single();
  if (error || !doc) return json(404, { code: "NOT_FOUND" });
  if (!["scanning", "clean"].includes(doc.status)) return json(409, { code: "WRONG_STATUS" });
  const file = await db.storage.from("documents").download(doc.storage_path);
  if (file.error) return json(404, { code: "UPLOAD_MISSING" });
  let bytes: Uint8Array = new Uint8Array(await file.data.arrayBuffer());
  let stripped = false;
  if (doc.mime === "image/jpeg") {
    const r = stripJpegMetadata(bytes);
    if (r.removed > 0) {
      bytes = r.bytes;
      stripped = true;
      const up = await db.storage.from("documents").upload(doc.storage_path, bytes, { contentType: doc.mime, upsert: true });
      if (up.error) return json(500, { code: "STORAGE_ERROR" });
    }
  }
  const { virusScanner } = createAdapters(envRecord());
  const scan = await virusScanner.scan(bytes, doc.filename);
  const after = stripped ? await sha256Hex(bytes) : null;
  const rec = await db.rpc("record_document_scan", {
    p_document_id: doc.id, p_clean: scan.clean, p_exif_stripped: doc.mime !== "image/heic", p_sha256_after: after,
  });
  if (rec.error) return rpcError(rec.error);
  if (!scan.clean) await db.storage.from("documents").remove([doc.storage_path]);
  if (scan.clean && doc.type === "photo_machine" && doc.visibility === "public" && doc.machine_id) {
    const ext = doc.mime === "image/png" ? "png" : "jpg";
    await db.storage.from("machine-photos").upload(`${doc.machine_id}/${doc.id}.${ext}`, bytes, { contentType: doc.mime, upsert: true });
  }
  return json(200, rec.data);
}));
