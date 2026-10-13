import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useOrg } from "../../auth/OrgContext";
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from "../../components/Feedback";
import { Icon, type IconName } from "../../components/Icon";
import { DecideMandateDialog, type MandateRequestRow } from "../../components/MandateRequest";
import { RegNumber } from "../../components/RegNumber";
import { useRpc } from "../../lib/api/query";
import type { InboxItem, OrgBrief, PayoffRequest, Transfer } from "../../lib/api/types";
import { backend } from "../../lib/backend";
import { formatDate } from "../../lib/format";

const ICON: Record<string, IconName> = {
  transfer_accept: "byt", transfer_financier: "byt", trade_in_approve: "byt", encumbrance_confirm: "hanglas", encumbrance_takeover: "hanglas",
  verification_review: "sigill", verification_needs_info: "sigill", correction_objection: "skold", conflict: "varning", invitation: "personer",
  payoff_request: "hanglas", payoff_quote: "dokument", payoff_settlement_review: "hanglas", mandate_request: "sigill",
};

function describe(item: InboxItem, t: (k: string, o?: Record<string, unknown>) => string): { reg?: string; text: string; to?: string; machineId?: string } {
  const tr = item.transfer as Transfer | undefined;
  switch (item.kind) {
    case "transfer_accept":
    case "transfer_financier":
    case "trade_in_approve":
      return { reg: tr?.reg_number, text: `${tr?.from?.name ?? ""} → ${tr?.to?.name ?? tr?.to_email ?? ""}`, to: `transfers/${item.id}` };
    case "encumbrance_confirm":
    case "encumbrance_takeover": {
      const e = item.encumbrance as { type: string };
      return { reg: item.reg_number as string, text: t(`enum.encumbrance_type.${e.type}`), to: `machines/${item.machine_id as string}?tab=financing` };
    }
    // Payoff items: the panel that answers them lives on the machine's financing tab.
    case "payoff_request":
    case "payoff_quote":
    case "payoff_settlement_review": {
      const p = item.payoff as PayoffRequest | undefined;
      return {
        reg: p?.reg_number,
        text: [p ? t(`enum.payoff_purpose.${p.purpose}`) : "", p?.requested_by?.name].filter(Boolean).join(" · "),
        to: p ? `machines/${p.machine_id}?tab=financing` : undefined,
      };
    }
    case "verification_review":
    case "verification_needs_info": {
      const r = item.request as { reg_number: string; requested_level: number; machine_id: string; decision_note?: string };
      return { reg: r.reg_number, text: `${t(`level.${r.requested_level}.name`)}${r.decision_note ? ` – ${r.decision_note}` : ""}`,
        to: item.kind === "verification_review" ? `verify/${item.id}` : `machines/${r.machine_id}?tab=overview` };
    }
    case "correction_objection": {
      const c = item.correction as { reg_number: string; machine_id: string; to: OrgBrief; effective_after: string };
      return { reg: c.reg_number, text: `→ ${c.to.name} · ${formatDate(c.effective_after)}`, to: `machines/${c.machine_id}?tab=overview` };
    }
    case "conflict": {
      const c = item.conflict as { type: string; machine: { id: string; reg_number: string } | null };
      return { reg: c.machine?.reg_number, text: t(`enum.conflict_type.${c.type}`), to: c.machine ? `machines/${c.machine.id}` : undefined };
    }
    // A consent request waiting for us as the owner of the data (ADR 0032). Decided in the dialog below rather
    // than on another page: the decision is the whole item.
    case "mandate_request": {
      const d = item.mandate as MandateRequestRow & { agent?: OrgBrief | null };
      return {
        reg: d.machine?.reg_number,
        text: [d.agent?.name, d.machine_id ? t("mandate.what_machine") : t("mandate.what_fleet")].filter(Boolean).join(" · "),
      };
    }
    case "invitation":
      return { text: (item.org as OrgBrief).name };
    default:
      return { text: item.kind };
  }
}

export function InboxList({ items }: { items: InboxItem[] }) {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { refresh } = useAuth();
  const [decide, setDecide] = useState<MandateRequestRow | null>(null);
  if (!items.length) return <p className="t-sekundar">{t("inbox.empty")}</p>;
  return (
    <ul className="inkorg">
      {items.map((item) => {
        const d = describe(item, t);
        return (
          <li key={`${item.kind}-${item.id}`} className="inkorg-rad">
            <Icon name={ICON[item.kind] ?? "info"} />
            <div className="inkorg-text">
              <strong>{t(`inbox.${item.kind}`)}</strong>
              <span>{d.reg && <RegNumber value={d.reg} />} {d.text}</span>
            </div>
            {item.kind === "invitation" ? (
              <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten" onClick={async () => {
                await backend.rpc("accept_invite", { p_membership_id: item.id });
                await refresh();
              }}>{t("onboarding.accept")}</button>
            ) : item.kind === "mandate_request" ? (
              <button type="button" className="mid-knapp mid-knapp-sekundar mid-knapp-liten"
                onClick={() => setDecide(item.mandate as MandateRequestRow)}>{t("inbox.handle")}</button>
            ) : d.to ? <Link className="mid-knapp mid-knapp-sekundar mid-knapp-liten" to={path(d.to)}>{t("inbox.handle")}</Link> : null}
          </li>
        );
      })}
      <DecideMandateDialog request={decide} onClose={() => setDecide(null)} />
    </ul>
  );
}

export function InboxPage() {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const q = useRpc<{ count: number; items: InboxItem[] }>("get_inbox", { p_org_id: orgId }, { refetchInterval: 15_000 });
  return (
    <div className="stack-5">
      <PageHeader title={t("inbox.title")} />
      {q.error && <ErrorNotice error={q.error} />}
      {q.isLoading ? <Skeleton lines={4} /> : q.data?.items.length ? <InboxList items={q.data.items} />
        : <EmptyState icon="inkorg" title={t("inbox.empty")} action={{ label: t("nav.machines"), to: path("machines") }} />}
    </div>
  );
}
