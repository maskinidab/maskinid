import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadCertificate } from "../../../lib/pdf/downloads";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { Icon } from "../../../components/Icon";
import { MachinePhoto } from "../../../components/MachinePhoto";
import { RegNumber } from "../../../components/RegNumber";
import { MachineStatusBadge, StatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { useSign } from "../../../components/Signature";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { Level, MachineStatus, Transfer } from "../../../lib/api/types";
import { formatDate, formatDateTime } from "../../../lib/format";

interface TransferDetail extends Transfer {
  machine: { id: string; reg_number: string; make: string; model: string; year: number | null; category: string; status: MachineStatus;
    verification_level: Level; primary_photo_path: string | null; hour_meter: number | null; owner_ordinal: number;
    identifiers: { type: string; value: string }[] | null; flags: { type: string; status: string }[] };
}

/**
 * Transfer page (SPEC §6.7): the buyer sees machine card, history summary and financing, then accepts with signature;
 * the holder of an existing financing decides; the seller can cancel while it is open.
 */
export function TransferPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token");
  const { t } = useTranslation();
  const { orgId, path, canWrite, has } = useOrg();
  const sign = useSign();
  const q = useRpc<TransferDetail>("get_transfer", { p_org_id: orgId, p_transfer_id: id, p_token: token });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error || !q.data) return <ErrorNotice error={q.error} />;
  const tr = q.data;
  const m = tr.machine;
  const open = ["draft", "awaiting_buyer", "awaiting_financier"].includes(tr.status);
  const isBuyer = tr.to?.id === orgId || (!!token && tr.status === "awaiting_buyer");
  const isSeller = tr.from?.id === orgId;
  const isHolder = tr.existing_encumbrance?.holder.id === orgId;

  async function act(fn: () => Promise<unknown>, doneKey: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDone(doneKey);
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const accept = () => act(async () => {
    const sig = await sign(orgId, "accept_transfer", tr.id, {});
    await rpc("accept_transfer", { p_org_id: orgId, p_transfer_id: tr.id, p_signature_id: sig, p_token: token });
  }, "transfer.done_accepted");
  const decide = (decision: "release" | "transfer_to_buyer" | "reject") => act(async () => {
    const sig = await sign(orgId, "approve_transfer_financier", tr.id, { decision });
    await rpc("approve_transfer_financier", { p_org_id: orgId, p_transfer_id: tr.id, p_decision: decision, p_signature_id: sig });
  }, decision === "reject" ? "transfer.done_rejected" : "transfer.done_financier");
  const cancel = () => act(() => rpc("cancel_transfer", { p_org_id: orgId, p_transfer_id: tr.id, p_reason: null }),
    isBuyer ? "transfer.done_declined" : "transfer.done_cancelled");
  const approveTradeIn = () => act(() => rpc("approve_trade_in", { p_org_id: orgId, p_transfer_id: tr.id }), "transfer.done_trade_in");

  const statusKind = tr.status === "completed" ? "verifierad" : open ? "vantar" : "neutral";
  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t("transfer.title")} lead={t("transfer.lead", { from: tr.from?.name ?? "–", to: tr.to?.name ?? tr.to_email ?? tr.to_org_number ?? "–" })} />
      <div className="badge-rad"><StatusBadge kind={statusKind}>{t(`enum.transfer_status.${tr.status}`)}</StatusBadge>
        {tr.is_trade_in && <StatusBadge kind="neutral">{t("transfer.trade_in")}</StatusBadge>}</div>
      {done && <Notice kind="ok" title={t(done)} />}
      {tr.status === "completed" && (tr.to?.id === orgId || (isSeller && has("dealer"))) && (
        <Notice kind="ok" title={t("certificate.ready")}>
          <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" disabled={busy}
            onClick={() => void act(() => downloadCertificate(orgId, m.id, t), "certificate.downloaded")}><Icon name="nedladdning" />{t("certificate.download")}</button>
        </Notice>
      )}
      <section className="panel maskin-huvud" aria-label={t("machine.summary")}>
        <MachinePhoto path={m.primary_photo_path} category={m.category} size={112} />
        <div className="stack-2">
          <div><RegNumber value={m.reg_number} framed /></div>
          <strong>{m.make} {m.model}{m.year ? ` · ${m.year}` : ""}</strong>
          <div className="badge-rad"><MachineStatusBadge status={m.status} /><VerificationBadge level={m.verification_level} /></div>
          <p className="t-liten t-sekundar">{t("share.owner_ordinal", { count: m.owner_ordinal })}
            {(m.identifiers ?? []).filter((i) => i.type === "serial" || i.type === "pin").map((i) => <span key={i.value}> · <span className="mid-id">{i.value}</span></span>)}</p>
          <Link className="mid-lank" to={path(`machines/${m.id}?tab=history`)}>{t("transfer.see_history")}</Link>
        </div>
      </section>
      <dl className="faktarutnat">
        <div><dt>{t("transfer.seller")}</dt><dd>{tr.from?.name ?? "–"}</dd></div>
        <div><dt>{t("transfer.buyer")}</dt><dd>{tr.to?.name ?? tr.to_email ?? tr.to_org_number ?? "–"}</dd></div>
        <div><dt>{t("actions.transfer.sale_date")}</dt><dd>{formatDate(tr.sale_date)}</dd></div>
        <div><dt>{t("transfer.effective_date")}</dt><dd>{formatDate(tr.effective_date)}</dd></div>
        {open && <div><dt>{t("transfer.expires")}</dt><dd>{formatDateTime(tr.expires_at)}</dd></div>}
        <div><dt>{t("check.result_financing")}</dt><dd>{tr.existing_encumbrance
          ? `${t(`enum.encumbrance_type.${tr.existing_encumbrance.type}`)} · ${tr.existing_encumbrance.holder.name}` : t("components.financing.no")}</dd></div>
        {tr.financier_decision && <div><dt>{t("transfer.financier_decision")}</dt><dd>{t(`transfer.decision_${tr.financier_decision}`)}</dd></div>}
        {tr.new_financing && <div><dt>{t("transfer.new_financing")}</dt><dd>{t(`enum.encumbrance_type.${String(tr.new_financing.type ?? "ownership_reservation")}`)}</dd></div>}
      </dl>
      {m.flags.length > 0 && <Notice kind="fel" title={m.flags.map((f) => t(`enum.flag_type.${f.type}`)).join(", ")} />}
      {error != null && <ErrorNotice error={error} />}

      {canWrite && open && !done && (
        <section className="panel stack-3" aria-labelledby="atgard">
          {isBuyer && tr.status === "awaiting_buyer" && (
            <>
              <h2 id="atgard" className="t-rubrik-4">{t("transfer.buyer_title")}</h2>
              <p className="t-liten">{t("transfer.buyer_body", { date: formatDate(tr.effective_date) })}</p>
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy} onClick={() => void accept()}><Icon name="sigill" />{t("transfer.accept")}</button>
                <button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy} onClick={() => void cancel()}>{t("transfer.decline")}</button>
              </div>
            </>
          )}
          {isBuyer && tr.status !== "awaiting_buyer" && <p id="atgard" className="t-liten">{t(`transfer.waiting_${tr.status}`)}</p>}
          {isHolder && tr.status === "awaiting_financier" && (
            <>
              <h2 id="atgard" className="t-rubrik-4">{t("transfer.financier_title")}</h2>
              <p className="t-liten">{t("transfer.financier_body")}</p>
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy} onClick={() => void decide("release")}>{t("transfer.decision_release")}</button>
                <button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy} onClick={() => void decide("transfer_to_buyer")}>{t("transfer.decision_transfer_to_buyer")}</button>
                <button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy} onClick={() => void decide("reject")}>{t("transfer.decision_reject")}</button>
              </div>
            </>
          )}
          {isSeller && tr.status === "draft" && tr.is_trade_in && (
            <>
              <h2 id="atgard" className="t-rubrik-4">{t("transfer.trade_in_title", { dealer: tr.to?.name ?? "" })}</h2>
              <div className="mid-rad">
                <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy} onClick={() => void approveTradeIn()}>{t("transfer.trade_in_approve")}</button>
                <button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy} onClick={() => void cancel()}>{t("transfer.decline")}</button>
              </div>
            </>
          )}
          {isSeller && !(tr.status === "draft" && tr.is_trade_in) && (
            <div className="mid-rad mid-rad-mellan">
              <p className="t-liten">{t(`transfer.waiting_${tr.status}`)}</p>
              <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" disabled={busy} onClick={() => void cancel()}>{t("transfer.cancel")}</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
