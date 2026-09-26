import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { ErrorNotice, Notice, PageHeader } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { MachinePhoto } from "../../../components/MachinePhoto";
import { RegNumber } from "../../../components/RegNumber";
import { ScanButton, type ScanResult } from "../../../components/Scanner";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { queryClient, rpc } from "../../../lib/api/query";
import type { MachineView, Transfer } from "../../../lib/api/types";
import { formatDate } from "../../../lib/format";

interface TradeIn { machine: MachineView; financing: { has_active: boolean; type: string | null; holder: string | null };
  history: { type: string; created_at: string }[]; open_transfer: Transfer | null; is_owner: boolean }

/**
 * Take a machine in trade (SPEC §6.7 step 5, §7.2): scan the label ⇒ full history summary and financing incl. holder ⇒
 * ask the owner to approve ⇒ the owner approves ⇒ the dealer accepts on the transfer page (and can verify on site).
 */
export function TradeInPage() {
  const { t, i18n } = useTranslation();
  const { orgId, path, canWrite } = useOrg();
  const [data, setData] = useState<TradeIn | null>(null);
  const [reg, setReg] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<Transfer | null>(null);

  async function lookup(q: { code?: string; reg?: string }) {
    setError(null);
    setSent(null);
    try { setData(await rpc<TradeIn>("trade_in_lookup", { p_org_id: orgId, p_code: q.code ?? null, p_reg: q.reg ?? null })); } catch (e) { setError(e); setData(null); }
  }
  async function request() {
    setError(null);
    try {
      const r = await rpc<{ transfer: Transfer }>("request_trade_in", { p_org_id: orgId, p_machine_id: data!.machine.id, p_message: message || null });
      setSent(r.transfer);
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) { setError(e); }
  }
  const m = data?.machine;
  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("nav.trade_in")} lead={t("dealer.trade_in_lead")} />
      <section className="panel stack-3">
        <ScanButton tone="primar" onResult={(r: ScanResult) => void lookup(r.kind === "label" ? { code: r.code } : { reg: r.reg })} />
        <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); void lookup({ reg }); }}>
          <input className="mid-input is-id" aria-label={t("dealer.reg_or_scan")} placeholder="XXX-XXXX" value={reg} onChange={(e) => setReg(e.target.value)} />
          <button type="submit" className="mid-knapp mid-knapp-sekundar"><Icon name="sok" />{t("common.search")}</button>
        </form>
      </section>
      {error != null && <ErrorNotice error={error} />}
      {m && data && (
        <section className="panel stack-4" aria-labelledby="inbyte-maskin">
          <div className="maskin-huvud">
            <MachinePhoto path={m.primary_photo_path} category={m.category} size={96} />
            <div className="stack-2">
              <div><RegNumber value={m.reg_number} framed /></div>
              <h2 id="inbyte-maskin" className="t-rubrik-4">{m.make} {m.model}{m.year ? ` · ${m.year}` : ""}</h2>
              <div className="badge-rad"><MachineStatusBadge status={m.status} /><VerificationBadge level={m.verification_level} /><FinancingBadge hasActive={data.financing.has_active} /></div>
              {data.financing.has_active && <p className="t-liten">{t("dealer.trade_in_financing", { holder: data.financing.holder ?? "", type: t(`enum.encumbrance_type.${data.financing.type}`) })}</p>}
            </div>
          </div>
          <ol className="mid-historik">
            {data.history.map((h, i) => (
              <li key={i}><time dateTime={h.created_at}>{formatDate(h.created_at)}</time>
                <p>{i18n.exists(`dealer.history.${h.type}`) ? t(`dealer.history.${h.type}`) : h.type}</p></li>
            ))}
          </ol>
          {m.verification_level < 2 && <Notice kind="info" title={t("dealer.trade_in_verify")} />}
          {data.is_owner ? <p>{t("dealer.trade_in_own")}</p> : data.open_transfer || sent ? (
            <Notice kind="ok" title={t("dealer.trade_in_sent")}>
              <Link className="mid-lank" to={path(`transfers/${(sent ?? data.open_transfer)!.id}`)}>{t("common.open")}</Link>
            </Notice>
          ) : canWrite && m.status === "active" && (
            <div className="stack-3">
              <FormField label={t("dealer.message_to_owner")} optional><textarea className="mid-textarea" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></FormField>
              <div><button type="button" className="mid-knapp mid-knapp-primar" onClick={() => void request()}>{t("dealer.request_trade_in")}</button></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
