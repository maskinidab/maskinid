import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { labelSerial } from "@maskinid/shared/identifiers.ts";
import { QrCode } from "../../../components/QrCode";
import { lotTagPdf } from "../../../lib/pdf/adQr";
import { DataTable } from "../../../components/DataTable";
import { DocumentDropzone } from "../../../components/DocumentDropzone";
import { EmptyState, ErrorNotice, Notice, PageHeader, Skeleton, Tabs } from "../../../components/Feedback";
import { Icon, type IconName } from "../../../components/Icon";
import { MachinePhoto } from "../../../components/MachinePhoto";
import { RegNumber } from "../../../components/RegNumber";
import { FinancingTermsSummary } from "../../../components/FinancingTerms";
import { RequestHistoryAction, RequestMachineHistoryDialog } from "../../../components/MandateRequest";
import { FinancingBadge, MachineStatusBadge, StatusBadge, VerificationBadge } from "../../../components/StatusBadge";
import { StatusBanner } from "../../../components/StatusBanner";
import { Timeline } from "../../../components/Timeline";
import { rpc, useRpc, useRpcMutation } from "../../../lib/api/query";
import type { DocumentItem, Encumbrance, Flag, HistoryEvent, MachineView, MarketListing, PayoffRequest } from "../../../lib/api/types";
import { backend, isApiError } from "../../../lib/backend";
import { formatDate, formatDateTime, formatMonth, formatNumber } from "../../../lib/format";
import { extractPdf } from "../../../lib/pdf/extract";
import { downloadCertificate, downloadMachineReport } from "../../../lib/pdf/downloads";
import { downloadBytes } from "../../../lib/pdf/receipt";
import { GrantMandateDialog } from "../org/MandatesPage";
import { OperationalNotice } from "./OperationsSection";
import { PositionBox } from "./PositionBox";
import { ServiceTab } from "./ServiceTab";
import {
  AcceptTakeoverDialog, AttachFinancingDialog, EditFinancingTermsDialog, ManualFinancingDialog, PayoffDeclineDialog, PayoffPanel,
  PayoffQuoteDialog, PayoffSettleDialog, PayoffSettlementDialog, RejectEncumbranceDialog, RequestPayoffDialog,
  TransferHolderDialog,
} from "./FinancingActions";
import {
  BindLabelDialog, ClearFlagDialog, DeregisterDialog, EditMachineDialog, EncumbranceDialog, FlagDialog, ReleaseEncumbranceDialog,
  ReimportDialog, RequestReleaseDialog, ShareDialog, TransferDialog, VerificationDialog,
} from "./MachineActions";

type Tab = "overview" | "history" | "documents" | "financing" | "service" | "access";
type DialogId = "transfer" | "flag" | "deregister" | "share" | "encumbrance" | "label" | "verify" | "edit" | "mandate"
  | "attach_financing" | "manual_financing" | "reimport" | null;

const READ_ONLY: MachineView["status"][] = ["scrapped", "exported", "deregistered"];

/** Machine page (SPEC §9.2): header with status, tabs, and the actions the org's role allows. */
export function MachinePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { orgId, has, canWrite, minTrustedLevel, path, isAdmin } = useOrg();
  const [params, setParams] = useSearchParams();
  const q = useRpc<MachineView>("get_machine", { p_org_id: orgId, p_machine_id: id });
  // Payoff requests for this machine. Only parties to the conversation get rows back (RLS + the RPC).
  const payoffs = useRpc<PayoffRequest[]>("list_payoff_requests", { p_org_id: orgId });
  const [dialog, setDialog] = useState<DialogId>(null);
  const [clearFlag, setClearFlag] = useState<Flag | null>(null);
  const [release, setRelease] = useState<Encumbrance | null>(null);
  const [askRelease, setAskRelease] = useState<Encumbrance | null>(null);
  const [reject, setReject] = useState<Encumbrance | null>(null);
  const [handOver, setHandOver] = useState<Encumbrance | null>(null);
  const [takeOver, setTakeOver] = useState<Encumbrance | null>(null);
  const [askPayoff, setAskPayoff] = useState<Encumbrance | null>(null);
  const [payoffPurpose, setPayoffPurpose] = useState<"owner_request" | "export">("owner_request");
  const [payoffAction, setPayoffAction] = useState<"quote" | "settlement" | "settle" | "decline" | null>(null);
  const [editTerms, setEditTerms] = useState<Encumbrance | null>(null);
  const [pdfError, setPdfError] = useState<unknown>(null);

  if (q.isLoading) return <Skeleton lines={8} height={28} />;
  // An action can end the very relation that made this page readable: a lender releasing a block, an owner
  // deregistering or completing a sale, an agent revoking a mandate. The action succeeded and then the refetch
  // comes back NOT_FOUND, which used to replace the page with "Uppgiften finns inte eller så har du inte
  // behörighet" – read as a failure (ADR 0030). Say what actually happened instead.
  if (isApiError(q.error, "NOT_FOUND")) {
    return (
      <div className="stack-4">
        <Notice kind="info" title={t("machine.gone_from_you")}>
          <p>{t("machine.gone_from_you_body")}</p>
        </Notice>
        <div className="mid-rad">
          <Link className="mid-knapp mid-knapp-primar" to={path("machines")}>{t("nav.machines")}</Link>
          <Link className="mid-knapp mid-knapp-kontur" to={path("inbox")}>{t("nav.inbox")}</Link>
        </div>
      </div>
    );
  }
  if (q.error || !q.data) return <ErrorNotice error={q.error} />;
  const m = q.data;
  const rel = m.relations;
  const isOwner = rel.includes("owner");
  const full = m.access === "full";
  const readOnly = READ_ONLY.includes(m.status);
  const tabParam = params.get("tab");
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: t("machine.tab_overview") },
    { id: "history", label: t("machine.tab_history") },
    ...(full || rel.includes("holder") ? [{ id: "documents" as Tab, label: t("machine.tab_documents") }] : []),
    ...(full ? [{ id: "service" as Tab, label: t("machine.tab_service") }] : []),
    ...(m.encumbrances ? [{ id: "financing" as Tab, label: t("machine.tab_financing"), count: m.encumbrances.filter((e) => e.status === "active" || e.status === "pending").length }] : []),
    ...(rel.includes("owner") || rel.includes("user") || has("authority") ? [{ id: "access" as Tab, label: t("machine.tab_access") }] : []),
  ];
  const tab: Tab = tabs.some((x) => x.id === tabParam) ? (tabParam as Tab) : "overview";
  const active = m.financing?.active ?? null;
  async function pdf(kind: "extract" | "certificate" | "report") {
    setPdfError(null);
    try {
      if (kind === "certificate") await downloadCertificate(orgId, m.id, t);
      else if (kind === "report") await downloadMachineReport(orgId, m.id, t);
      else {
        const x = await rpc<{ report_number: string; result_hash: string; result: never }>("create_register_extract", { p_org_id: orgId, p_machine_id: m.id });
        downloadBytes(await extractPdf(x.result, x, t), `registerutdrag-${x.report_number}.pdf`);
      }
    } catch (e) {
      setPdfError(e);
    }
  }
  const flags = m.flags.filter((f) => f.status === "active");
  const openPayoff = (payoffs.data ?? []).find((p) => p.machine_id === m.id && ["requested", "quoted", "settlement_submitted"].includes(p.status))
    ?? (payoffs.data ?? []).find((p) => p.machine_id === m.id) ?? null;

  // Actions per role (SPEC §9.2). Every legal step opens a summary + signature.
  const actions: { id: Exclude<DialogId, null>; label: string; icon: IconName; danger?: boolean }[] = [];
  // An exported machine is read-only until it is brought back, so re-import is the one action outside the guard.
  if (canWrite && readOnly && m.status === "exported" && isOwner) {
    actions.push({ id: "reimport", label: t("actions.reimport.title"), icon: "byt" });
  }
  if (canWrite && !readOnly) {
    const blocked = m.status === "stolen" || m.status === "blocked";
    const stolenActive = flags.some((f) => f.type === "stolen");
    if (isOwner && !m.open_transfer && !blocked) actions.push({ id: "transfer", label: t("actions.transfer.title"), icon: "byt" });
    if (isOwner) actions.push({ id: "share", label: t("actions.share.title"), icon: "lank" });
    if (isOwner && isAdmin && !blocked) actions.push({ id: "mandate", label: t("mandate.action"), icon: "sigill" });
    if (full) actions.push({ id: "edit", label: t("actions.edit.title"), icon: "penna" });
    if (full && m.verification_level < 2) actions.push({ id: "verify", label: t("actions.verify.title"), icon: "sigill" });
    if ((full || has("dealer") || has("inspector")) && Array.isArray(m.labels) && !m.labels.some((l) => l.status === "bound")) {
      actions.push({ id: "label", label: t("actions.label.title"), icon: "qr" });
    }
    if (has("financier") && !m.financing?.has_active && !blocked) actions.push({ id: "encumbrance", label: t("actions.encumbrance.title"), icon: "hanglas" });
    if (has("authority") || (!stolenActive && (isOwner || rel.includes("user") || rel.includes("holder") || has("insurer")))) {
      actions.push({ id: "flag", label: has("authority") ? t("actions.flag.title") : t("actions.flag.report_stolen"), icon: "flagga", danger: true });
    }
    if (isOwner || (rel.includes("holder") && m.financing?.has_active)) actions.push({ id: "deregister", label: t("actions.deregister.title"), icon: "stang", danger: true });
    // Reporting a financing: "Bifoga dokument" for anyone who owns or sells the machine, and the manual form
    // for dealers only — a plain company account should not have to get a form right (R10).
    if ((isOwner || has("dealer")) && !m.financing?.has_active && !m.financing?.has_pending && !blocked) {
      actions.push({ id: "attach_financing", label: t("actions.financing.attach"), icon: "dokument" });
      if (has("dealer")) actions.push({ id: "manual_financing", label: t("actions.financing.manual"), icon: "penna" });
    }
  }

  return (
    <div className="stack-6">
      <PageHeader title={`${m.make} ${m.model}`} crumbs={[{ to: path("machines"), label: t("machines.title") }]}
        lead={[m.variant, m.year, t(`enum.category.${m.category}`)].filter(Boolean).join(" · ")} />
      {m.status !== "active" && m.status !== "draft" && <StatusBanner status={m.status} />}
      <OperationalNotice m={m} />
      {m.merged_into && (
        <Notice title={t("machine.merged_into", { reg: m.merged_into.reg_number })}>
          <p><Link className="mid-lank" to={path(`machines/${m.merged_into.id}`)}>{t("machine.merged_open")}</Link></p>
        </Notice>
      )}
      <section className="panel maskin-huvud" aria-label={t("machine.summary")}>
        <MachinePhoto path={m.primary_photo_path} category={m.category} size={132} alt={`${m.make} ${m.model}`} />
        <div className="stack-3">
          <div><RegNumber value={m.reg_number} framed copy size="stor" /></div>
          <div className="badge-rad">
            <MachineStatusBadge status={m.status} />
            <VerificationBadge level={m.verification_level} minTrusted={minTrustedLevel} />
            {m.financing && <FinancingBadge hasActive={m.financing.has_active} pending={m.financing.has_pending} pendingHolder={m.financing.pending?.holder.name} />}
            {typeof m.inspection_valid_until === "string" && <StatusBadge kind="verifierad" icon="bock">{t("machine.inspected_until", { date: formatMonth(m.inspection_valid_until) })}</StatusBadge>}
            {m.inspection_required === true && !m.inspection_valid_until && full && <StatusBadge kind="vantar">{t("machine.inspection_missing")}</StatusBadge>}
            {m.insured === true && <StatusBadge kind="neutral" icon="skold">{t("machine.insured")}</StatusBadge>}
            {m.registration_type === "temporary" && <StatusBadge kind="vantar">{t("machine.temporary_until", { date: formatDate(m.valid_until) })}</StatusBadge>}
          </div>
          {m.owner && <p className="t-liten">{t("machine.owner")}: <strong>{m.owner.name}</strong>{m.owner.city ? ` · ${m.owner.city}` : ""}
            {m.access !== "basic" && <span className="t-sekundar"> · {t("share.owner_ordinal", { count: m.owner_ordinal })}</span>}</p>}
          {m.rental != null && (
            <p className="t-liten">{t(m.relations.includes("lessee") ? "machine.rented_from" : "machine.rented_to", {
              org: (m.rental as { lessee: string; lessor: string })[m.relations.includes("lessee") ? "lessor" : "lessee"],
              date: formatDate((m.rental as { to: string }).to) })}</p>
          )}
          {m.insurance_requirement != null && (
            <Notice kind="info" title={t("machine.insurer_requires", { insurer: (m.insurance_requirement as { insurer: string }).insurer,
              level: t(`level.${(m.insurance_requirement as { level: number }).level}.name`) })} />
          )}
          {Array.isArray(m.market_listings) && m.market_listings.length > 0 && <MarketListings listings={m.market_listings} stolen={m.status === "stolen"} />}
          {m.open_transfer && (
            <Notice kind="info" title={t("machine.transfer_open_status", { status: t(`enum.transfer_status.${m.open_transfer.status}`) })}>
              <Link className="mid-lank" to={path(`transfers/${m.open_transfer.id}`)}>{t("common.open")}</Link>
            </Notice>
          )}
          {(isOwner || has("authority")) && m.status !== "draft" && (
            <div className="mid-rad">
              {isOwner && <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => void pdf("certificate")}><Icon name="sigill" />{t("certificate.download")}</button>}
              {isOwner && <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => void pdf("report")}><Icon name="lista" />{t("machine_report.download")}</button>}
              <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => void pdf("extract")}><Icon name="dokument" />{t("extract.create")}</button>
              {typeof m.claim_url === "string" && <a className="mid-knapp mid-knapp-text mid-knapp-liten" href={m.claim_url} target="_blank" rel="noopener noreferrer"><Icon name="extern" />{t("machine.claim")}</a>}
            </div>
          )}
          {!!pdfError && <ErrorNotice error={pdfError} />}
          {actions.length > 0 && (
            <div className="mid-rad">
              {actions.map((a, i) => (
                <button key={a.id} type="button" onClick={() => setDialog(a.id)}
                  className={`mid-knapp mid-knapp-liten ${i === 0 && !a.danger ? "mid-knapp-primar" : "mid-knapp-kontur"}`}>
                  <Icon name={a.icon} />{a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <Tabs panels label={t("machine.tabs")} tabs={tabs} value={tab} onChange={(x) => setParams({ tab: x }, { replace: true })} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`flik-${tab}`} className="stack-5">
        {tab === "overview" && (has("owner") || (has("authority") && m.status === "stolen")) && <PositionBox machineId={m.id} stolen={m.status === "stolen"} />}
        {tab === "overview" && <Overview m={m} flags={flags} onClearFlag={setClearFlag} />}
        {tab === "history" && <History machineId={m.id} />}
        {tab === "documents" && <Documents m={m} />}
        {tab === "financing" && (
          <FinancingTab m={m} onRelease={setRelease} onAskRelease={setAskRelease} onReject={setReject}
            onHandOver={setHandOver} onTakeOver={setTakeOver} onAskPayoff={(e) => { setPayoffPurpose("owner_request"); setAskPayoff(e); }}
            payoff={openPayoff} onPayoffAction={setPayoffAction} onEditTerms={setEditTerms}
            onAttach={(isOwner || has("dealer")) && canWrite && !readOnly ? () => setDialog("attach_financing") : undefined}
            onManual={has("dealer") && canWrite && !readOnly ? () => setDialog("manual_financing") : undefined}
            onRegister={has("financier") && !active && canWrite && !readOnly ? () => setDialog("encumbrance") : undefined} />
        )}
        {tab === "service" && <ServiceTab m={m} />}
        {tab === "access" && <Access m={m} />}
      </div>

      <TransferDialog m={m} open={dialog === "transfer"} onClose={() => setDialog(null)} />
      <FlagDialog m={m} open={dialog === "flag"} onClose={() => setDialog(null)} />
      <DeregisterDialog m={m} open={dialog === "deregister"} onClose={() => setDialog(null)} payoff={openPayoff}
        onRequestPayoff={active ? () => { setDialog(null); setPayoffPurpose("export"); setAskPayoff(active); } : undefined} />
      <ShareDialog m={m} open={dialog === "share"} onClose={() => setDialog(null)} />
      {dialog === "mandate" && <GrantMandateDialog machine={m} onClose={() => setDialog(null)} />}
      <EncumbranceDialog m={m} open={dialog === "encumbrance"} onClose={() => setDialog(null)} />
      <BindLabelDialog m={m} open={dialog === "label"} onClose={() => setDialog(null)} />
      <VerificationDialog m={m} open={dialog === "verify"} onClose={() => setDialog(null)} />
      {dialog === "edit" && <EditMachineDialog m={m} open onClose={() => setDialog(null)} />}
      <ClearFlagDialog m={m} flag={clearFlag} onClose={() => setClearFlag(null)} />
      <ReleaseEncumbranceDialog m={m} e={release} onClose={() => setRelease(null)} />
      <RequestReleaseDialog m={m} e={askRelease} onClose={() => setAskRelease(null)} />
      <AttachFinancingDialog m={m} open={dialog === "attach_financing"} onClose={() => setDialog(null)} />
      <ManualFinancingDialog m={m} open={dialog === "manual_financing"} onClose={() => setDialog(null)} />
      <ReimportDialog m={m} open={dialog === "reimport"} onClose={() => setDialog(null)} />
      <RejectEncumbranceDialog e={reject} onClose={() => setReject(null)} />
      <TransferHolderDialog e={handOver} onClose={() => setHandOver(null)} />
      <AcceptTakeoverDialog e={takeOver} m={m} onClose={() => setTakeOver(null)} />
      <RequestPayoffDialog e={askPayoff} purpose={payoffPurpose} onClose={() => setAskPayoff(null)} />
      <EditFinancingTermsDialog e={editTerms} onClose={() => setEditTerms(null)} />
      {payoffAction === "quote" && <PayoffQuoteDialog m={m} payoff={openPayoff} onClose={() => setPayoffAction(null)} />}
      {payoffAction === "settlement" && <PayoffSettlementDialog m={m} payoff={openPayoff} onClose={() => setPayoffAction(null)} />}
      {payoffAction === "settle" && <PayoffSettleDialog payoff={openPayoff} onClose={() => setPayoffAction(null)} />}
      {payoffAction === "decline" && <PayoffDeclineDialog payoff={openPayoff} onClose={() => setPayoffAction(null)} />}
    </div>
  );
}

/** Opens a document through the signed-URL Edge Function (5 minute expiry). */
async function openDocument(id: string) {
  const r = await backend.invoke<{ url: string }>("document-url", { document_id: id });
  window.open(r.url, "_blank", "noopener");
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? "–"}</dd></div>;
}

/** Owner, flagging org or authority chooses whether a stolen machine is shown on the public stolen list (/stolen). */
function StolenPublicToggle({ orgId, sp }: { orgId: string; sp: { flag_id: string; published: boolean } }) {
  const { t } = useTranslation();
  const m = useRpcMutation<{ p_org_id: string; p_flag_id: string; p_public: boolean }>("set_flag_public");
  return (
    <div className="stack-2">
      <label className="mid-kryss">
        <input type="checkbox" checked={sp.published} disabled={m.isPending}
          onChange={(e) => m.mutate({ p_org_id: orgId, p_flag_id: sp.flag_id, p_public: e.target.checked })} />
        {t("stolen.publish_toggle")}
      </label>
      <p className="t-liten t-sekundar">{t("stolen.publish_hint")}</p>
      {m.error && <ErrorNotice error={m.error} />}
    </div>
  );
}

function Overview({ m, flags, onClearFlag }: { m: MachineView; flags: Flag[]; onClearFlag(f: Flag): void }) {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const tech = m.technical;
  const labels = Array.isArray(m.labels) ? m.labels : null;
  const bound = labels?.find((l) => l.status === "bound" && l.role === "primary") ?? null;
  const [labelError, setLabelError] = useState<unknown>(null);
  return (
    <>
      {flags.length > 0 && (
        <section className="stack-3" aria-labelledby="flaggor">
          <h2 id="flaggor" className="t-rubrik-4">{t("machine.flags")}</h2>
          {flags.map((f, i) => (
            <Notice key={f.id ?? i} kind="fel" title={`${t(`enum.flag_type.${f.type}`)} · ${formatDate(f.raised_at)}`}>
              {f.raised_by && <p className="t-liten">{t("machine.flag_by", { org: f.raised_by })}{f.reference ? ` · ${f.reference}` : ""}</p>}
              {f.description && <p className="t-liten">{f.description}</p>}
              {f.location_text && <p className="t-liten">{t("actions.flag.location")}: {f.location_text}</p>}
              {f.can_clear && f.id && <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => onClearFlag(f)}>{t("actions.clear_flag.title")}</button>}
            </Notice>
          ))}
          {m.stolen_public && canWrite && <StolenPublicToggle orgId={orgId} sp={m.stolen_public} />}
        </section>
      )}
      <section className="stack-3" aria-labelledby="identitet">
        <h2 id="identitet" className="t-rubrik-4">{t("machine.identity")}</h2>
        <dl className="faktarutnat">
          {m.identifiers.map((i, n) => (
            <Fact key={i.id ?? n} label={t(`enum.identifier_type.${i.type}`)}>
              <span className="mid-id">{i.value}</span>{i.verified && <> <Icon name="bock" className="ikon-inline" label={t("machine.verified_identifier")} /></>}
              {i.in_conflict && <> · <span className="t-fel">{t("machine.in_conflict")}</span></>}
            </Fact>
          ))}
          <Fact label={t("level.label")}>{t(`level.${m.verification_level}.name`)}{m.verified_by ? ` · ${m.verified_by}` : ""}{m.verified_at ? ` · ${formatDate(m.verified_at)}` : ""}</Fact>
          <Fact label={t("machine.origin")}>{t(`enum.origin.${m.origin}`)}</Fact>
          {labels && <Fact label={t("machine.label")}>{labels.filter((l) => l.status === "bound").map((l) => <span key={l.id} className="mid-id">{labelSerial(l.code)} </span>)}
            {!labels.some((l) => l.status === "bound") && t("machine.no_label")}</Fact>}
          {!labels && <Fact label={t("machine.label")}>{(m.labels as { has_bound_label: boolean }).has_bound_label ? t("common.yes") : t("common.no")}</Fact>}
          {bound && (
            <Fact label={t("machine.label_qr")}>
              <span className="qr-rad">
                <a href={`/m/${bound.code}`} target="_blank" rel="noopener">
                  <QrCode url={`${location.origin}/m/${bound.code}`} size={128} alt={t("labels.qr_alt", { serial: labelSerial(bound.code) })} />
                </a>
                <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten"
                  onClick={() => { setLabelError(null); lotTagPdf({ ...m, label_code: bound.code }, t, location.origin)
                    .then((b) => downloadBytes(b, `marke-${m.reg_number}.pdf`)).catch(setLabelError); }}>
                  <Icon name="uppladdning" />{t("machine.label_print")}
                </button>
              </span>
            </Fact>
          )}
          {m.registered_by && <Fact label={t("machine.registered_by")}>{m.registered_by.name} · {formatDate(m.created_at)}</Fact>}
          {m.user_org && <Fact label={t("machine.user_org")}>{m.user_org.name}</Fact>}
          {m.last_transfer_date && <Fact label={t("machine.last_transfer")}>{formatDate(m.last_transfer_date)}</Fact>}
        </dl>
        {!!labelError && <ErrorNotice error={labelError} />}
      </section>
      <section className="stack-3" aria-labelledby="teknik">
        <h2 id="teknik" className="t-rubrik-4">{t("machine.technical")}</h2>
        <dl className="faktarutnat">
          <Fact label={t("machine.hours")}>{m.hour_meter === null ? null : `${formatNumber(m.hour_meter)} h`}{m.hour_meter_updated_at ? ` · ${formatDate(m.hour_meter_updated_at)}` : ""}</Fact>
          <Fact label={t("wizard.weight")}>{tech.service_weight_kg === null ? null : `${formatNumber(tech.service_weight_kg)} kg`}</Fact>
          <Fact label={t("wizard.power")}>{tech.engine_power_kw === null ? null : `${formatNumber(tech.engine_power_kw)} kW${tech.power_standard ? ` (${t(`enum.power_standard.${tech.power_standard}`)})` : ""}`}</Fact>
          <Fact label={t("wizard.fuel")}>{tech.fuel_type ? t(`enum.fuel.${tech.fuel_type}`) : null}{tech.electric_config ? ` · ${t(`enum.electric.${tech.electric_config}`)}` : ""}</Fact>
          <Fact label={t("wizard.emission")}>{tech.emission_stage ? t(`enum.emission.${tech.emission_stage}`) : null}</Fact>
          <Fact label={t("wizard.engine")}>{[tech.engine_make, tech.engine_model].filter(Boolean).join(" ") || null}</Fact>
          <Fact label={t("wizard.lifting")}>{tech.has_lifting_device ? t("common.yes") : t("common.no")}</Fact>
          <Fact label={t("wizard.ce")}>{tech.ce_marked === null ? null : tech.ce_marked ? t("common.yes") : t("common.no")}</Fact>
          <Fact label={t("machine.registration_liable")}>{tech.registration_liable ? t("common.yes") : t("common.no")}</Fact>
          {m.color && <Fact label={t("wizard.color")}>{m.color}</Fact>}
        </dl>
        {m.description && <p className="t-brodtext">{m.description}</p>}
      </section>
    </>
  );
}

function History({ machineId }: { machineId: string }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [before, setBefore] = useState<number | null>(null);
  const [pages, setPages] = useState<HistoryEvent[]>([]);
  const [ask, setAsk] = useState(false);
  const q = useRpc<HistoryEvent[]>("get_machine_history", { p_org_id: orgId, p_machine_id: machineId, p_limit: 50, p_before_seq: before });
  if (q.isLoading && pages.length === 0) return <Skeleton lines={6} />;
  // Everyone can search a serial and see whether the machine is financed; the history needs the owner's consent
  // (ADR 0032). So a NOT_FOUND here is not an error — it is the point at which you ask.
  if (isApiError(q.error, "NOT_FOUND")) {
    return (
      <div className="stack-4">
        <Notice kind="info" title={t("mandate.request_history")}>
          <p>{t("mandate.request_history_lead")}</p>
        </Notice>
        <div><RequestHistoryAction machineId={machineId} onAsk={() => setAsk(true)} /></div>
        <RequestMachineHistoryDialog machineId={machineId} open={ask} onClose={() => setAsk(false)} />
      </div>
    );
  }
  if (q.error) return <ErrorNotice error={q.error} />;
  const all = [...pages, ...(q.data ?? []).filter((e) => !pages.some((p) => p.seq === e.seq))];
  const last = all[all.length - 1];
  return <Timeline events={all} hasMore={(q.data?.length ?? 0) === 50}
    onLoadMore={() => { setPages(all); setBefore(last ? last.seq : null); }} />;
}

function Documents({ m }: { m: MachineView }) {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const q = useRpc<DocumentItem[]>("list_documents", { p_org_id: orgId, p_machine_id: m.id });
  const setPhoto = useRpcMutation<{ p_org_id: string; p_machine_id: string; p_document_id: string }>("set_primary_photo");
  const [type, setType] = useState("photo_machine");
  const open = (d: DocumentItem) => openDocument(d.id);
  const full = m.access === "full";
  return (
    <div className="stack-4">
      {full && canWrite && (
        <section className="panel stack-3" aria-labelledby="ladda-upp">
          <h2 id="ladda-upp" className="t-rubrik-4">{t("machine.upload")}</h2>
          <label className="mid-etikett" htmlFor="doktyp">{t("common.type")}</label>
          <select id="doktyp" className="mid-select" value={type} onChange={(e) => setType(e.target.value)}>
            {["photo_machine", "photo_nameplate", "invoice", "purchase_agreement", "financing_contract", "bank_order", "payoff_statement", "ce_declaration", "inspection_report", "manual", "other"].map((x) =>
              <option key={x} value={x}>{t(`enum.document_type.${x}`)}</option>)}
          </select>
          <DocumentDropzone orgId={orgId} machineId={m.id} type={type} camera={type.startsWith("photo")} onUploaded={() => void q.refetch()} />
        </section>
      )}
      {q.isLoading ? <Skeleton /> : q.error ? <ErrorNotice error={q.error} /> : (
        <DataTable caption={t("machine.tab_documents")} rows={q.data ?? []} getKey={(d) => d.id} exportName="dokument"
          empty={<EmptyState icon="dokument" title={t("machine.no_documents")} />}
          columns={[
            { id: "name", header: t("common.name"), value: (d) => d.filename, cell: (d) => (
              <button type="button" className="mid-lank-knapp mid-lank" onClick={() => void open(d)}>{d.filename}</button>) },
            { id: "type", header: t("common.type"), value: (d) => d.type, cell: (d) => t(`enum.document_type.${d.type}`) },
            { id: "visibility", header: t("machine.visibility"), value: (d) => d.visibility, cell: (d) => t(`enum.visibility.${d.visibility}`), hideOnMobile: true },
            { id: "created", header: t("common.date"), value: (d) => d.created_at, cell: (d) => formatDate(d.created_at), sortable: true },
            { id: "status", header: t("common.status"), value: (d) => d.status, cell: (d) => (
              <span className="mid-rad">
                {d.status !== "clean" && d.status !== "ready" ? t(`machine.doc_status.${d.status}`, { defaultValue: d.status }) : ""}
                {full && canWrite && d.type === "photo_machine" && d.status !== "infected" && (
                  <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" disabled={setPhoto.isPending}
                    onClick={() => setPhoto.mutate({ p_org_id: orgId, p_machine_id: m.id, p_document_id: d.id })}>{t("machine.set_primary")}</button>
                )}
              </span>
            ) },
          ]} />
      )}
    </div>
  );
}

/**
 * Financing tab. Shows what is reported as well as what is confirmed, carries the documents behind a financing,
 * and holds the payoff conversation. The reject / hand-over / take-over buttons expose RPCs that existed from
 * the start but had no UI at all.
 */
function FinancingTab({ m, onRelease, onAskRelease, onRegister, onAttach, onManual, onReject, onHandOver, onTakeOver, onAskPayoff, onEditTerms, payoff, onPayoffAction }: {
  m: MachineView;
  onRelease(e: Encumbrance): void;
  onAskRelease(e: Encumbrance): void;
  onRegister?: () => void;
  onAttach?: () => void;
  onManual?: () => void;
  onReject(e: Encumbrance): void;
  onHandOver(e: Encumbrance): void;
  onTakeOver(e: Encumbrance): void;
  onAskPayoff(e: Encumbrance): void;
  onEditTerms(e: Encumbrance): void;
  payoff: PayoffRequest | null;
  onPayoffAction(a: "quote" | "settlement" | "settle" | "decline"): void;
}) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const list = m.encumbrances ?? [];
  const isOwner = m.relations.includes("owner");
  const isHolder = payoff ? payoff.holder?.id === orgId : m.financing?.active?.holder.id === orgId;
  const confirm = useRpcMutation<{ p_org_id: string; p_encumbrance_id: string }>("confirm_encumbrance");
  return (
    <div className="stack-4">
      <p className="t-liten t-sekundar">{t("actions.encumbrance.no_amounts")}</p>
      <div className="mid-rad">
        {onRegister && <button type="button" className="mid-knapp mid-knapp-primar" onClick={onRegister}><Icon name="hanglas" />{t("actions.encumbrance.title")}</button>}
        {onAttach && <button type="button" className="mid-knapp mid-knapp-primar" onClick={onAttach}><Icon name="dokument" />{t("actions.financing.attach")}</button>}
        {onManual && <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={onManual}><Icon name="penna" />{t("actions.financing.manual")}</button>}
      </div>
      <PayoffPanel payoff={payoff} isHolder={!!isHolder} onAction={onPayoffAction} />
      {list.length === 0 ? <EmptyState icon="hanglas" title={t("components.financing.no")} /> : list.map((e) => (
        <article key={e.id} className="mid-post stack-2">
          <div className="mid-rad mid-rad-mellan">
            <strong>{t(`enum.encumbrance_type.${e.type}`)} · {e.holder.name}</strong>
            <StatusBadge kind={e.status === "active" ? "belanad" : e.status === "pending" ? "vantar" : "neutral"}>{t(`enum.encumbrance_status.${e.status}`)}</StatusBadge>
          </div>
          <p className="t-liten t-sekundar">
            {formatDate(e.start_date)}{e.end_date ? ` – ${formatDate(e.end_date)}` : ""}
            {e.contract_ref ? ` · ${t("actions.encumbrance.contract_ref")}: ${e.contract_ref}` : ""}
            {e.released_at ? ` · ${t("machine.released_at", { date: formatDate(e.released_at) })}` : ""}
          </p>
          {e.rejected_reason && <p className="mid-fel">{e.rejected_reason}</p>}
          {/* Only ever present for the owner and the holder: machine_view_extras adds the terms object for
              nobody else (ADR 0029), so there is no visibility decision to make here. */}
          {e.terms && <FinancingTermsSummary terms={e.terms} />}
          {e.terms && (e.holder.id === orgId || isOwner) && (e.status === "active" || e.status === "pending") && (
            <div><button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => onEditTerms(e)}>{t("financing.terms.edit")}</button></div>
          )}
          {!!e.documents?.length && (
            <ul className="lista-punkter t-liten">
              {e.documents.map((d) => (
                <li key={d.id}>
                  <button type="button" className="mid-lank" onClick={() => void openDocument(d.id)}>
                    {t(`enum.document_type.${d.type}`)} · {d.filename}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mid-rad">
            {e.status === "active" && e.holder.id === orgId && (
              <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => onRelease(e)}>{t("actions.release.title")}</button>
            )}
            {/* A handover row is accepted, never "confirmed": confirming one used to raise a false conflict. */}
            {e.status === "pending" && e.holder.id === orgId && e.transferred_from_encumbrance_id && (
              <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" onClick={() => onTakeOver(e)}>{t("actions.financing.accept_takeover")}</button>
            )}
            {e.status === "pending" && e.holder.id === orgId && !e.transferred_from_encumbrance_id && (
              <>
                <button type="button" className="mid-knapp mid-knapp-primar mid-knapp-liten" disabled={confirm.isPending}
                  onClick={() => confirm.mutate({ p_org_id: orgId, p_encumbrance_id: e.id })}>{t("machine.confirm_encumbrance")}</button>
                <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => onReject(e)}>{t("actions.financing.reject")}</button>
              </>
            )}
            {e.status === "active" && e.holder.id === orgId && (
              <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => onHandOver(e)}>{t("actions.financing.transfer_holder")}</button>
            )}
            {e.status === "active" && isOwner && e.holder.id !== orgId && (
              <>
                <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => onAskRelease(e)}>{t("actions.request_release.title")}</button>
                {!payoff && <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten" onClick={() => onAskPayoff(e)}>{t("payoff.request")}</button>}
              </>
            )}
          </div>
        </article>
      ))}
      {confirm.error && <ErrorNotice error={confirm.error} />}
    </div>
  );
}

interface AccessRow { id: string; viewer_type: string; via: string; created_at: string; viewer_org_name: string | null; approx_location: { city?: string | null; lat?: number; lng?: number } | string | null; user_agent_family: string | null }

/** access_log.approx_location is { lat, lng, city } (rounded) – show the town only. */
function placeText(p: AccessRow["approx_location"]): string {
  if (!p) return "–";
  if (typeof p === "string") return p;
  return p.city ?? (p.lat !== undefined && p.lng !== undefined ? `${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}` : "–");
}
interface ShareRow { id: string; scope: string; token_prefix: string; expires_at: string; max_views: number | null; views: number; active: boolean; created_at: string }

function Access({ m }: { m: MachineView }) {
  const { t } = useTranslation();
  const { orgId, canWrite } = useOrg();
  const log = useRpc<AccessRow[]>("list_access_log", { p_org_id: orgId, p_machine_id: m.id });
  const links = useRpc<ShareRow[]>("list_share_links", m.relations.includes("owner") ? { p_org_id: orgId, p_machine_id: m.id } : null);
  return (
    <div className="stack-5">
      {m.relations.includes("owner") && (
        <section className="stack-3" aria-labelledby="delningar">
          <h2 id="delningar" className="t-rubrik-4">{t("machine.share_links")}</h2>
          {(links.data ?? []).length === 0 ? <p className="t-liten t-sekundar">{t("machine.no_share_links")}</p> : (
            <ul className="radlista">
              {links.data!.map((s) => (
                <li key={s.id}>
                  <span><strong>{t(`enum.share_scope.${s.scope}`)}</strong> · <span className="mid-id">{s.token_prefix}…</span><br />
                    <span className="t-liten t-sekundar">{t("machine.share_meta", { views: s.views, date: formatDate(s.expires_at) })}{!s.active ? ` · ${t("machine.share_closed")}` : ""}</span></span>
                  {s.active && canWrite && (
                    <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten"
                      onClick={() => void rpc("revoke_share_link", { p_org_id: orgId, p_share_link_id: s.id }).then(() => links.refetch())}>{t("machine.share_revoke")}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="stack-3" aria-labelledby="atkomstlogg">
        <h2 id="atkomstlogg" className="t-rubrik-4">{t("machine.access_log")}</h2>
        <p className="t-liten t-sekundar">{t("machine.access_log_lead")}</p>
        {log.isLoading ? <Skeleton /> : log.error ? <ErrorNotice error={log.error} /> : (
          <DataTable caption={t("machine.access_log")} rows={log.data ?? []} getKey={(r) => r.id} exportName="atkomstlogg"
            empty={<EmptyState icon="oga" title={t("machine.no_access")} />}
            columns={[
              { id: "at", header: t("common.date"), value: (r) => r.created_at, cell: (r) => formatDateTime(r.created_at), sortable: true },
              { id: "who", header: t("machine.viewer"), value: (r) => r.viewer_org_name ?? r.viewer_type,
                cell: (r) => r.viewer_org_name ?? t(`enum.viewer_type.${r.viewer_type}`) },
              { id: "via", header: t("machine.via"), value: (r) => r.via, cell: (r) => t(`enum.access_via.${r.via}`) },
              { id: "where", header: t("machine.where"), value: (r) => placeText(r.approx_location), cell: (r) => placeText(r.approx_location), hideOnMobile: true },
            ]} />
        )}
      </section>
    </div>
  );
}

/** "Senast sedd till salu hos …" (SPEC §8.6) – never presented as owner, never with a price. */
function MarketListings({ listings, stolen }: { listings: MarketListing[]; stolen: boolean }) {
  const { t } = useTranslation();
  return (
    <Notice kind={stolen ? "fel" : "info"} title={t(stolen ? "machine.market_stolen_listed" : "machine.market_listed", { count: listings.length })}>
      <ul className="stack-1">
        {listings.map((l, i) => (
          <li key={i} className="t-liten">
            {t("machine.market_seen_at", { where: l.seller ?? l.source, date: formatDate(l.seen_at) })}
            {l.location ? ` · ${l.location}` : ""}
            {l.seller && <span className="t-sekundar"> · {l.source}</span>}
            {l.url && <> · <a className="mid-lank" href={l.url} target="_blank" rel="noopener noreferrer nofollow">{t("machine.market_open")}</a></>}
          </li>
        ))}
      </ul>
    </Notice>
  );
}
