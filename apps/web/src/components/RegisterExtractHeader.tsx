import type { RegisterExtract } from "../lib/types";
import { formatDateTime } from "../lib/format";
import { machineTitle } from "../lib/status";
import { Seal } from "./Seal";
import { Wordmark } from "./Logo";

/** Registerutdragets huvud: ordmärke, titel, utdragsuppgifter och sigill. */
export function RegisterExtractHeader({ extract }: { extract: RegisterExtract }) {
  const m = extract.snapshot.machine;
  const idStyle = { fontSize: 14, lineHeight: "20px" };
  return (
    <section className="mid-utdrag">
      <div className="mid-utdrag-huvud">
        <div>
          <div style={{ marginBottom: 16 }}>
            <Wordmark height={28} />
          </div>
          <h1>Registerutdrag</h1>
          <dl className="mid-utdrag-meta">
            <dt>Utdragsnummer</dt>
            <dd className="mid-id" style={idStyle}>
              {extract.id}
            </dd>
            <dt>Utfärdat</dt>
            <dd>{formatDateTime(extract.issuedAt)}</dd>
            {extract.issuedToName && (
              <>
                <dt>Beställt av</dt>
                <dd>{extract.issuedToName}</dd>
              </>
            )}
            <dt>Avser</dt>
            <dd>
              {machineTitle(extract.snapshot)}
              {m.pin && (
                <>
                  , PIN <span className="mid-id" style={idStyle}>{m.pin}</span>
                </>
              )}
            </dd>
          </dl>
        </div>
        <Seal size={112} />
      </div>
    </section>
  );
}
