import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeIdentifier, validateLookupQuery } from "../lib/identifier";
import { Icon } from "./Icon";

/**
 * Registersöket. Etikett ovanför, hjälptext under, ID-ramen i fokus.
 * Knappen är vyns primärknapp och heter "Sök i registret".
 */
export function LookupField({
  initialValue = "",
  autoFocus = false,
  error: externalError,
}: {
  initialValue?: string;
  autoFocus?: boolean;
  error?: string | null;
}) {
  const id = useId();
  const navigate = useNavigate();
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? externalError ?? null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateLookupQuery(value);
    setError(problem);
    if (problem) return;
    navigate(`/sok?q=${encodeURIComponent(normalizeIdentifier(value))}`);
  }

  return (
    <form className="mid-sok" role="search" onSubmit={submit} noValidate>
      <label className="mid-etikett" htmlFor={id}>
        Serienummer, PIN eller registernummer
      </label>
      <div className="mid-sok-rad">
        <div className={["mid-falt", focused && "is-aktiv", shownError && "is-fel"].filter(Boolean).join(" ")}>
          <Icon name="sok" />
          <input
            id={id}
            name="q"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Till exempel 7KX0L2T4003198"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus={autoFocus}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={`${id}-hjalp`}
          />
        </div>
        <button className="mid-knapp mid-knapp-primar" type="submit">
          Sök i registret
        </button>
      </div>
      {shownError ? (
        <p className="mid-fel" id={`${id}-hjalp`} role="alert">
          <Icon name="varning" />
          {shownError}
        </p>
      ) : (
        <p className="mid-hjalp" id={`${id}-hjalp`}>
          Numret står på maskinens typskylt.
        </p>
      )}
    </form>
  );
}
