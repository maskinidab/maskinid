import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { ErrorNotice, Notice, PageHeader } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { MachinePhoto } from "../../../components/MachinePhoto";
import { OcrCapture, OcrError, useOcr } from "../../../components/OcrCapture";
import { RegNumber } from "../../../components/RegNumber";
import { ScanButton, type ScanResult } from "../../../components/Scanner";
import { FinancingBadge, MachineStatusBadge, StatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { queryClient, rpc } from "../../../lib/api/query";
import type { MachineView, PayoffRequest, Transfer } from "../../../lib/api/types";
import { PayoffSettlementDialog } from "../machines/FinancingActions";
import { backend } from "../../../lib/backend";
import { formatDate } from "../../../lib/format";

interface TradeIn {
  machine: MachineView;
  financing: { has_active: boolean; type: string | null; holder: string | null; encumbrance_id: string | null; has_pending: boolean; pending_holder: string | null };
  financier: { name: string; email?: string | null; phone?: string | null; financing_defaults?: { payoff_instructions?: string } } | null;
  payoff: PayoffRequest | null;
  history: { type: string; created_at: string }[];
  open_transfer: Transfer | null;
  is_owner: boolean;
}

type Entry = "label" | "photo" | "serial";

/**
 * Take a machine in trade (SPEC §6.7 step 5, §7.2).
 *
 * Three ways in, because a dealer standing at a machine usually has the nameplate in front of them rather than a
 * MaskinID label: scan the label, photograph the VIN/serial (read by the same OCR the registration wizard uses),
 * or type the serial. All three land on the same answer — history, financing and any payoff already under way.
 */
export function TradeInPage() {
  const { t, i18n } = useTranslation();
  const { orgId, path, canWrite } = useOrg();
  const [entry, setEntry] = useState<Entry>("label");
  const [data, setData] = useState<TradeIn | null>(null);
  const [reg, setReg] = useState("");
  const [serial, setSerial] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<Transfer | null>(null);
  const [payoffSent, setPayoffSent] = useState(false);
  const [settle, setSettle] = useState(false);
  // The query that produced what is on screen, so the view can be refreshed after an action without
  // clearing the notices that lookup() resets.
  const [last, setLast] = useState<{ code?: string; reg?: string; serial?: string } | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const ocr = useOcr("ocr-nameplate");

  async function lookup(q: { code?: string; reg?: string; serial?: string }) {
    setError(null);
    setSent(null);
    setPayoffSent(false);
    setNotFound(null);
    setLast(q);
    try {
      setData(await rpc<TradeIn>("trade_in_lookup", {
        p_org_id: orgId, p_code: q.code ?? null, p_reg: q.reg ?? null, p_serial: q.serial ?? null,
      }));
    } catch (e) {
      setData(null);
      // A serial nobody has registered is the normal case for a machine new to MaskinID, not an error to shout about.
      if ((e as { code?: string })?.code === "NOT_FOUND" && q.serial) setNotFound(q.serial);
      else setError(e);
    }
  }

  async function readNameplate(file: File) {
    const s = await ocr.read(file);
    const found = typeof s?.serial === "string" ? s.serial : typeof s?.pin === "string" ? s.pin : null;
    if (!found) return;
    setSerial(found);
    await lookup({ serial: found });
  }

  async function request() {
    setError(null);
    try {
      const r = await rpc<{ transfer: Transfer; payoff_request: PayoffRequest | null }>("request_trade_in", {
        p_org_id: orgId, p_machine_id: data!.machine.id, p_message: message || null,
        // A bank-owned leasing object is the common case: ask for the payoff in the same step so the lender
        // hears about it when the deal starts, not after the owner has approved the transfer.
        p_request_payoff: data!.financing.has_active,
      });
      setSent(r.transfer);
      setPayoffSent(!!r.payoff_request);
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) {
      setError(e);
    }
  }

  async function refresh() {
    if (!last) return;
    const q = last;
    try {
      setData(await rpc<TradeIn>("trade_in_lookup", {
        p_org_id: orgId, p_code: q.code ?? null, p_reg: q.reg ?? null, p_serial: q.serial ?? null,
      }));
    } catch {
      // Leave what is on screen: the action itself already succeeded.
    }
  }

  async function openPayoffDocument(id: string) {
    const r = await backend.invoke<{ url: string }>("document-url", { document_id: id });
    window.open(r.url, "_blank", "noopener");
  }

  const m = data?.machine;
  const payoff = data?.payoff ?? null;
  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("nav.trade_in")} lead={t("dealer.trade_in_lead")} />

      <section className="panel stack-3">
        <div className="mid-val">
          {(["label", "photo", "serial"] as const).map((x) => (
            <label key={x}>
              <input type="radio" checked={entry === x} onChange={() => setEntry(x)} />
              <span>{t(`dealer.trade_in_by_${x}`)}</span>
            </label>
          ))}
        </div>

        {entry === "label" && (
          <>
            <ScanButton tone="primar" onResult={(r: ScanResult) => void lookup(r.kind === "label" ? { code: r.code } : { reg: r.reg })} />
            <form className="mid-sok-rad" onSubmit={(e) => { e.preventDefault(); void lookup({ reg }); }}>
              <input className="mid-input is-id" aria-label={t("dealer.reg_or_scan")} placeholder="XXX-XXXX" value={reg}
                onChange={(e) => setReg(e.target.value)} autoCapitalize="characters" spellCheck={false} />
              <button type="submit" className="mid-knapp mid-knapp-sekundar"><Icon name="sok" />{t("common.search")}</button>
            </form>
          </>
        )}

        {entry === "photo" && (
          <>
            <p className="t-brodtext">{t("dealer.trade_in_photo_lead")}</p>
            <OcrCapture fn="ocr-nameplate" camera busy={ocr.busy} label={t("dealer.trade_in_by_photo")} busyLabel={t("wizard.reading")} onFile={readNameplate} />
            <OcrError error={ocr.error} title={t("wizard.ocr_failed")} />
            {serial && <p className="t-liten">{t("dealer.trade_in_serial_label")}: <strong className="mid-id">{serial}</strong></p>}
          </>
        )}

        {entry === "serial" && (
          <form className="stack-2" onSubmit={(e) => { e.preventDefault(); void lookup({ serial }); }}>
            <FormField label={t("dealer.trade_in_serial_label")}>
              <input className="mid-input is-id" value={serial} onChange={(e) => setSerial(e.target.value)}
                autoCapitalize="characters" autoComplete="off" spellCheck={false} />
            </FormField>
            <div>
              <button type="submit" className="mid-knapp mid-knapp-primar" disabled={serial.replace(/[\s-]/g, "").length < 4}>
                <Icon name="sok" />{t("common.search")}
              </button>
            </div>
          </form>
        )}
      </section>

      {error != null && <ErrorNotice error={error} />}

      {notFound && (
        <Notice kind="info" title={t("dealer.trade_in_not_found")}>
          <p>
            <Link className="mid-lank" to={path(`machines/new?serial=${encodeURIComponent(notFound)}`)}>{t("dealer.trade_in_register")}</Link>
          </p>
        </Notice>
      )}

      {m && data && (
        <section className="panel stack-4" aria-labelledby="inbyte-maskin">
          <div className="maskin-huvud">
            <MachinePhoto path={m.primary_photo_path} category={m.category} size={96} />
            <div className="stack-2">
              <div><RegNumber value={m.reg_number} framed /></div>
              <h2 id="inbyte-maskin" className="t-rubrik-4">{m.make} {m.model}{m.year ? ` · ${m.year}` : ""}</h2>
              <div className="badge-rad">
                <MachineStatusBadge status={m.status} />
                <VerificationBadge level={m.verification_level} />
                <FinancingBadge hasActive={data.financing.has_active} pending={data.financing.has_pending}
                  pendingHolder={data.financing.pending_holder ?? undefined} />
              </div>
              {data.financing.has_active && (
                <p className="t-liten">{t("dealer.trade_in_financing", { holder: data.financing.holder ?? "", type: t(`enum.encumbrance_type.${data.financing.type}`) })}</p>
              )}
              {!data.financing.has_active && data.financing.has_pending && (
                <p className="t-liten">{t("dealer.trade_in_pending_financing", { holder: data.financing.pending_holder ?? "" })}</p>
              )}
              {data.financier && (data.financier.email || data.financier.phone) && (
                <p className="t-liten t-sekundar">{t("financier.picker.contact", { contact: data.financier.email ?? data.financier.phone })}</p>
              )}
              {m.status === "exported" && m.export_country && (
                <p className="t-liten t-sekundar">{t("public.exported_to", { country: m.export_country })}</p>
              )}
            </div>
          </div>

          <ol className="mid-historik">
            {data.history.map((h, i) => (
              <li key={i}>
                <time dateTime={h.created_at}>{formatDate(h.created_at)}</time>
                <p>{i18n.exists(`dealer.history.${h.type}`) ? t(`dealer.history.${h.type}`) : h.type}</p>
              </li>
            ))}
          </ol>

          {/* The payoff the lender owes an answer on, or has already answered. */}
          {payoff && (
            <article className="mid-post stack-2">
              <div className="mid-rad mid-rad-mellan">
                <strong>{t("payoff.title")}</strong>
                <StatusBadge kind={payoff.status === "settled" ? "verifierad" : "vantar"}>{t(`enum.payoff_status.${payoff.status}`)}</StatusBadge>
              </div>
              {payoff.quote_valid_until && <p className="t-liten">{t("payoff.quote_valid", { date: formatDate(payoff.quote_valid_until) })}</p>}
              {payoff.quote_document_id && (
                <div>
                  <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten" onClick={() => void openPayoffDocument(payoff.quote_document_id!)}>
                    <Icon name="dokument" />{t("payoff.quote_open")}
                  </button>
                </div>
              )}
              {/* The dealer uploads the bank's proof that the credit is settled. A dealer who is only a party to the
                  transfer has no financing tab on the machine page, so this is their only way in. It still releases
                  nothing: only the lender can do that (ADR 0025). */}
              {["requested", "quoted"].includes(payoff.status) && !data.is_owner && canWrite && (
                <div>
                  <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten" onClick={() => setSettle(true)}>
                    <Icon name="uppladdning" />{t("payoff.settlement")}
                  </button>
                </div>
              )}
              <p className="t-liten t-sekundar">{t("payoff.no_amounts")}</p>
            </article>
          )}

          {m.verification_level < 2 && <Notice kind="info" title={t("dealer.trade_in_verify")} />}

          {data.is_owner ? (
            <p>{t("dealer.trade_in_own")}</p>
          ) : data.open_transfer || sent ? (
            <Notice kind="ok" title={t("dealer.trade_in_sent")}>
              {payoffSent && data.financing.holder && <p className="t-liten">{t("dealer.trade_in_payoff_sent", { holder: data.financing.holder })}</p>}
              <p>
                <Link className="mid-lank" to={path(`transfers/${(sent ?? data.open_transfer)!.id}`)}>{t("common.open")}</Link>
              </p>
            </Notice>
          ) : canWrite && m.status === "active" && (
            <div className="stack-3">
              <FormField label={t("dealer.message_to_owner")} optional>
                <textarea className="mid-textarea" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              </FormField>
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => void request()}>{t("dealer.request_trade_in")}</button>
              </div>
              {data.financing.has_active && data.financing.holder && (
                <p className="mid-hjalp">{t("dealer.trade_in_request_payoff", { holder: data.financing.holder })}</p>
              )}
            </div>
          )}
        </section>
      )}
      {m && <PayoffSettlementDialog m={m} payoff={settle ? payoff : null} onClose={() => { setSettle(false); void refresh(); }} />}
    </div>
  );
}
