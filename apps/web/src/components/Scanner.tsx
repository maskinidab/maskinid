import { labelCodeFromScan } from "@maskinid/shared/identifiers.ts";
import { normalizeRegNumber, validateRegNumber } from "@maskinid/shared/regnr.ts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { nfcSupported, readNfcOnce } from "../lib/nfc";

export type ScanResult = { kind: "label"; code: string; nfcUid?: string } | { kind: "reg"; reg: string };

/** Parses camera or manual input: a MaskinID QR URL/label code, or a registration number. */
export function parseScan(text: string): ScanResult | null {
  const code = labelCodeFromScan(text);
  if (code) return { kind: "label", code };
  const v = validateRegNumber(text);
  return v.ok ? { kind: "reg", reg: normalizeRegNumber(text) } : null;
}

/** Camera QR scanner (@zxing/browser) with manual fallback. Calls onResult once. */
export function ScannerView({ onResult, active = true }: { onResult(r: ScanResult): void; active?: boolean }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  const [manual, setManual] = useState("");
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (!active) return;
    let controls: { stop(): void } | null = null;
    let cancelled = false;
    done.current = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        if (!video.current || cancelled) return;
        controls = await reader.decodeFromVideoDevice(undefined, video.current, (res) => {
          if (!res || done.current) return;
          const parsed = parseScan(res.getText());
          if (parsed) {
            done.current = true;
            controls?.stop();
            onResult(parsed);
          } else setInvalid(true);
        });
      } catch {
        setCameraError(true);
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active, onResult]);

  return (
    <div className="skanner stack-4">
      {!cameraError ? (
        <div className="skanner-video">
          <video ref={video} muted playsInline aria-label={t("components.scan_title")} />
          <span className="skanner-ram" aria-hidden="true" />
        </div>
      ) : (
        <p className="mid-hjalp">{t("components.scan_no_camera")}</p>
      )}
      {!cameraError && <p className="mid-hjalp">{t("components.scan_hint")}</p>}
      {invalid && <p className="mid-fel" role="alert"><Icon name="varning" />{t("components.scan_invalid")}</p>}
      <form className="mid-sok-rad" onSubmit={(e) => {
        e.preventDefault();
        const r = parseScan(manual);
        if (r) onResult(r);
        else setInvalid(true);
      }}>
        <label className="visually-hidden" htmlFor="skanner-manuell">{t("components.scan_manual")}</label>
        <input id="skanner-manuell" className="mid-input is-id" value={manual} onChange={(e) => { setManual(e.target.value); setInvalid(false); }}
          placeholder={t("components.scan_manual")} autoCapitalize="characters" spellCheck={false} />
        <button type="submit" className="mid-knapp mid-knapp-sekundar">{t("common.open")}</button>
      </form>
    </div>
  );
}

/** The big Scan button (always one tap away, SPEC §10). Default: open the machine's page. */
export function ScanButton({ variant = "knapp", tone = "kontur", onResult }: {
  variant?: "knapp" | "nav"; tone?: "primar" | "sekundar" | "kontur"; onResult?(r: ScanResult): void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const handle = (r: ScanResult) => {
    setOpen(false);
    if (onResult) onResult(r);
    else navigate(r.kind === "label" ? `/m/${r.code}` : `/r/${r.reg}`, { state: r.kind === "label" && r.nfcUid ? { nfcUid: r.nfcUid } : undefined });
  };
  return (
    <>
      <button type="button" className={variant === "nav" ? "skanna-nav" : `mid-knapp mid-knapp-${tone}`} onClick={() => setOpen(true)}>
        <Icon name="qr" />
        <span>{variant === "nav" ? t("nav.scan") : t("components.scan_button")}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("components.scan_title")}>
        <ScannerView onResult={handle} active={open} />
        {open && nfcSupported() && <NfcRead onResult={handle} />}
        <button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setOpen(false)}>{t("common.close")}</button>
      </Dialog>
    </>
  );
}

/** "Läs NFC-märke" (Web NFC, Android): the tag holds the same URL as the QR code; its chip serial goes along. */
function NfcRead({ onResult }: { onResult(r: ScanResult): void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "waiting" | "error">("idle");
  async function read() {
    setState("waiting");
    try {
      const { text, serial } = await readNfcOnce();
      const r = parseScan(text);
      if (!r) { setState("error"); return; }
      onResult(r.kind === "label" ? { ...r, nfcUid: serial } : r);
    } catch { setState("error"); }
  }
  return (
    <div className="stack-2">
      <button type="button" className="mid-knapp mid-knapp-sekundar" disabled={state === "waiting"} onClick={() => void read()}>
        <Icon name="qr" />{state === "waiting" ? t("nfc.hold") : t("nfc.read")}</button>
      {state === "error" && <p className="t-liten" role="alert">{t("nfc.error")}</p>}
    </div>
  );
}
