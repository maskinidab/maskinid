import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { Notice } from "../components/Notice";
import { DEMO_PASSWORD, createSeed } from "../data/seed";
import { ApiError, dataSource } from "../lib/api";
import { ORG_TYPE_LABEL } from "../lib/permissions";

export function LoginPage() {
  const { user, signInWithPassword, requestSignInLink } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const target = (location.state as { fran?: string } | null)?.fran ?? "/mina-sidor";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"losenord" | "lank">("losenord");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  if (user && !busy) return <Navigate to={target} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Skriv din e-postadress, till exempel namn@foretag.se.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "losenord") {
        await signInWithPassword(email, password);
        navigate(target, { replace: true });
      } else {
        await requestSignInLink(email);
        setLinkSent(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inloggningen misslyckades. Försök igen.");
    } finally {
      setBusy(false);
    }
  }

  const demoUsers = dataSource === "mock" ? createSeed().users : [];
  const orgs = createSeed().organizations;

  return (
    <div className="behallare sektion">
      <div className="rutnat">
        <div className="kol-6 stack-6">
          <div className="stack-3">
            <h1 className="t-rubrik-1">Logga in</h1>
            <p className="t-ingress">För maskinhandlare, maskinägare, långivare och försäkringsgivare som registrerar uppgifter.</p>
          </div>

          {linkSent ? (
            <Notice kind="ok" title="Inloggningslänk skickad">
              <p className="t-liten">Öppna länken i e-postmeddelandet till {email}. Länken gäller i en timme.</p>
            </Notice>
          ) : (
            <form className="formular stack-5" onSubmit={submit} noValidate>
              {error && <Notice kind="fel" title={error} />}
              <FormField label="E-postadress">
                <input className="mid-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </FormField>
              {mode === "losenord" && (
                <FormField label="Lösenord">
                  <input className="mid-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </FormField>
              )}
              <div className="mid-rad">
                <button className="mid-knapp mid-knapp-primar" type="submit" disabled={busy}>
                  {busy ? "Loggar in" : mode === "losenord" ? "Logga in" : "Skicka inloggningslänk"}
                </button>
                <button type="button" className="mid-lank mid-lank-knapp" onClick={() => { setMode(mode === "losenord" ? "lank" : "losenord"); setError(null); }}>
                  {mode === "losenord" ? "Logga in med länk i e-post i stället" : "Logga in med lösenord i stället"}
                </button>
              </div>
            </form>
          )}
        </div>

        {demoUsers.length > 0 && (
          <aside className="kol-6">
            <div className="panel stack-4">
              <h2 className="t-rubrik-4">Demokonton</h2>
              <p className="t-liten t-sekundar">
                Lösenord för alla: <span className="mid-id" style={{ fontSize: 13 }}>{DEMO_PASSWORD}</span>. Välj ett konto för att fylla i
                uppgifterna.
              </p>
              <div className="mid-tabell-wrap">
                <table className="mid-tabell">
                  <thead><tr><th>Konto</th><th>Organisation</th><th>Roll</th></tr></thead>
                  <tbody>
                    {demoUsers.map((u) => {
                      const org = orgs.find((o) => o.id === u.organizationId)!;
                      return (
                        <tr key={u.id}>
                          <td>
                            <button className="mid-lank mid-lank-knapp" type="button" onClick={() => { setMode("losenord"); setEmail(u.email); setPassword(DEMO_PASSWORD); }}>
                              {u.email}
                            </button>
                          </td>
                          <td>{org.name}</td>
                          <td>{ORG_TYPE_LABEL[org.type]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
