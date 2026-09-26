import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { LookupField } from "../components/LookupField";
import { Loading, Notice } from "../components/Notice";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { formatDateIso } from "../lib/format";
import { canRegisterMachine, ORG_TYPE_LABEL } from "../lib/permissions";
import { activeInsurance, isBlocked, isPledged } from "../lib/status";
import { useAsync } from "../lib/useAsync";

const RELATION_TEXT = {
  maskinhandlare: "Maskiner där ni är registrerad ägare.",
  maskinagare: "Maskiner där ni är registrerad ägare.",
  langivare: "Maskiner där ni har en registrerad belåning.",
  forsakringsgivare: "Maskiner där ni har en registrerad försäkring.",
  registerhallare: "Maskiner där ni är registrerad ägare, långivare eller försäkringsgivare.",
};

export function DashboardPage() {
  const { user } = useAuth();
  const machines = useAsync(() => api.listMyMachines(), [user?.id]);
  if (!user) return null;

  const list = machines.data ?? [];
  const pledged = list.filter(isPledged).length;
  const blocked = list.filter(isBlocked).length;

  return (
    <div className="behallare sektion-liten stack-7">
      <div className="stack-3">
        <p className="t-liten t-sekundar">
          {user.organization.name} · {ORG_TYPE_LABEL[user.organization.type]} · Org.nr{" "}
          <span className="mid-id" style={{ fontSize: 13, fontWeight: 400 }}>{user.organization.orgNr}</span>
        </p>
        <h1 className="t-rubrik-1">Mina sidor</h1>
      </div>

      <dl className="nyckeltal">
        <div><dt>Maskiner</dt><dd>{machines.loading ? "–" : list.length}</dd></div>
        <div><dt>Belånade</dt><dd>{machines.loading ? "–" : pledged}</dd></div>
        <div><dt>Spärrade</dt><dd>{machines.loading ? "–" : blocked}</dd></div>
      </dl>

      <section className="stack-4" aria-labelledby="rubrik-handlingar">
        <h2 id="rubrik-handlingar" className="t-rubrik-3">Vad vill du göra?</h2>
        <div className="handlingar">
          {canRegisterMachine(user) && (
            <Link className="handling" to="/mina-sidor/registrera-maskin">
              <strong><Icon name="plus" />Registrera maskin</strong>
              <span>Lägg till en maskin med PIN eller serienummer.</span>
            </Link>
          )}
          <Link className="handling" to="/">
            <strong><Icon name="sok" />Sök i registret</strong>
            <span>Kontrollera ägare, belåning och försäkring.</span>
          </Link>
          {user.organization.type === "langivare" && (
            <div className="handling">
              <strong><Icon name="hanglas" />Registrera belåning</strong>
              <span>Sök fram maskinen och välj Registrera belåning.</span>
            </div>
          )}
          {user.organization.type === "forsakringsgivare" && (
            <div className="handling">
              <strong><Icon name="skold" />Registrera försäkring</strong>
              <span>Sök fram maskinen och välj Registrera försäkring.</span>
            </div>
          )}
        </div>
      </section>

      {user.organization.type === "langivare" || user.organization.type === "forsakringsgivare" ? (
        <section className="stack-4" style={{ maxWidth: 760 }}>
          <h2 className="t-rubrik-3">Hitta en maskin</h2>
          <LookupField />
        </section>
      ) : null}

      <section className="stack-4" aria-labelledby="rubrik-maskiner">
        <div className="panel-huvud" style={{ marginBottom: 0 }}>
          <h2 id="rubrik-maskiner" className="t-rubrik-3">Era maskiner</h2>
          <p className="t-liten t-sekundar">{RELATION_TEXT[user.organization.type]}</p>
        </div>
        {machines.loading && <Loading />}
        {machines.error && <Notice kind="fel" title="Maskinerna kunde inte hämtas">{machines.error.message}</Notice>}
        {!machines.loading && list.length === 0 && (
          <div className="tomt stack-3">
            <p className="t-rubrik-4">Inga maskiner ännu</p>
            <p className="t-brodtext t-sekundar">När ni registrerar en maskin, belåning eller försäkring visas den här.</p>
          </div>
        )}
        {list.length > 0 && (
          <div className="mid-tabell-wrap">
            <table className="mid-tabell">
              <thead>
                <tr><th>Maskin</th><th>Registernummer</th><th>Registrerad ägare</th><th>Status</th><th>Uppdaterad</th></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.machine.id}>
                    <td>
                      <Link to={`/maskin/${r.machine.id}`}>{r.machine.machineType} {r.machine.manufacturer} {r.machine.model}</Link>
                      {r.machine.modelYear && <div className="t-liten t-sekundar">Årsmodell {r.machine.modelYear}</div>}
                    </td>
                    <td><span className="mid-id">{r.machine.registerNumber}</span></td>
                    <td>{r.owner?.ownerName ?? "–"}</td>
                    <td>
                      <div className="mid-rad" style={{ gap: 6 }}>
                        {isBlocked(r) && <StatusBadge kind="sparr">Spärrad</StatusBadge>}
                        {isPledged(r) ? <StatusBadge kind="belanad">Belånad</StatusBadge> : <StatusBadge kind="verifierad">Ingen belåning</StatusBadge>}
                        {!activeInsurance(r) && <span className="t-liten t-sekundar">Ingen försäkring</span>}
                      </div>
                    </td>
                    <td>{formatDateIso(r.lastUpdatedAt)}</td>
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
