// Edge Function: ocr-nameplate (SPEC §6.2 step 1: "Fota maskinskylten").
// POST { image_base64, media_type } (signed-in user) → suggestion { make, model, serial, pin, year, engine_serial, weight_kg, confidence }.
// The user confirms every field; nothing is written to the register here. Mock OCR in DEMO_MODE.
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, userClient } from "../_shared/db.ts";
import { json, preflight } from "../_shared/http.ts";
import { createAnthropicOcr, OcrRefused } from "../_shared/anthropic-ocr.ts";
import { withSentry } from "../_shared/sentry.ts";

const MAX = 8 * 1024 * 1024;

Deno.serve(withSentry("ocr-nameplate", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const ctx = await userClient(req).rpc("my_context");
  if (ctx.error || !ctx.data) return json(401, { code: "NOT_AUTHENTICATED" });
  const body = await req.json().catch(() => ({}));
  if (typeof body.image_base64 !== "string" || body.image_base64.length > MAX * 1.37) return json(422, { code: "VALIDATION", detail: { field: "image" } });
  if (!["image/jpeg", "image/png"].includes(body.media_type)) return json(422, { code: "VALIDATION", detail: { field: "media_type" } });
  const { ocr } = createAdapters(envRecord(), Deno.env.get("ANTHROPIC_API_KEY") ? createAnthropicOcr() : undefined);
  try {
    return json(200, { ...(await ocr.nameplate({ base64: body.image_base64, mediaType: body.media_type })), provider: ocr.name });
  } catch (e) {
    if (e instanceof OcrRefused) return json(422, { code: "OCR_UNAVAILABLE" });
    console.error("ocr-nameplate failed", (e as Error).name);
    return json(502, { code: "OCR_UNAVAILABLE" });
  }
}));
