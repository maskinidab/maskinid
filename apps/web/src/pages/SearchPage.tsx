import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LookupField } from "../components/LookupField";
import { Loading, Notice } from "../components/Notice";
import { RecordCard } from "../components/RecordCard";
import { api } from "../lib/api";
import { normalizeIdentifier, validateLookupQuery } from "../lib/identifier";
import { useAsync } from "../lib/useAsync";

export function SearchPage() {
  const [params] = useSearchParams();
  const q = normalizeIdentifier(params.get("q") ?? "");
  const invalid = validateLookupQuery(q);
  const { user } = useAuth();
  const result = useAsync(() => (invalid ? Promise.resolve(null) : api.lookupMachine(q)), [q, user?.id]);

  return (
    <div className="behallare sektion-liten stack-6">
      <div className="stack-4" style={{ maxWidth: 760 }}>
        <h1 className="t-rubrik-1">Sök i registret</h1>
        <LookupField key={q} initialValue={q} error={invalid && q ? invalid : null} />
      </div>

      <div aria-live="polite" className="stack-5">
        {result.loading && !invalid && <Loading>Söker i registret</Loading>}
        {result.error && (
          <Notice kind="fel" title="Sökningen gick inte att genomföra">
            <p className="t-liten">{result.error.message} Försök igen om en stund.</p>
          </Notice>
        )}
        {!result.loading && result.data?.status === "ej_hittad" && (
          <Notice kind="fel" title={`Inget resultat för ${q}`}>
            <p className="t-liten">
              Kontrollera numret på maskinens typskylt. Maskinen kan också sakna registrering i MaskinID – då finns inga
              registrerade uppgifter om ägare, belåning eller försäkring.
            </p>
          </Notice>
        )}
        {!result.loading && result.data?.status === "hittad" && (
          <>
            <p className="t-liten t-sekundar">1 träff för <span className="mid-id" style={{ fontSize: 14 }}>{q}</span></p>
            <RecordCard record={result.data.record} viewer={user} animateFrame />
            <p>
              <Link className="mid-knapp mid-knapp-sekundar" to={`/maskin/${result.data.record.machine.id}`}>
                Visa hela registerposten
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
