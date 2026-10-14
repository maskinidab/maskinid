import { labelSerial } from "@maskinid/shared/identifiers.ts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "./Dialog";
import { siteUrl } from "../lib/surfaces";

/**
 * A QR code on screen.
 *
 * `qrcode` is imported dynamically, the same way Scanner.tsx does with zxing, so it never lands in a chunk the
 * public pages pull in — those run against a Lighthouse budget. The SVG renderer is used rather than
 * toDataURL: one component then serves a 96 px table row, a 320 px dialog and a browser print without
 * resampling, and no canvas is needed (which also keeps it testable outside a browser).
 */
export function QrCode({ url, size = 180, alt }: { url: string; size?: number; alt: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 }))
      .then((s) => { if (live) setSvg(s); })
      .catch(() => { if (live) setSvg(null); });
    return () => { live = false; };
  }, [url]);
  // The only interpolated value is a URL we build ourselves; qrcode emits a fixed <svg><path> shape.
  return (
    <span className="qr-ruta" role="img" aria-label={alt} style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
  );
}

/** The QR for one label, big enough to scan off the screen, with the serial that is printed on the sticker. */
export function LabelQrDialog({ code, open, onClose, origin }: {
  code: string; open: boolean; onClose(): void; origin?: string;
}) {
  const { t } = useTranslation();
  const url = `${origin ?? siteUrl()}/m/${code}`;
  return (
    <Dialog open={open} onClose={onClose} title={t("labels.qr_title")}>
      <div className="stack-3">
        <QrCode url={url} size={260} alt={t("labels.qr_alt", { serial: labelSerial(code) })} />
        <p className="mid-id t-rubrik-4">{labelSerial(code)}</p>
        <p className="t-liten t-sekundar">{t("labels.qr_hint")}</p>
        <p className="t-liten t-sekundar">{url.replace(/^https?:\/\//, "")}</p>
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </Dialog>
  );
}
