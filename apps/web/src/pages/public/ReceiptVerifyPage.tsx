import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ErrorNotice, Notice } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { RegNumber } from "../../components/RegNumber";
import { FinancingBadge } from "../../components/StatusBadge";
import { useRpc } from "../../lib/api/query";
import { formatDateTime } from "../../lib/format";

interface Verified { valid: boolean; receipt_number?: string; report_number?: string; created_at?: string; performed_by?: string; org_name?: string;
  machines?: number; reg_number?: string | null; found?: boolean; has_active_financing?: boolean | null; kind?: string; superseded?: string | null }

/**
 * /receipt and /verify-document – anyone holding one of our PDFs confirms it with its number + checksum (SPEC §10):
 * K- check receipts, and snapshots F- fleet report, U- register extract, B- ownership certificate, R- machine report.
 */
export function ReceiptVerifyPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [nr, setNr] = useState(params.get("nr") ?? "");
  const [hash, setHash] = useState(params.get("hash") ?? "");
  const qn = params.get("nr");
  const qh = params.get("hash");
  const report = !!qn && /^[FUBRC]-/i.test(qn.trim());
  const q = useRpc<Verified>(report ? "verify_report" : "verify_check_receipt",
    qn && qh ? (report ? { p_report_number: qn, p_result_hash: qh } : { p_receipt_number: qn, p_result_hash: qh }) : null, { retry: false });
  return (
    <div className="behallare sektion stack-5 smal-bred">
      <h1 className="t-rubrik-2">{t("receipt_verify.title")}</h1>
      <p className="t-brodtext">{t("receipt_verify.lead")}</p>
      <form className="panel stack-3" onSubmit={(e) => { e.preventDefault(); setParams({ nr: nr.trim(), hash: hash.trim() }); }}>
        <FormField label={t("components.receipt.number")}>
          <input className="mid-input is-id" value={nr} onChange={(e) => setNr(e.target.value)} placeholder="K-2026-000001" autoComplete="off" />
        </FormField>
        <FormField label={t("receipt_verify.hash")} hint={t("receipt_verify.hash_hint")}>
          <input className="mid-input is-id" value={hash} onChange={(e) => setHash(e.target.value)} autoComplete="off" spellCheck={false} />
        </FormField>
        <div><button type="submit" className="mid-knapp mid-knapp-primar">{t("receipt_verify.submit")}</button></div>
      </form>
      {q.error && <ErrorNotice error={q.error} />}
      {q.data && (q.data.valid ? (
        <Notice kind="ok" title={t("receipt_verify.valid")}>
          {q.data.report_number ? (
            <p className="t-liten">{q.data.kind && q.data.kind !== "fleet_report" && q.data.kind !== "project_list"
              ? t(`receipt_verify.kind.${q.data.kind}`, { date: formatDateTime(q.data.created_at), org: q.data.org_name })
              : t("receipt_verify.report", { date: formatDateTime(q.data.created_at), org: q.data.org_name, count: q.data.machines })}</p>
          ) : <p className="t-liten">{t("components.receipt.performed", { date: formatDateTime(q.data.created_at), org: q.data.performed_by })}</p>}
          {q.data.superseded === "owner_changed" && <p className="mid-fel">{t("receipt_verify.superseded")}</p>}
          {q.data.report_number ? (q.data.reg_number ? <p><RegNumber value={q.data.reg_number} /></p> : null) : q.data.reg_number ? (
            <p className="mid-rad"><RegNumber value={q.data.reg_number} />{q.data.has_active_financing != null && <FinancingBadge hasActive={q.data.has_active_financing} />}</p>
          ) : <p className="t-liten">{t("check.not_found")}</p>}
        </Notice>
      ) : <Notice kind="fel" title={t("receipt_verify.invalid")}><p className="t-liten">{t("receipt_verify.invalid_body")}</p></Notice>)}
    </div>
  );
}
