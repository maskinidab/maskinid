import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { EmptyState, ErrorNotice, Notice, PageHeader } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { rpc } from "../../../lib/api/query";
import type { MachineView } from "../../../lib/api/types";
import { MachineHit, MachineLookupForm, useMachineLookup } from "../encumbrances/NewEncumbrancePage";

/**
 * Reached from the duplicate hit in SerialInput (SPEC §6.2): "Är det din? [Begär ägarbyte] [Rapportera fel]".
 * A transfer is always started by the current owner, so "Begär ägarbyte" explains that and – for dealers – offers a
 * trade-in request. "Rapportera fel" opens an ownership dispute for the operator (SPEC §4.4).
 */
export function ReportErrorPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const mode = pathname.endsWith("transfer-request") ? "transfer" : "error";
  const { orgId, has, canWrite } = useOrg();
  const { busy, error, hits, lookup } = useMachineLookup();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [sendError, setSendError] = useState<unknown>(null);
  const reg = params.get("reg") ?? "";
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (reg) void lookup(reg); }, [reg]);

  async function dispute(m: MachineView) {
    setSendError(null);
    if (!text.trim()) { setSendError(new Error("VALIDATION")); return; }
    try {
      await rpc("report_ownership_dispute", { p_org_id: orgId, p_machine_id: m.id, p_description: text });
      setSent("report_error.sent");
    } catch (e) { setSendError(e); }
  }
  async function tradeIn(m: MachineView) {
    setSendError(null);
    try {
      await rpc("request_trade_in", { p_org_id: orgId, p_machine_id: m.id, p_message: text || null });
      setSent("report_error.trade_in_sent");
    } catch (e) { setSendError(e); }
  }

  return (
    <div className="stack-6 smal smal-bred">
      <PageHeader title={t(mode === "transfer" ? "report_error.transfer_title" : "report_error.title")}
        lead={t(mode === "transfer" ? "report_error.transfer_lead" : "report_error.lead")} />
      {sent && <Notice kind="ok" title={t(sent)} />}
      {!reg && <MachineLookupForm onLookup={(q) => void lookup(q)} busy={busy} />}
      {error != null && <ErrorNotice error={error} />}
      {hits && hits.length === 0 && <EmptyState icon="sok" title={t("check.not_found")} />}
      {!sent && hits?.slice(0, 1).map((m) => (
        <MachineHit key={m.id} m={m}>
          <FormField label={t(mode === "transfer" ? "report_error.message" : "report_error.description")} hint={t("report_error.description_hint")}
            error={sendError instanceof Error && sendError.message === "VALIDATION" ? t("common.required") : null}>
            <textarea className="mid-textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </FormField>
          {sendError != null && !(sendError instanceof Error && sendError.message === "VALIDATION") && <ErrorNotice error={sendError} />}
          {canWrite && (
            <div className="mid-rad">
              {mode === "transfer" && has("dealer") && (
                <button type="button" className="mid-knapp mid-knapp-primar" onClick={() => void tradeIn(m)}>{t("report_error.request_trade_in")}</button>
              )}
              <button type="button" className={mode === "transfer" && has("dealer") ? "mid-knapp mid-knapp-kontur" : "mid-knapp mid-knapp-primar"}
                onClick={() => void dispute(m)}>{t("report_error.submit")}</button>
            </div>
          )}
        </MachineHit>
      ))}
    </div>
  );
}
