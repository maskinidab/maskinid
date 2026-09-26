import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { Notice } from "../components/Notice";
import { api, ApiError } from "../lib/api";
import { normalizeIdentifier } from "../lib/identifier";
import { canRegisterMachine } from "../lib/permissions";
import { MACHINE_TYPES, type MachineType } from "../lib/types";

type Errors = Partial<Record<"id" | "manufacturer" | "model" | "modelYear", string>>;

export function RegisterMachinePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [serial, setSerial] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [machineType, setMachineType] = useState<MachineType>("Grävmaskin");
  const [modelYear, setModelYear] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canRegisterMachine(user)) return <Navigate to="/mina-sidor" replace />;

  function validate(): Errors {
    const e: Errors = {};
    const p = normalizeIdentifier(pin);
    const s = normalizeIdentifier(serial);
    if (!p && !s) e.id = "Ange PIN eller serienummer. Båda står på maskinens typskylt.";
    else if (p && !/^[A-Z0-9]{8,17}$/.test(p)) e.id = "PIN består av 8–17 bokstäver och siffror.";
    if (!manufacturer.trim()) e.manufacturer = "Ange tillverkare.";
    if (!model.trim()) e.model = "Ange modell.";
    const y = Number(modelYear);
    if (modelYear && (!Number.isInteger(y) || y < 1950 || y > new Date().getFullYear() + 1)) e.modelYear = "Ange årsmodell med fyra siffror.";
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.registerMachine({
        pin: normalizeIdentifier(pin) || null,
        serialNumber: normalizeIdentifier(serial) || null,
        manufacturer: manufacturer.trim(),
        model: model.trim(),
        machineType,
        modelYear: modelYear ? Number(modelYear) : null,
      });
      navigate(`/maskin/${r.machine.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Maskinen kunde inte registreras. Försök igen.");
      setBusy(false);
    }
  }

  return (
    <div className="behallare sektion-liten stack-6">
      <nav className="brodsmulor" aria-label="Brödsmulor">
        <Link to="/mina-sidor">Mina sidor</Link><span aria-hidden="true">/</span><span>Registrera maskin</span>
      </nav>
      <div className="stack-3">
        <h1 className="t-rubrik-1">Registrera maskin</h1>
        <p className="t-ingress">
          Maskinen registreras med {user?.organization.name} som registrerad ägare och får ett eget registernummer.
        </p>
      </div>

      <form className="formular stack-6" onSubmit={submit} noValidate>
        {error && <Notice kind="fel" title={error} />}
        <fieldset className="stack-4">
          <legend className="t-rubrik-4">Identifierare</legend>
          <div className="formular-rutnat">
            <FormField label="PIN" hint="Product Identification Number, 17 tecken på typskylten." error={errors.id}>
              <input className="mid-input is-id" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" spellCheck={false} />
            </FormField>
            <FormField label="Serienummer" hint="Om maskinen saknar PIN." optional>
              <input className="mid-input is-id" value={serial} onChange={(e) => setSerial(e.target.value)} autoComplete="off" spellCheck={false} />
            </FormField>
          </div>
        </fieldset>

        <fieldset className="stack-4">
          <legend className="t-rubrik-4">Maskin</legend>
          <div className="formular-rutnat">
            <FormField label="Maskintyp" className="hel">
              <select className="mid-select" value={machineType} onChange={(e) => setMachineType(e.target.value as MachineType)}>
                {MACHINE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Tillverkare" error={errors.manufacturer}>
              <input className="mid-input" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
            </FormField>
            <FormField label="Modell" error={errors.model}>
              <input className="mid-input" value={model} onChange={(e) => setModel(e.target.value)} />
            </FormField>
            <FormField label="Årsmodell" optional error={errors.modelYear}>
              <input className="mid-input" inputMode="numeric" maxLength={4} value={modelYear} onChange={(e) => setModelYear(e.target.value)} />
            </FormField>
          </div>
        </fieldset>

        <p className="t-liten t-sekundar">
          Identiteten visas som ej verifierad tills den har kontrollerats mot typskylten.
        </p>
        <div className="mid-rad">
          <button className="mid-knapp mid-knapp-primar" type="submit" disabled={busy}>
            {busy ? "Registrerar maskin" : "Registrera maskin"}
          </button>
          <Link className="mid-knapp mid-knapp-kontur" to="/mina-sidor">Avbryt</Link>
        </div>
      </form>
    </div>
  );
}
