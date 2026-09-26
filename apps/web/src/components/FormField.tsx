import { cloneElement, useId, type ReactElement } from "react";

/**
 * Formulärfält: etikett ovanför, hjälptext under. Ett fel ersätter hjälptexten.
 * Barnet (input/select/textarea) får id, aria-describedby och aria-invalid.
 */
export function FormField({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const describedBy = error || hint ? `${id}-beskrivning` : undefined;
  return (
    <div className={["mid-faltgrupp", className].filter(Boolean).join(" ")}>
      <label className="mid-etikett" htmlFor={id}>
        {label}
        {optional && <span className="t-sekundar" style={{ fontWeight: 400 }}> (valfritt)</span>}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p className="mid-fel" id={describedBy}>
          {error}
        </p>
      ) : hint ? (
        <p className="mid-hjalp" id={describedBy}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
