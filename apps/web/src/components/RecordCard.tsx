import { Link } from "react-router-dom";
import { BLOCK_REASON_LABEL, type MachineRecord, type UserProfile } from "../lib/types";
import { formatDate, formatDateTime, formatSek } from "../lib/format";
import { activeBlocks, activeInsurance, activePledges, machineTitle } from "../lib/status";
import { IdFrame, IdNumber } from "./IdFrame";
import { StatusBadge } from "./StatusBadge";

/**
 * Registerposten – svaret på en sökning. Registerlinjen överst, benämning och
 * identifierare inom ID-ramen, tre fasta fält: Registrerad ägare, Belåning, Försäkring.
 */
export function RecordCard({
  record,
  viewer,
  frame = true,
  animateFrame = false,
  extractLink = true,
  headingLevel = 2,
  showTitle = true,
}: {
  record: MachineRecord;
  viewer?: UserProfile | null;
  /** ID-ramen används en gång per vy – stäng av när ramen redan finns på sidan. */
  frame?: boolean;
  animateFrame?: boolean;
  extractLink?: boolean;
  headingLevel?: 2 | 3;
  /** Dölj benämningen när sidans rubrik redan är maskinens benämning. */
  showTitle?: boolean;
}) {
  const { machine, owner } = record;
  const pledges = activePledges(record);
  const insurance = activeInsurance(record);
  const blocks = activeBlocks(record);
  const H = headingLevel === 2 ? "h2" : "h3";
  const primaryId = machine.pin ?? machine.serialNumber ?? machine.registerNumber;
  const primaryPrefix = machine.pin ? "PIN" : machine.serialNumber ? "Serienr" : undefined;
  const idNode = <IdNumber value={primaryId} prefix={primaryPrefix} />;

  return (
    <article className="mid-post" aria-label={`Registerpost ${machine.registerNumber}`}>
      <div className="mid-post-huvud">
        <div>
          {showTitle && (
            <>
              <H className="mid-post-titel">{machineTitle(record)}</H>
              <p className="t-liten t-sekundar" style={{ margin: "0 0 12px" }}>
                {machine.manufacturer} {machine.model}
              </p>
            </>
          )}
          {frame ? <IdFrame animate={animateFrame}>{idNode}</IdFrame> : idNode}
        </div>
        <div className="mid-rad" style={{ justifyContent: "flex-end" }}>
          {blocks.map((b) => (
            <StatusBadge key={b.id} kind="sparr">
              {BLOCK_REASON_LABEL[b.reason]}
            </StatusBadge>
          ))}
          {machine.identityVerified ? (
            <StatusBadge kind="verifierad">Identitet verifierad</StatusBadge>
          ) : (
            <span className="t-liten t-sekundar">Identitet ej verifierad</span>
          )}
        </div>
      </div>

      <dl className="mid-post-falt">
        <div>
          <dt>Registrerad ägare</dt>
          {owner ? (
            <>
              <dd>{owner.ownerName}</dd>
              <dd>Sedan {formatDate(owner.since)}</dd>
            </>
          ) : (
            <dd>Ingen registrerad ägare</dd>
          )}
        </div>
        <div>
          <dt>Belåning</dt>
          {pledges.length === 0 ? (
            <dd>
              <StatusBadge kind="verifierad">Ingen registrerad belåning</StatusBadge>
            </dd>
          ) : (
            <>
              <dd>
                <StatusBadge kind="belanad">Belånad</StatusBadge>
              </dd>
              {pledges.map((p) => (
                <dd key={p.id}>
                  Långivare: {p.lenderName}
                  {p.amountSek != null && viewer ? ` · ${formatSek(p.amountSek)}` : ""}
                </dd>
              ))}
            </>
          )}
        </div>
        <div>
          <dt>Försäkring</dt>
          {insurance ? (
            <>
              <dd>{insurance.insurerName}</dd>
              <dd>
                {insurance.coverage} till {formatDate(insurance.validTo)}
              </dd>
            </>
          ) : (
            <>
              <dd>Ingen registrerad försäkring</dd>
              <dd>Uppgift saknas i registret</dd>
            </>
          )}
        </div>
      </dl>

      <div className="mid-post-fot">
        <span>
          Registernummer <span className="mid-id">{machine.registerNumber}</span>
        </span>
        <span>Uppdaterad {formatDateTime(record.lastUpdatedAt)}</span>
        {extractLink && (
          <Link className="mid-lank" to={`/maskin/${machine.id}/utdrag`}>
            Hämta registerutdrag
          </Link>
        )}
      </div>
    </article>
  );
}
