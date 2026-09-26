import { useTranslation } from "react-i18next";
import { formatDateTime } from "../lib/format";
import { Icon } from "./Icon";
import { RegNumber } from "./RegNumber";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "./StatusBadge";
import type { Level, MachineStatus } from "../lib/api/types";

export interface CheckReceipt {
  receipt_number: string;
  created_at: string;
  result_hash: string;
  result: {
    found: boolean;
    reg_number?: string;
    make?: string;
    model?: string;
    year?: number;
    status?: MachineStatus;
    verification_level?: Level;
    owner_org_name?: string | null;
    owner_org_number?: string | null;
    has_active_financing?: boolean;
    financing?: { type: string; start_date: string; holder: string } | null;
    flags?: { type: string; raised_at: string }[];
    last_transfer_date?: string | null;
    market_listings?: { source: string; url: string; seen_at: string; seller: string | null }[];
    performed_by: string;
    performed_at: string;
  };
}

/** Financing check receipt (SPEC §6.6): number, time, snapshot of the result. */
export function ReceiptCard({ r, onPdf }: { r: CheckReceipt; onPdf?: () => void }) {
  const { t } = useTranslation();
  const x = r.result;
  return (
    <article className="mid-post kvitto" aria-labelledby={`kvitto-${r.receipt_number}`}>
      <div className="mid-post-huvud">
        <div className="stack-2">
          <p className="t-liten t-sekundar">{t("components.receipt.title")}</p>
          <h2 id={`kvitto-${r.receipt_number}`} className="mid-post-titel">
            {x.found ? `${x.make} ${x.model}${x.year ? ` · ${x.year}` : ""}` : t("check.not_found")}
          </h2>
          {x.reg_number && <RegNumber value={x.reg_number} framed />}
        </div>
        <dl className="kvitto-nummer">
          <dt>{t("components.receipt.number")}</dt>
          <dd className="mid-id">{r.receipt_number}</dd>
        </dl>
      </div>
      {x.found && (
        <dl className="mid-post-falt">
          <div>
            <dt>{t("check.result_status")}</dt>
            <dd className="badge-rad">
              <MachineStatusBadge status={x.status!} />
              <VerificationBadge level={x.verification_level!} />
            </dd>
          </div>
          <div>
            <dt>{t("check.result_owner")}</dt>
            <dd>{x.owner_org_name ?? "–"}</dd>
            {x.owner_org_number && <dd className="mid-id">{x.owner_org_number}</dd>}
          </div>
          <div>
            <dt>{t("check.result_financing")}</dt>
            <dd><FinancingBadge hasActive={!!x.has_active_financing} /></dd>
            {x.financing && <dd>{x.financing.holder} · {t(`enum.encumbrance_type.${x.financing.type}`)} · {x.financing.start_date}</dd>}
          </div>
        </dl>
      )}
      {!!x.flags?.length && (
        <p className="kvitto-flaggor"><Icon name="flagga" className="ikon-inline" /> {x.flags.map((f) => t(`enum.flag_type.${f.type}`)).join(", ")}</p>
      )}
      {!!x.market_listings?.length && <p className="kvitto-flaggor"><Icon name="varning" className="ikon-inline" /> {t("check.listed_for_sale", { count: x.market_listings.length })}</p>}
      <div className="mid-post-fot">
        <span>{t("components.receipt.performed", { date: formatDateTime(x.performed_at ?? r.created_at), org: x.performed_by })}</span>
        <span className="mid-id" title="SHA-256">{r.result_hash.slice(0, 16)}…</span>
        {onPdf && <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={onPdf}><Icon name="nedladdning" />{t("check.download_pdf")}</button>}
      </div>
    </article>
  );
}
