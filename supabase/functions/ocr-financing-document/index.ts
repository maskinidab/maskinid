// Edge Function: ocr-financing-document — "Bifoga dokument" in the financing section.
// POST { file_base64, media_type } (signed-in user) → suggestion { document_kind, financier_name,
// financier_org_number, encumbrance_type, contract_ref, start_date, end_date, term_months, serial, pin, make,
// model, year, customer_name, customer_org_number, confidence }.
//
// The user confirms every field; nothing is written to the register here. Mock OCR in DEMO_MODE.
// Financing agreements are usually PDFs, so application/pdf is accepted alongside photos and the size limit
// follows RULES.maxUploadBytes rather than the 8 MB a nameplate photo needs.
//
// No amount is ever extracted or returned — the register stores none (CLAUDE.md rule 5, SPEC §0).
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { RULES } from "../_shared/shared/config.ts";
import { envRecord, userClient } from "../_shared/db.ts";
import { json, preflight } from "../_shared/http.ts";
import { createAnthropicOcr, OcrRefused } from "../_shared/anthropic-ocr.ts";
import { withSentry } from "../_shared/sentry.ts";

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];

Deno.serve(withSentry("ocr-financing-document", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const ctx = await userClient(req).rpc("my_context");
  if (ctx.error || !ctx.data) return json(401, { code: "NOT_AUTHENTICATED" });
  const body = await req.json().catch(() => ({}));
  // base64 inflates by ~4/3; compare against the same ceiling the upload path enforces.
  if (typeof body.file_base64 !== "string" || body.file_base64.length > RULES.maxUploadBytes * 1.37) {
    return json(422, { code: "VALIDATION", detail: { field: "file" } });
  }
  if (!ACCEPTED.includes(body.media_type)) return json(422, { code: "VALIDATION", detail: { field: "media_type" } });
  const { ocr } = createAdapters(envRecord(), Deno.env.get("ANTHROPIC_API_KEY") ? createAnthropicOcr() : undefined);
  try {
    return json(200, { ...(await ocr.financingDocument({ base64: body.file_base64, mediaType: body.media_type })), provider: ocr.name });
  } catch (e) {
    if (e instanceof OcrRefused) return json(422, { code: "OCR_UNAVAILABLE" });
    console.error("ocr-financing-document failed", (e as Error).name);
    return json(502, { code: "OCR_UNAVAILABLE" });
  }
}));
