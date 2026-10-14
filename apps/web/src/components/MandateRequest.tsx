/**
 * Asking a machine owner for access, and the owner deciding (ADR 0032).
 *
 * "Vill man ha tillgång till den fullständiga historiken ska man kunna skicka en förfrågan till maskinägaren, som
 *  sedan får godkänna att informationen delas." — and the same mechanism answers the bank-fleet question: a lender
 *  sees only what it finances unless the company consents to more.
 *
 * Built on `mandates`, so the consent is scoped, time-limited, BankID-signed and revocable by either side. The
 * request is created with status `requested`; only the principal can approve it, and only with a signature.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../auth/OrgContext";
import { Dialog } from "./Dialog";
import { ErrorNotice, Notice } from "./Feedback";
import { FormField } from "./FormField";
import { Icon } from "./Icon";
import { useSign } from "./Signature";
import { queryClient, rpc, useRpc } from "../lib/api/query";
import { ApiError } from "../lib/backend";
import { formatDate, todayIso } from "../lib/format";

function inDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Shared frame: a form that reports its own errors and refreshes the reads afterwards. */
function RequestDialog({ open, onClose, title, submitLabel, onSubmit, children }: {
  open: boolean; onClose(): void; title: string; submitLabel: string;
  onSubmit(): Promise<void>; children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form className="stack-4" noValidate onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit();
          await queryClient.invalidateQueries({ queryKey: ["rpc"] });
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}>
        {children}
        {error != null && <ErrorNotice error={error} />}
        <div className="mid-rad mid-rad-slut">
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={busy}>{busy ? t("common.loading") : submitLabel}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** After sending: who it went to (without naming the owner, ADR 0032) and where to follow it. */
function RequestSent({ fleet }: { fleet?: boolean }) {
  const { t } = useTranslation();
  const { path } = useOrg();
  return (
    <div className="stack-3">
      <Notice kind="ok" title={t(fleet ? "mandate.request_sent_fleet" : "mandate.request_sent")}><p className="t-liten">{t("mandate.request_sent_next")}</p></Notice>
      <p className="t-liten t-sekundar">{t("mandate.no_terms_note")}</p>
      <div><Link className="mid-knapp mid-knapp-kontur mid-knapp-liten" to={path("mandates")}>{t("mandate.to_mandates")}</Link></div>
    </div>
  );
}

interface OwnRequest { id: string; machine_id: string | null; status: string; direction: string; created_at: string }

/** Our own open request for this machine's history, if there is one. Reads the same list as Fullmakter. */
function useOpenHistoryRequest(machineId: string) {
  const { orgId } = useOrg();
  const q = useRpc<OwnRequest[]>("list_mandates", { p_org_id: orgId });
  return (q.data ?? []).find((d) => d.machine_id === machineId && d.direction === "received" && d.status === "requested") ?? null;
}

/**
 * Asking, or – once asked – what became of it. Without this a sent request vanished: the requester saw the same
 * button again and had no way to tell that anything was waiting anywhere.
 */
export function RequestHistoryAction({ machineId, onAsk, compact }: { machineId: string; onAsk(): void; compact?: boolean }) {
  const { t } = useTranslation();
  const { orgId, isAdmin } = useOrg();
  const open = useOpenHistoryRequest(machineId);
  if (open) {
    return (
      <span className="mid-rad">
        <span className={compact ? "t-liten t-sekundar" : "t-brodtext"}>{t("mandate.request_open", { date: formatDate(open.created_at) })}</span>
        {isAdmin && (
          <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={async () => {
            await rpc("revoke_mandate", { p_org_id: orgId, p_mandate_id: open.id });
            await queryClient.invalidateQueries({ queryKey: ["rpc"] });
          }}>{t("mandate.withdraw")}</button>
        )}
      </span>
    );
  }
  if (!isAdmin) return null;
  return (
    <button type="button" className={compact ? "mid-knapp mid-knapp-kontur mid-knapp-liten" : "mid-knapp mid-knapp-primar"} onClick={onAsk}>
      {!compact && <Icon name="sigill" />}{t("mandate.request_history")}
    </button>
  );
}

/** Ask the owner of one machine for its full history. */
export function RequestMachineHistoryDialog({ machineId, open, onClose }: { machineId: string; open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [message, setMessage] = useState("");
  const [validTo, setValidTo] = useState(inDays(90));
  const [sent, setSent] = useState(false);
  if (open && sent) {
    return (
      <Dialog open onClose={() => { setSent(false); onClose(); }} title={t("mandate.request_history")}>
        <RequestSent />
      </Dialog>
    );
  }
  return (
    <RequestDialog open={open} onClose={onClose} title={t("mandate.request_history")} submitLabel={t("common.send")}
      onSubmit={async () => {
        // The principal is derived from the machine's current owner server-side, so a stale id cannot redirect it.
        await rpc("request_mandate", {
          p_org_id: orgId, p_principal_org_id: null, p_machine_id: machineId,
          p_scopes: ["view"], p_valid_to: validTo, p_message: message || null,
        });
        setSent(true);
      }}>
      <p className="t-liten">{t("mandate.request_history_lead")}</p>
      <FormField label={t("mandate.request_valid_to")}>
        <input className="mid-input" type="date" min={todayIso()} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
      </FormField>
      <FormField label={t("mandate.request_message")} optional>
        <textarea className="mid-textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </FormField>
      <p className="t-liten t-sekundar">{t("mandate.no_terms_note")}</p>
    </RequestDialog>
  );
}

/**
 * Ask a company for a view of its whole fleet. This is the answer to "ska banken även kunna se företagets övriga
 * maskiner" — it can, when the company says so, for as long as the company says so.
 */
export function RequestFleetAccessDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [orgNumber, setOrgNumber] = useState("");
  const [message, setMessage] = useState("");
  const [validTo, setValidTo] = useState(inDays(30));
  const [sent, setSent] = useState(false);
  if (open && sent) {
    return (
      <Dialog open onClose={() => { setSent(false); onClose(); }} title={t("mandate.request_fleet")}>
        <RequestSent fleet />
      </Dialog>
    );
  }
  return (
    <RequestDialog open={open} onClose={onClose} title={t("mandate.request_fleet")} submitLabel={t("common.send")}
      onSubmit={async () => {
        // The company has to be in the register to be asked: there is nobody to approve otherwise.
        const hit = await rpc<{ existing_org?: { id: string } | null }>("lookup_company", { p_org_number: orgNumber });
        if (!hit.existing_org) throw new ApiError("ORG_NOT_IN_REGISTER", undefined, 404);
        await rpc("request_mandate", {
          p_org_id: orgId, p_principal_org_id: hit.existing_org.id, p_machine_id: null,
          p_scopes: ["view"], p_valid_to: validTo, p_message: message || null,
        });
        setSent(true);
      }}>
      <p className="t-liten">{t("mandate.request_fleet_lead")}</p>
      <FormField label={t("mandate.request_principal")}>
        <input className="mid-input is-id" value={orgNumber} onChange={(e) => setOrgNumber(e.target.value)} placeholder="556701-2009" />
      </FormField>
      <FormField label={t("mandate.request_valid_to")}>
        <input className="mid-input" type="date" min={todayIso()} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
      </FormField>
      <FormField label={t("mandate.request_message")} optional>
        <textarea className="mid-textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </FormField>
      <p className="t-liten t-sekundar">{t("mandate.no_terms_note")}</p>
    </RequestDialog>
  );
}

export interface MandateRequestRow {
  id: string;
  machine_id: string | null;
  valid_to: string;
  scopes: string[];
  request_message: string | null;
  agent?: { id: string; name: string } | null;
  machine?: { id: string; reg_number: string; make: string; model: string } | null;
}

/** The owner's decision. Approving is signed, because it is the same act as granting a power of attorney. */
export function DecideMandateDialog({ request, onClose }: { request: MandateRequestRow | null; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const sign = useSign();
  if (!request) return null;
  const what = request.machine_id ? t("mandate.what_machine") : t("mandate.what_fleet");
  return (
    <RequestDialog open onClose={onClose} title={t("mandate.approve")} submitLabel={t("mandate.approve")}
      onSubmit={async () => {
        const sig = await sign(orgId, "grant_mandate", orgId, {
          agent_org_id: request.agent?.id ?? "", machine_id: request.machine_id ?? "",
          scopes: [...request.scopes].sort().join(", "), valid_to: request.valid_to,
        });
        await rpc("decide_mandate_request", {
          p_org_id: orgId, p_mandate_id: request.id, p_approve: true, p_signature_id: sig,
        });
        onClose();
      }}>
      <p className="t-brodtext">
        {t("mandate.approve_lead", { agent: request.agent?.name ?? "", what, until: formatDate(request.valid_to) })}
      </p>
      {request.machine && <p className="t-liten t-sekundar">{request.machine.make} {request.machine.model}</p>}
      {request.request_message && <blockquote className="t-liten">{request.request_message}</blockquote>}
      <p className="t-liten t-sekundar">{t("mandate.no_terms_note")}</p>
      <div>
        <button type="button" className="mid-knapp mid-knapp-kontur"
          onClick={async () => {
            await rpc("decide_mandate_request", { p_org_id: orgId, p_mandate_id: request.id, p_approve: false });
            await queryClient.invalidateQueries({ queryKey: ["rpc"] });
            onClose();
          }}>{t("mandate.decline")}</button>
      </div>
    </RequestDialog>
  );
}
