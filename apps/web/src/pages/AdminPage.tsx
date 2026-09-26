import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { Icon } from "../components/Icon";
import { Loading, Notice } from "../components/Notice";
import { api, ApiError, dataSource } from "../lib/api";
import { formatDateIso } from "../lib/format";
import { isAdmin, ORG_TYPE_LABEL } from "../lib/permissions";
import type { OrganizationType } from "../lib/types";
import { useAsync } from "../lib/useAsync";

const ORG_TYPES: OrganizationType[] = ["maskinagare", "maskinhandlare", "langivare", "forsakringsgivare", "registerhallare"];

function InviteForm({ onDone }: { onDone(message: string): void }) {
  const orgs = useAsync(() => api.listOrganizations(), []);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) {
      setError("Välj en organisation.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await api.inviteUser({ email, fullName, organizationId, isAdmin: admin });
      setEmail("");
      setFullName("");
      setAdmin(false);
      onDone(
        dataSource === "mock"
          ? `${u.fullName} är tillagd. I demoläget skickas ingen e-post – kontot loggar in med demolösenordet.`
          : `Inbjudan skickad till ${u.email}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inbjudan kunde inte skickas. Försök igen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-4" onSubmit={submit} noValidate>
      {error && <Notice kind="fel" title={error} />}
      <div className="formular-rutnat">
        <FormField label="Namn">
          <input className="mid-input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="E-postadress">
          <input className="mid-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Organisation" className="hel">
          <select className="mid-select" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} disabled={orgs.loading}>
            <option value="">{orgs.loading ? "Hämtar organisationer" : "Välj organisation"}</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {ORG_TYPE_LABEL[o.type]}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <label className="mid-rad" style={{ gap: 8, fontSize: 15 }}>
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} style={{ accentColor: "var(--text)" }} />
        Administratör – får skapa organisationer, bjuda in användare och verifiera identitet
      </label>
      <div>
        <button className="mid-knapp mid-knapp-primar" type="submit" disabled={busy}>
          {busy ? "Skickar inbjudan" : "Skicka inbjudan"}
        </button>
      </div>
    </form>
  );
}

function OrganizationForm({ onDone }: { onDone(message: string): void }) {
  const [name, setName] = useState("");
  const [orgNr, setOrgNr] = useState("");
  const [type, setType] = useState<OrganizationType>("maskinagare");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const o = await api.createOrganization({ name, orgNr, type });
      setName("");
      setOrgNr("");
      onDone(`${o.name} är registrerad som ${ORG_TYPE_LABEL[o.type].toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Organisationen kunde inte skapas. Försök igen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-4" onSubmit={submit} noValidate>
      {error && <Notice kind="fel" title={error} />}
      <div className="formular-rutnat">
        <FormField label="Namn">
          <input className="mid-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Organisationsnummer" hint="Till exempel 556677-8899.">
          <input className="mid-input is-id" value={orgNr} onChange={(e) => setOrgNr(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Roll i registret" className="hel">
          <select className="mid-select" value={type} onChange={(e) => setType(e.target.value as OrganizationType)}>
            {ORG_TYPES.map((t) => (
              <option key={t} value={t}>
                {ORG_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div>
        <button className="mid-knapp mid-knapp-sekundar" type="submit" disabled={busy}>
          {busy ? "Skapar organisation" : "Skapa organisation"}
        </button>
      </div>
    </form>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const users = useAsync(() => api.listUsers(), [user?.id]);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  if (!isAdmin(user)) return <Navigate to="/mina-sidor" replace />;

  const done = (msg: string) => {
    setMessage(msg);
    setTick((t) => t + 1);
    users.reload();
  };

  return (
    <div className="behallare sektion-liten stack-7">
      <div className="stack-3">
        <p className="t-liten t-sekundar">{user?.organization.name}</p>
        <h1 className="t-rubrik-1">Administration</h1>
        <p className="t-ingress">Bjud in användare, registrera organisationer och se vilka som har konto i registret.</p>
      </div>

      {message && <Notice kind="ok" title={message} />}

      <div className="rutnat">
        <section className="kol-7 panel panel-register stack-4" aria-labelledby="rubrik-bjud-in">
          <h2 id="rubrik-bjud-in" className="t-rubrik-3">Bjud in användare</h2>
          <p className="t-liten t-sekundar">Användaren får en länk i e-post och företräder den valda organisationen.</p>
          <InviteForm key={`i${tick}`} onDone={done} />
        </section>
        <section className="kol-5 panel stack-4" aria-labelledby="rubrik-org">
          <h2 id="rubrik-org" className="t-rubrik-3">Ny organisation</h2>
          <p className="t-liten t-sekundar">Rollen styr vad organisationens användare får registrera.</p>
          <OrganizationForm onDone={done} />
        </section>
      </div>

      <section className="stack-4" aria-labelledby="rubrik-anvandare">
        <h2 id="rubrik-anvandare" className="t-rubrik-3">Användare</h2>
        {users.loading && !users.data && <Loading />}
        {users.error && <Notice kind="fel" title="Användarna kunde inte hämtas">{users.error.message}</Notice>}
        {users.data && (
          <div className="mid-tabell-wrap">
            <table className="mid-tabell">
              <thead>
                <tr><th>Namn</th><th>Organisation</th><th>Roll</th><th>Senast inloggad</th></tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.fullName}
                      {u.isAdmin && (
                        <span className="t-liten t-sekundar" style={{ marginLeft: 8 }}>
                          <Icon name="skold" className="ikon-inline" /> Administratör
                        </span>
                      )}
                      <div className="t-liten t-sekundar">{u.email}</div>
                    </td>
                    <td>{u.organization.name}</td>
                    <td>{ORG_TYPE_LABEL[u.organization.type]}</td>
                    <td>{u.lastSignInAt ? formatDateIso(u.lastSignInAt) : <span className="t-sekundar">Inbjuden, ej inloggad</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
