import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { Loading, Notice } from "../../components/Notice";
import { RecordCard } from "../../components/RecordCard";
import { StatusBadge } from "../../components/StatusBadge";
import { api } from "../../lib/api";
import { formatDateIso, formatDateTime, formatSek } from "../../lib/format";
import * as perm from "../../lib/permissions";
import { activeInsurance, machineTitle } from "../../lib/status";
import { BLOCK_REASON_LABEL, type MachineRecord } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { BlockForm, ConfirmForm, InsuranceForm, PledgeForm, TransferForm, VerifyForm } from "./ActionForms";

type Panel =
  | { kind: "belaning" }
  | { kind: "forsakring" }
  | { kind: "sparr" }
  | { kind: "agarbyte" }
  | { kind: "verifiera" }
  | { kind: "avsluta-belaning"; id: string }
  | { kind: "hav-sparr"; id: string };

const PANEL_TITLE: Record<Panel["kind"], string> = {
  belaning: "Registrera belåning",
  forsakring: "Registrera försäkring",
  sparr: "Registrera spärr",
  agarbyte: "Registrera ägarbyte",
  verifiera: "Verifiera identitet",
  "avsluta-belaning": "Avsluta belåning",
  "hav-sparr": "Häv spärr",
};

export function MachinePage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const record = useAsync(() => api.getMachineRecord(id), [id, user?.id]);
  const history = useAsync(() => api.getMachineHistory(id), [id, user?.id]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (record.loading && !record.data) {
    return (
      <div className="behallare sektion">
        <Loading />
      </div>
    );
  }
  if (record.error || !record.data) {
    return (
      <div className="behallare sektion stack-5">
        <h1 className="t-rubrik-1">Registerposten finns inte</h1>
        <Notice kind="fel" title="Maskinen hittades inte i registret">
          <p className="t-liten">Sök på PIN, serienummer eller registernummer i stället.</p>
        </Notice>
        <Link className="mid-knapp mid-knapp-kontur" to="/">
          Till sökningen
        </Link>
      </div>
    );
  }

  const r: MachineRecord = record.data;
  const done = (updated: MachineRecord, msg: string) => {
    record.setData(updated);
    history.reload();
    setPanel(null);
    setMessage(msg);
  };
  const close = () => setPanel(null);

  const actions: { label: string; icon: Parameters<typeof Icon>[0]["name"]; panel: Panel }[] = [];
  if (perm.canTransferOwnership(user, r)) actions.push({ label: "Registrera ägarbyte", icon: "byt", panel: { kind: "agarbyte" } });
  if (perm.canRegisterPledge(user)) actions.push({ label: "Registrera belåning", icon: "hanglas", panel: { kind: "belaning" } });
  if (perm.canRegisterInsurance(user)) actions.push({ label: "Registrera försäkring", icon: "skold", panel: { kind: "forsakring" } });
  if (perm.canReportBlock(user, r)) actions.push({ label: "Registrera spärr", icon: "varning", panel: { kind: "sparr" } });
  if (perm.isAdmin(user) && !r.machine.identityVerified) actions.push({ label: "Verifiera identitet", icon: "bock", panel: { kind: "verifiera" } });

  const insurance = activeInsurance(r);

  return (
    <div className="behallare sektion-liten">
      <nav className="brodsmulor" aria-label="Brödsmulor">
        <Link to="/">Sök</Link>
        <span aria-hidden="true">/</span>
        <span>{r.machine.registerNumber}</span>
      </nav>

      <div className="rutnat">
        <div className="kol-8 stack-6">
          <div className="stack-3">
            <h1 className="t-rubrik-1">{machineTitle(r)}</h1>
            <p className="t-ingress t-sekundar">
              {r.machine.manufacturer} {r.machine.model}
            </p>
          </div>

          {message && <Notice kind="ok" title={message}><p className="t-liten">Registerposten är uppdaterad. Ändringen syns i historiken.</p></Notice>}

          <RecordCard record={r} viewer={user} extractLink={false} showTitle={false} />

          <section className="stack-4" aria-labelledby="rubrik-maskin">
            <h2 id="rubrik-maskin" className="t-rubrik-3">Maskinuppgifter</h2>
            <dl className="definitioner">
              <dt>Registernummer</dt>
              <dd className="mid-id">{r.machine.registerNumber}</dd>
              <dt>PIN</dt>
              <dd className={r.machine.pin ? "mid-id" : "t-sekundar"}>{r.machine.pin ?? "Uppgift saknas"}</dd>
              <dt>Serienummer</dt>
              <dd className={r.machine.serialNumber ? "mid-id" : "t-sekundar"}>{r.machine.serialNumber ?? "Uppgift saknas"}</dd>
              <dt>Tillverkare</dt>
              <dd>{r.machine.manufacturer}</dd>
              <dt>Modell</dt>
              <dd>{r.machine.model}</dd>
              <dt>Årsmodell</dt>
              <dd>{r.machine.modelYear ?? "Uppgift saknas"}</dd>
              <dt>Registrerad</dt>
              <dd>{formatDateTime(r.machine.createdAt)}</dd>
            </dl>
          </section>

          {r.blocks.length > 0 && (
            <section className="stack-4" aria-labelledby="rubrik-sparr">
              <h2 id="rubrik-sparr" className="t-rubrik-3">Spärrar</h2>
              <div className="mid-tabell-wrap">
                <table className="mid-tabell">
                  <thead>
                    <tr><th>Status</th><th>Registrerad</th><th>Av</th><th>Polisens diarienummer</th><th><span className="visually-hidden">Handling</span></th></tr>
                  </thead>
                  <tbody>
                    {r.blocks.map((b) => (
                      <tr key={b.id}>
                        <td>
                          {b.liftedAt ? <span className="t-sekundar">Hävd {formatDateIso(b.liftedAt)}</span> : <StatusBadge kind="sparr">{BLOCK_REASON_LABEL[b.reason]}</StatusBadge>}
                          {b.description && <div className="t-liten t-sekundar" style={{ marginTop: 4 }}>{b.description}</div>}
                        </td>
                        <td>{formatDateIso(b.reportedAt)}</td>
                        <td>{b.reportedByName}</td>
                        <td>{b.policeReportNumber ? <span className="mid-id">{b.policeReportNumber}</span> : "–"}</td>
                        <td>
                          {perm.canLiftBlock(user, b) && (
                            <button className="mid-lank mid-lank-knapp" onClick={() => setPanel({ kind: "hav-sparr", id: b.id })}>
                              Häv spärr
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="stack-4" aria-labelledby="rubrik-belaning">
            <h2 id="rubrik-belaning" className="t-rubrik-3">Belåning</h2>
            {r.pledges.length === 0 ? (
              <p className="t-brodtext t-sekundar">Ingen belåning har registrerats på maskinen.</p>
            ) : (
              <div className="mid-tabell-wrap">
                <table className="mid-tabell">
                  <thead>
                    <tr><th>Långivare</th><th>Registrerad</th><th>Avslutad</th><th>Belopp</th><th><span className="visually-hidden">Handling</span></th></tr>
                  </thead>
                  <tbody>
                    {r.pledges.map((p) => (
                      <tr key={p.id}>
                        <td>{p.lenderName}{p.reference && <div className="mid-id t-sekundar">{p.reference}</div>}</td>
                        <td>{formatDateIso(p.registeredAt)}</td>
                        <td>{p.releasedAt ? formatDateIso(p.releasedAt) : <StatusBadge kind="belanad">Belånad</StatusBadge>}</td>
                        <td>{p.amountSek != null ? formatSek(p.amountSek) : <span className="t-sekundar">Visas för ägare och långivare</span>}</td>
                        <td>
                          {perm.canReleasePledge(user, p) && (
                            <button className="mid-lank mid-lank-knapp" onClick={() => setPanel({ kind: "avsluta-belaning", id: p.id })}>
                              Avsluta belåning
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="stack-4" aria-labelledby="rubrik-forsakring">
            <h2 id="rubrik-forsakring" className="t-rubrik-3">Försäkring</h2>
            {r.insurances.length === 0 ? (
              <p className="t-brodtext t-sekundar">Ingen försäkring har registrerats på maskinen.</p>
            ) : (
              <div className="mid-tabell-wrap">
                <table className="mid-tabell">
                  <thead>
                    <tr><th>Försäkringsgivare</th><th>Försäkringsform</th><th>Gäller från</th><th>Gäller till</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {r.insurances.map((i) => (
                      <tr key={i.id}>
                        <td>{i.insurerName}</td>
                        <td>{i.coverage}</td>
                        <td>{formatDateIso(i.validFrom)}</td>
                        <td>{formatDateIso(i.validTo)}</td>
                        <td>{insurance?.id === i.id ? <StatusBadge kind="verifierad">Gäller</StatusBadge> : <span className="t-sekundar">{i.cancelledAt ? "Avslutad" : "Gäller inte"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="kol-4 stack-6">
          <div className="panel panel-register stack-4">
            <h2 className="t-rubrik-4">Registerutdrag</h2>
            <p className="t-liten t-sekundar">
              Ett utdrag med eget nummer och sigill. Visar uppgifterna som de är registrerade när du hämtar det.
            </p>
            <Link className="mid-knapp mid-knapp-sekundar" to={`/maskin/${r.machine.id}/utdrag`}>
              <Icon name="nedladdning" />
              Hämta registerutdrag
            </Link>
          </div>

          {user && actions.length > 0 && (
            <div className="panel stack-4">
              <h2 className="t-rubrik-4">Ändra i registret</h2>
              <p className="t-liten t-sekundar">Du registrerar som {user.organization.name}.</p>
              <div className="stack-2">
                {actions.map((a) => (
                  <button key={a.label} className="mid-knapp mid-knapp-kontur" style={{ width: "100%" }} onClick={() => { setMessage(null); setPanel(a.panel); }}>
                    <Icon name={a.icon} />
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!user && (
            <div className="panel stack-3">
              <h2 className="t-rubrik-4">Registrera uppgifter</h2>
              <p className="t-liten t-sekundar">Ägare, långivare och försäkringsgivare loggar in för att registrera ändringar.</p>
              <Link className="mid-lank" to="/logga-in" state={{ fran: `/maskin/${r.machine.id}` }}>
                Logga in
              </Link>
            </div>
          )}

          <section className="stack-4" aria-labelledby="rubrik-historik">
            <h2 id="rubrik-historik" className="t-rubrik-4">Historik</h2>
            {history.loading && !history.data ? (
              <Loading />
            ) : (
              <ol className="mid-historik">
                {(history.data ?? []).map((e) => (
                  <li key={e.id}>
                    <time dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
                    <p>{e.description}</p>
                    <small>Uppgift från {e.sourceName}</small>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      <Dialog open={panel !== null} onClose={close} title={panel ? PANEL_TITLE[panel.kind] : ""}>
        {panel?.kind === "belaning" && <PledgeForm record={r} onDone={done} onCancel={close} />}
        {panel?.kind === "forsakring" && <InsuranceForm record={r} onDone={done} onCancel={close} />}
        {panel?.kind === "sparr" && <BlockForm record={r} onDone={done} onCancel={close} />}
        {panel?.kind === "agarbyte" && <TransferForm record={r} onDone={done} onCancel={close} />}
        {panel?.kind === "verifiera" && <VerifyForm record={r} onDone={done} onCancel={close} />}
        {panel?.kind === "avsluta-belaning" && (
          <ConfirmForm
            text="Belåningen markeras som avslutad. Maskinen visas som fri från belåning om inga andra belåningar finns."
            label="Avsluta belåning"
            message="Belåning avslutad"
            action={() => api.releasePledge(panel.id)}
            onDone={done}
            onCancel={close}
          />
        )}
        {panel?.kind === "hav-sparr" && (
          <ConfirmForm
            text="Spärren hävs och visas inte längre i registerposten. Den finns kvar i historiken."
            label="Häv spärr"
            message="Spärr hävd"
            action={() => api.liftBlock(panel.id)}
            onDone={done}
            onCancel={close}
          />
        )}
      </Dialog>
    </div>
  );
}
