import { useState } from "react";
import { eventText } from "../../lib/pdf/certificate";
import { downloadSharedMachineReport } from "../../lib/pdf/downloads";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { ErrorNotice, Notice, Skeleton } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { RegNumber } from "../../components/RegNumber";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "../../components/StatusBadge";
import type { Level, MachineStatus } from "../../lib/api/types";
import { backend } from "../../lib/backend";
import { formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { FleetShareView } from "./FleetShareView";

interface BuyerReport {
  reg_number: string; make: string; model: string; year: number | null; category: string; status: MachineStatus;
  verification_level: Level; verified_by: string | null; hour_meter: number | null; owner_ordinal: number; serial_masked: string;
  technical: Record<string, unknown>;
  financing: { has_active: boolean; holder: string | null; type: string | null };
  flags: { type: string; raised_at: string }[];
  history: { type: string; created_at: string; actor_org: string | null }[];
  documents: { id: string; type: string; filename: string; created_at: string; sha256: string }[];
  maintenance?: { type: string; performed_at: string; hours: number | null; performed_by_text: string | null }[];
  inspections?: { type: string; performed_at: string; result: string; valid_until: string | null; inspection_body_name: string }[];
}
interface ShareResponse { ok: boolean; reason?: string; scope?: string; expires_at?: string; shared_by?: string; views_left?: number | null; data?: unknown }

/** /s/:token – time-limited machine report shared by the owner (SPEC §6.10). */
export function SharePage() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: ["share", token],
    queryFn: () => backend.invoke<ShareResponse>("share-view", undefined, { method: "GET", query: { token: token ?? "" }, anonymous: true }).catch((e) => {
      if (e?.status === 404 && e.detail?.reason) return e.detail as ShareResponse;
      throw e;
    }),
    retry: false,
    staleTime: Infinity,
  });
  if (q.isLoading) return <div className="behallare sektion"><Skeleton lines={6} /></div>;
  if (q.error) return <div className="behallare sektion"><ErrorNotice error={q.error} /></div>;
  const s = q.data!;
  if (!s.ok) {
    return <div className="behallare sektion smal-bred"><Notice kind="fel" title={t(`share.reason_${s.reason ?? "not_found"}`)} /></div>;
  }
  if (s.scope === "fleet_report" || s.scope === "project_list") return <FleetShareView share={s as never} />;
  const r = s.data as BuyerReport;
  async function download(id: string) {
    const d = await backend.invoke<{ url: string }>("document-url", { document_id: id, share_token: token }, { anonymous: true });
    window.open(d.url, "_blank", "noopener");
  }
  return (
    <div className="behallare sektion stack-6 smal-bred">
      <Notice title={t("share.shared_by", { org: s.shared_by, date: formatDate(s.expires_at) })}>
        {s.views_left !== null && s.views_left !== undefined && <p className="t-liten">{t("share.views_left", { count: s.views_left })}</p>}
        <p><button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" disabled={pdfBusy}
          onClick={() => { setPdfBusy(true); setPdfError(null); downloadSharedMachineReport(token ?? "", t).catch(setPdfError).finally(() => setPdfBusy(false)); }}>
          <Icon name="nedladdning" />{t("machine_report.download")}</button></p>
        {!!pdfError && <ErrorNotice error={pdfError} />}
      </Notice>
      <article className="mid-post">
        <div className="mid-post-huvud">
          <div className="stack-3">
            <p className="t-liten t-sekundar">{t("enum.document_type.buyer_report")}</p>
            <h1 className="mid-post-titel">{r.make} {r.model}{r.year ? ` · ${r.year}` : ""}</h1>
            <RegNumber value={r.reg_number} framed size="stor" />
            <span className="badge-rad"><MachineStatusBadge status={r.status} /><VerificationBadge level={r.verification_level} /></span>
          </div>
        </div>
        <dl className="mid-post-falt">
          <div><dt>{t("public.serial")}</dt><dd className="mid-id">{r.serial_masked}</dd><dd>{t("share.owner_ordinal", { count: r.owner_ordinal })}</dd></div>
          <div><dt>{t("machine.hours")}</dt><dd>{r.hour_meter !== null ? formatNumber(r.hour_meter) : "–"}</dd></div>
          <div>
            <dt>{t("check.result_financing")}</dt>
            <dd><FinancingBadge hasActive={r.financing.has_active} /></dd>
            {r.financing.holder && <dd>{r.financing.holder} · {t(`enum.encumbrance_type.${r.financing.type}`)}</dd>}
          </div>
        </dl>
      </article>
      {!!r.flags.length && <Notice kind="fel" title={r.flags.map((f) => t(`enum.flag_type.${f.type}`)).join(", ")} />}
      {!!r.inspections?.length && (
        <section className="stack-3"><h2 className="t-rubrik-3">{t("fleet.inspections")}</h2>
          <ul className="mid-historik">{r.inspections.map((x, i) => <li key={i}><time>{formatDate(x.performed_at)}</time><p>{x.inspection_body_name} · {t(`enum.inspection_result.${x.result}`)}{x.valid_until ? ` · ${t("public.inspected_until", { date: formatDate(x.valid_until) })}` : ""}</p></li>)}</ul>
        </section>
      )}
      {!!r.maintenance?.length && (
        <section className="stack-3"><h2 className="t-rubrik-3">{t("fleet.service")}</h2>
          <ul className="mid-historik">{r.maintenance.map((x, i) => <li key={i}><time>{formatDate(x.performed_at)}</time><p>{t(`enum.maintenance_type.${x.type}`)}{x.hours ? ` · ${formatNumber(x.hours)} h` : ""}{x.performed_by_text ? ` · ${x.performed_by_text}` : ""}</p></li>)}</ul>
        </section>
      )}
      {!!r.documents.length && (
        <section className="stack-3">
          <h2 className="t-rubrik-3">{t("machine.tab_documents")}</h2>
          <ul className="inkorg">
            {r.documents.map((d) => (
              <li key={d.id} className="inkorg-rad">
                <Icon name="dokument" />
                <div className="inkorg-text"><strong>{t(`enum.document_type.${d.type}`)}</strong><span>{d.filename} · {formatDate(d.created_at)}</span></div>
                <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void download(d.id)}><Icon name="nedladdning" />{t("common.download")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="stack-3">
        <h2 className="t-rubrik-3">{t("machine.tab_history")}</h2>
        <ol className="mid-historik">
          {r.history.map((h, i) => (
            <li key={i}>
              <time>{formatDateTime(h.created_at)}</time>
              <p>{i18n.exists(`events.${h.type}`) ? eventText(t, h) : h.type}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
