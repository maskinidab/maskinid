import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Loading, Notice } from "../components/Notice";
import { RecordCard } from "../components/RecordCard";
import { RegisterExtractHeader } from "../components/RegisterExtractHeader";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { activeBlocks, machineTitle } from "../lib/status";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../auth/AuthContext";

/** Steg 1: bekräfta att ett utdrag ska utfärdas. Kräver inloggning (se routes). */
export function RequestExtractPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const record = useAsync(() => api.getMachineRecord(id), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const ex = await api.issueExtract(id);
      navigate(`/utdrag/${ex.id}`, { state: { nytt: true } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Utdraget kunde inte hämtas. Försök igen om en stund.");
      setBusy(false);
    }
  }

  if (record.loading) return <div className="behallare sektion"><Loading /></div>;
  if (!record.data) {
    return (
      <div className="behallare sektion">
        <Notice kind="fel" title="Maskinen hittades inte i registret" />
      </div>
    );
  }

  const r = record.data;
  return (
    <div className="behallare sektion-liten stack-6" style={{ maxWidth: 820 }}>
      <nav className="brodsmulor" aria-label="Brödsmulor">
        <Link to="/">Sök</Link><span aria-hidden="true">/</span>
        <Link to={`/maskin/${r.machine.id}`}>{r.machine.registerNumber}</Link><span aria-hidden="true">/</span>
        <span>Registerutdrag</span>
      </nav>
      <div className="stack-3">
        <h1 className="t-rubrik-1">Hämta registerutdrag</h1>
        <p className="t-ingress">
          Utdraget gäller {machineTitle(r).toLowerCase()} med registernummer{" "}
          <span className="mid-id" style={{ fontSize: "inherit" }}>{r.machine.registerNumber}</span>.
        </p>
      </div>
      <ul className="t-brodtext stack-2" style={{ paddingLeft: 20, margin: 0 }}>
        <li>Utdraget får ett eget utdragsnummer och verifieringssigill.</li>
        <li>Det visar uppgifterna som de är registrerade just nu, med källa och tid.</li>
        <li>Att utdraget har hämtats syns i maskinens historik.</li>
      </ul>
      {error && <Notice kind="fel" title={error} />}
      <div className="mid-rad">
        <button className="mid-knapp mid-knapp-primar" onClick={() => void issue()} disabled={busy}>
          <Icon name="nedladdning" />
          {busy ? "Hämtar registerutdrag" : "Hämta registerutdrag"}
        </button>
        <Link className="mid-knapp mid-knapp-kontur" to={`/maskin/${r.machine.id}`}>
          Avbryt
        </Link>
      </div>
    </div>
  );
}

/** Steg 2: det utfärdade utdraget. Utskriftsvänligt (Skriv ut → Spara som PDF). */
export function ExtractPage() {
  const { extractId = "" } = useParams();
  const { user } = useAuth();
  const ex = useAsync(() => api.getExtract(extractId), [extractId]);
  const location = useLocation();
  const isNew = (location.state as { nytt?: boolean } | null)?.nytt === true;

  if (ex.loading) return <div className="behallare sektion"><Loading /></div>;
  if (!ex.data) {
    return (
      <div className="behallare sektion stack-4">
        <h1 className="t-rubrik-1">Utdraget finns inte</h1>
        <Notice kind="fel" title={`Inget registerutdrag med nummer ${extractId}`}>
          <p className="t-liten">Kontrollera utdragsnumret uppe till höger på utdraget.</p>
        </Notice>
      </div>
    );
  }

  const e = ex.data;
  const blocked = activeBlocks(e.snapshot).length > 0;
  return (
    <div className="behallare sektion-liten stack-5 utdrag-sida">
      <div className="ej-utskrift stack-4">
        {isNew && (
          <Notice kind="ok" title="Registerutdrag hämtat">
            <p className="t-liten">Skriv ut utdraget eller spara det som PDF och lägg det till affärens handlingar.</p>
          </Notice>
        )}
        <div className="mid-rad">
          {import.meta.env.VITE_ROUTER !== "hash" && (
            <button className="mid-knapp mid-knapp-sekundar" onClick={() => window.print()}>
              <Icon name="skrivare" />
              Skriv ut eller spara som PDF
            </button>
          )}
          <Link className="mid-knapp mid-knapp-kontur" to={`/maskin/${e.machineId}`}>
            <Icon name="pil-vanster" />
            Till registerposten
          </Link>
        </div>
      </div>

      <RegisterExtractHeader extract={e} />
      <RecordCard record={e.snapshot} viewer={user} extractLink={false} />
      {blocked && (
        <Notice kind="fel" title="Maskinen är spärrad">
          <p className="t-liten">Kontakta den som registrerat spärren innan affären genomförs.</p>
        </Notice>
      )}
      <p className="utdrag-fot">
        Registerutdrag {e.id} utfärdat {formatDateTime(e.issuedAt)} ur MaskinID. Uppgifterna kommer från registrerade ägare,
        långivare och försäkringsgivare och gäller vid utfärdandet. Äktheten kan kontrolleras på {window.location.origin}/utdrag/{e.id}.
      </p>
    </div>
  );
}
