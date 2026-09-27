// Edge Function: ocr-listing-images (SPEC §8.3) – called by the ingest worker (service role / cron secret).
// POST { observation_id, images: [{ base64, media_type }] } → reads serials from nameplate-like images and stores the best
// candidate on the observation (confidence ≥ 0.85 is used for matching; below that it is shown as "möjligt").
import { createAdapters } from "../_shared/shared/adapters/index.ts";
import { envRecord, serviceClient } from "../_shared/db.ts";
import { isInternalCall, json, preflight, rpcError } from "../_shared/http.ts";
import { createAnthropicOcr } from "../_shared/anthropic-ocr.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry("ocr-listing-images", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isInternalCall(req)) return json(401, { code: "NOT_AUTHENTICATED" });
  const body = await req.json().catch(() => ({}));
  const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
  const { ocr } = createAdapters(envRecord(), Deno.env.get("ANTHROPIC_API_KEY") ? createAnthropicOcr() : undefined);
  let best: { serial: string; confidence: number } | null = null;
  for (const img of images) {
    try {
      const r = await ocr.listingImage({ base64: img.base64, mediaType: img.media_type ?? "image/jpeg" });
      if (r.isNameplate && r.serial && (!best || r.confidence > best.confidence)) best = { serial: r.serial, confidence: r.confidence };
    } catch {
      /* one unreadable image never fails the batch */
    }
  }
  if (!best || !body.observation_id) return json(200, { serial: null });
  const { error } = await serviceClient().rpc("record_listing_serial", {
    p_observation_id: body.observation_id, p_serial: best.serial, p_confidence: best.confidence,
  });
  if (error) return rpcError(error);
  return json(200, best);
}));
