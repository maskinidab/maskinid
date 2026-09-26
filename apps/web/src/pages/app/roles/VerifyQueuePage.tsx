import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { RegNumber } from "../../../components/RegNumber";
import { ScannerView } from "../../../components/Scanner";
import { StatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";
import type { DocumentItem, Level, MachineView, OrgBrief } from "../../../lib/api/types";
import { backend } from "../../../lib/backend";
import { formatDate, formatDateTime } from "../../../lib/format";

export interface VerificationRequest {
  id: string; machine_id: string; requested_level: 1 | 2; status: string; reg_number: string;
  machine: { make: string; model: string; year: number | null; category: string; verification_level: Level };
  requested_by: OrgBrief; reviewer: OrgBrief | null; note: string | null; preferred_date: string | null; site_address: string | null;
  decision_note: string | null; assigned_to: string | null; created_at: string;
}

/** Verification queue for trusted partners (SPEC §6.4): level 1 document review, level 2 on-site ("Bokningar"). */
export function VerifyQueuePage() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const bookings = useLocation().pathname.endsWith("bookings");
  const q = useRpc<VerificationRequest[]>("list_verification_queue", { p_org_id: orgId });
  const rows = (q.data ?? []).filter((v) => !bookings || v.requested_level === 2);
  return (
    <div className="stack-6">
      <PageHeader title={bookings ? t("nav.bookings") : t("nav.verify")} lead={bookings ? t("verifyq.bookings_lead") : t("verifyq.lead")} />
      {q.isLoading ? <Skeleton lines={5} /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("nav.verify")} rows={rows} getKey={(v) => v.id} exportName="verifieringar"
          empty={<EmptyState icon="sigill" title={t("verifyq.empty")} />}
          filters={[{ id: "level", label: t("level.label"), options: [1, 2].map((l) => ({ value: String(l), label: t(`level.${l}.name`) })), match: (v, x) => String(v.requested_level) === x }]}
          columns={[
            { id: "created", header: t("common.date"), value: (v) => v.created_at, cell: (v) => formatDate(v.created_at), sortable: true },
            { id: "reg", header: t("machines.col_reg"), value: (v) => v.reg_number, cell: (v) => <Link to={path(`verify/${v.id}`)}><RegNumber value={v.reg_number} /></Link> },
            { id: "machine", header: t("machines.col_machine"), value: (v) => `${v.machine.make} ${v.machine.model}`, cell: (v) => `${v.machine.make} ${v.machine.model}${v.machine.year ? ` · ${v.machine.year}` : ""}` },
            { id: "by", header: t("verifyq.requested_by"), value: (v) => v.requested_by.name, cell: (v) => v.requested_by.name },
            { id: "level", header: t("level.label"), value: (v) => v.requested_level, cell: (v) => t(`level.${v.requested_level}.name`) },
            { id: "when", header: t("verifyq.when_where"), value: (v) => v.preferred_date, hideOnMobile: true,
              cell: (v) => [v.preferred_date && formatDate(v.preferred_date), v.site_address].filter(Boolean).join(" · ") || "–" },
            { id: "status", header: t("common.status"), value: (v) => v.status, cell: (v) => <StatusBadge kind={v.status === "needs_info" ? "vantar" : "neutral"}>{t(`enum.verification_request_status.${v.status}`)}</StatusBadge> },
          ]} />
      )}
    </div>
  );
}

/** Review one request: documents side by side with register data; decide; level 2 requires the nameplate reading. */
export function VerifyReviewPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const nav = useNavigate();
  const q = useRpc<VerificationRequest & { machine_view: MachineView; documents: DocumentItem[] }>("claim_verification", { p_org_id: orgId, p_request_id: id },
    { staleTime: Infinity, refetchOnWindowFocus: false });
  const [note, setNote] = useState("");
  const [serial, setSerial] = useState("");
  const [label, setLabel] = useState("");
  const [scan, setScan] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Skeleton lines={8} />;
  if (q.error || !q.data) return <ErrorNotice error={q.error} />;
  const v = q.data;
  const m = v.machine_view;
  async function decide(decision: "approved" | "rejected" | "needs_info") {
    setBusy(true);
    setError(null);
    try {
      await rpc("decide_verification", { p_org_id: orgId, p_request_id: v.id, p_decision: decision, p_note: note || null,
        p_nameplate_serial: v.requested_level === 2 ? serial || null : null, p_label_code: v.requested_level === 2 ? label || null : null });
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
      nav(path("verify"));
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function open(d: DocumentItem) {
    const r = await backend.invoke<{ url: string }>("document-url", { document_id: d.id });
    window.open(r.url, "_blank", "noopener");
  }
  return (
    <div className="stack-6">
      <PageHeader title={t("verifyq.review_title", { level: t(`level.${v.requested_level}.name`) })} crumbs={[{ to: path("verify"), label: t("nav.verify") }]}
        lead={t("verifyq.review_lead", { org: v.requested_by.name, date: formatDateTime(v.created_at) })} />
      <div className="rutnat">
        <section className="kol-6 panel stack-3" aria-labelledby="registerdata">
          <h2 id="registerdata" className="t-rubrik-4">{t("verifyq.register_data")}</h2>
          <div><RegNumber value={m.reg_number} framed /></div>
          <p><strong>{m.make} {m.model}</strong>{m.year ? ` · ${m.year}` : ""} · {t(`enum.category.${m.category}`)}</p>
          <VerificationBadge level={m.verification_level} />
          <dl className="faktarutnat">
            {m.identifiers.map((i, n) => <div key={n}><dt>{t(`enum.identifier_type.${i.type}`)}</dt><dd className="mid-id">{i.value}</dd></div>)}
            <div><dt>{t("machine.owner")}</dt><dd>{m.owner?.name ?? "–"}</dd></div>
          </dl>
          {v.note && <Notice kind="info" title={t("verifyq.owner_note")}><p className="t-liten">{v.note}</p></Notice>}
          {v.site_address && <p className="t-liten">{t("verifyq.site", { address: v.site_address, date: formatDate(v.preferred_date) })}</p>}
        </section>
        <section className="kol-6 panel stack-3" aria-labelledby="underlag">
          <h2 id="underlag" className="t-rubrik-4">{t("verifyq.documents")}</h2>
          {v.documents.length === 0 ? <p className="t-liten t-sekundar">{t("verifyq.no_documents")}</p> : (
            <ul className="radlista">
              {v.documents.map((d) => (
                <li key={d.id}><span>{t(`enum.document_type.${d.type}`)}<br /><span className="t-liten t-sekundar">{d.filename}</span></span>
                  <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => void open(d)}><Icon name="extern" />{t("common.open")}</button></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="panel stack-4" aria-labelledby="beslut">
        <h2 id="beslut" className="t-rubrik-4">{t("verifyq.decision")}</h2>
        {v.requested_level === 2 && (
          <>
            <FormField label={t("verifyq.nameplate_serial")} hint={t("verifyq.nameplate_hint")}>
              <input className="mid-input is-id" value={serial} onChange={(e) => setSerial(e.target.value)} autoCapitalize="characters" />
            </FormField>
            {scan ? <ScannerView onResult={(r) => { if (r.kind === "label") { setLabel(r.code); setScan(false); } }} /> : (
              <div><button type="button" className="mid-knapp mid-knapp-kontur" onClick={() => setScan(true)}><Icon name="qr" />{t("actions.label.scan")}</button></div>
            )}
            <FormField label={t("actions.label.code")} optional><input className="mid-input is-id" value={label} onChange={(e) => setLabel(e.target.value)} /></FormField>
          </>
        )}
        <FormField label={t("common.note")} hint={t("verifyq.note_hint")}><textarea className="mid-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        {error != null && <ErrorNotice error={error} />}
        <div className="mid-rad">
          <button type="button" className="mid-knapp mid-knapp-primar" disabled={busy || (v.requested_level === 2 && !serial.trim())} onClick={() => void decide("approved")}>
            <Icon name="bock" />{t("verifyq.approve")}</button>
          <button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy || !note.trim()} onClick={() => void decide("needs_info")}>{t("verifyq.needs_info")}</button>
          <button type="button" className="mid-knapp mid-knapp-kontur" disabled={busy || !note.trim()} onClick={() => void decide("rejected")}>{t("verifyq.reject")}</button>
        </div>
      </section>
    </div>
  );
}
