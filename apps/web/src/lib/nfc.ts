/**
 * Web NFC (step 25): read a MaskinID NFC label – the NDEF URL record (same URL as the QR code) and the chip serial,
 * which is used to detect copied tags. Web NFC exists in Chrome on Android; elsewhere the QR code is used.
 */
interface NdefRecord { recordType: string; data?: DataView }
interface NdefReadingEvent extends Event { serialNumber: string; message: { records: NdefRecord[] } }
interface NdefReaderLike extends EventTarget { scan(opts?: { signal?: AbortSignal }): Promise<void> }

export function nfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

/** Waits for one tag (max 30 s). Returns the first URL/text record and the chip serial ("04:a1:…"). */
export async function readNfcOnce(signal?: AbortSignal): Promise<{ text: string; serial: string }> {
  const Reader = (window as unknown as { NDEFReader: new () => NdefReaderLike }).NDEFReader;
  const reader = new Reader();
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal?.addEventListener("abort", stop);
  const timer = window.setTimeout(stop, 30_000);
  try {
    await reader.scan({ signal: ctrl.signal });
    return await new Promise((resolve, reject) => {
      ctrl.signal.addEventListener("abort", () => reject(new Error("NFC_TIMEOUT")));
      reader.addEventListener("readingerror", () => reject(new Error("NFC_READ_ERROR")), { once: true });
      reader.addEventListener("reading", (ev) => {
        const e = ev as NdefReadingEvent;
        const rec = e.message.records.find((r) => (r.recordType === "url" || r.recordType === "text") && r.data);
        resolve({ text: rec?.data ? new TextDecoder().decode(rec.data) : "", serial: e.serialNumber });
      }, { once: true });
    });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    ctrl.abort();
  }
}
