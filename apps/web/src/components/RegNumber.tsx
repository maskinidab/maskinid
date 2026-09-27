import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatReg } from "../lib/format";
import { Icon } from "./Icon";
import { IdFrame } from "./IdFrame";

/** Registration number: always monospace, XXX-XXXX, optionally framed (the view's one ID frame) and copyable. */
export function RegNumber({ value, size = "normal", framed = false, copy = false, animate = false }: {
  value: string; size?: "normal" | "stor"; framed?: boolean; copy?: boolean; animate?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = <span className={size === "stor" ? "mid-id mid-id-stor" : "mid-id"} translate="no">{formatReg(value)}</span>;
  const body = (
    <span className="regnr">
      {text}
      {copy && (
        <button type="button" className="ikon-knapp" onClick={() => {
          void navigator.clipboard?.writeText(formatReg(value));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }} aria-label={t("components.reg_copy")} title={copied ? t("common.copied") : t("components.reg_copy")}>
          <Icon name={copied ? "bock" : "kopiera"} />
        </button>
      )}
    </span>
  );
  return framed ? <IdFrame size={size} animate={animate}>{body}</IdFrame> : body;
}
