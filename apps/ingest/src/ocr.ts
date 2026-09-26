/**
 * Downloads listing images (politely, via the same fetcher) and posts them to the ocr-listing-images Edge Function,
 * which classifies nameplates, reads the serial and calls record_listing_serial. Images are never stored.
 */
export function edgeOcr(functionsUrl: string, serviceKey: string, fetcher: { bytes(url: string): Promise<Uint8Array | null> }, f: typeof fetch = fetch) {
  return async (observationId: string, urls: string[]) => {
    const images: { base64: string; media_type: string }[] = [];
    for (const u of urls) {
      const b = await fetcher.bytes(u);
      if (!b || b.byteLength > 5_000_000) continue;
      images.push({ base64: Buffer.from(b).toString("base64"), media_type: /\.png$/i.test(u) ? "image/png" : /\.webp$/i.test(u) ? "image/webp" : "image/jpeg" });
    }
    if (!images.length) return;
    const res = await f(`${functionsUrl.replace(/\/$/, "")}/ocr-listing-images`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ observation_id: observationId, images }),
    });
    if (!res.ok) throw new Error(`ocr-listing-images HTTP ${res.status}`);
  };
}
