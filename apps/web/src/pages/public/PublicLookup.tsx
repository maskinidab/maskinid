import { validateRegNumber } from "@maskinid/shared/regnr.ts";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";

/**
 * Public lookup by registration number only (no serial search publicly – SPEC §11.3). The check character is validated
 * before any request: "Ogiltigt nummer" without a database call (SPEC §5.1).
 */
export function PublicLookup() {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateRegNumber(value);
    if (!v.ok) return setError(t("errors.INVALID_REG"));
    navigate(`/r/${v.value}`);
  }
  return (
    <form className="mid-sok" role="search" onSubmit={submit} noValidate>
      <label className="mid-etikett" htmlFor={id}>{t("public.lookup_label")}</label>
      <div className="mid-sok-rad">
        <div className={["mid-falt", focused && "is-aktiv", error && "is-fel"].filter(Boolean).join(" ")}>
          <Icon name="sok" />
          <input id={id} value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)} placeholder={t("public.lookup_placeholder")} autoComplete="off" autoCapitalize="characters"
            spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hjalp`} />
        </div>
        <button className="mid-knapp mid-knapp-primar" type="submit">{t("public.lookup_button")}</button>
      </div>
      {error ? <p className="mid-fel" id={`${id}-hjalp`} role="alert"><Icon name="varning" />{error}</p>
        : <p className="mid-hjalp" id={`${id}-hjalp`}>{t("public.lookup_hint")}</p>}
    </form>
  );
}
