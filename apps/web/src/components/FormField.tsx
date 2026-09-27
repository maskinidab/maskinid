import { cloneElement, useId, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

/**
 * Form field: label above, hint below. An error replaces the hint. The child (input/select/textarea) gets id,
 * aria-describedby and aria-invalid. Inline validation only – never alert() (SPEC §10).
 */
export function FormField({ label, hint, error, optional, className, children }: {
  label: string; hint?: string; error?: string | null; optional?: boolean; className?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const describedBy = error || hint ? `${id}-beskrivning` : undefined;
  return (
    <div className={["mid-faltgrupp", className].filter(Boolean).join(" ")}>
      <label className="mid-etikett" htmlFor={id}>
        {label}
        {optional && <span className="t-sekundar" style={{ fontWeight: 400 }}> ({t("common.optional")})</span>}
      </label>
      {cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? <p className="mid-fel" id={describedBy}>{error}</p> : hint ? <p className="mid-hjalp" id={describedBy}>{hint}</p> : null}
    </div>
  );
}
