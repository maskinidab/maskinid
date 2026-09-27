import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useOrg } from "../../auth/OrgContext";
import { Notice, PageHeader, Skeleton } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { RegNumber } from "../../components/RegNumber";
import { useRpc } from "../../lib/api/query";
import type { InboxItem, MachineListItem } from "../../lib/api/types";
import { formatDateTime } from "../../lib/format";
import { IdentityStep } from "../onboarding/IdentityStep";
import { InboxList } from "./InboxPage";

interface OrgEvent { seq: number; type: string; created_at: string; machine_id: string | null; reg_number: string | null; actor_name: string | null; payload: Record<string, unknown> }

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { context } = useAuth();
  const { org, orgId, path, has, canWrite } = useOrg();
  const machines = useRpc<{ total: number; items: MachineListItem[] }>("list_machines", { p_org_id: orgId, p_scope: "all", p_limit: 500 });
  const inbox = useRpc<{ count: number; items: InboxItem[] }>("get_inbox", { p_org_id: orgId });
  const events = useRpc<OrgEvent[]>("list_org_events", { p_org_id: orgId, p_limit: 8 });
  const [hideChecklist, setHide] = useState(() => localStorage.getItem(`maskinid.checklist.${orgId}`) === "hidden");
  const items = machines.data?.items ?? [];
  const financed = items.filter((m) => m.has_active_financing).length;
  const stolen = items.filter((m) => m.status === "stolen").length;
  return (
    <div className="stack-6">
      <PageHeader title={t("dashboard.greeting", { name: context?.full_name?.split(" ")[0] ?? "" })} lead={org.name}
        actions={canWrite && (has("owner") || has("dealer")) ? <Link className="mid-knapp mid-knapp-primar" to={path("machines/new")}><Icon name="plus" />{t("nav.register")}</Link> : undefined} />
      {org.status === "pending" && <Notice title={t("onboarding.pending_title")}><p className="t-liten">{t("onboarding.pending_body")}</p></Notice>}
      {!context?.identity_verified_at && <IdentityStep />}
      {machines.isLoading ? <Skeleton lines={2} height={40} /> : (
        <dl className="nyckeltal">
          <div><dt>{t("dashboard.machines")}</dt><dd>{machines.data?.total ?? 0}</dd></div>
          <div><dt>{t("dashboard.financed")}</dt><dd>{financed}</dd></div>
          <div><dt>{t("dashboard.stolen")}</dt><dd>{stolen}</dd></div>
          <div><dt>{t("dashboard.waiting")}</dt><dd>{inbox.data?.count ?? 0}</dd></div>
        </dl>
      )}
      {canWrite && !hideChecklist && (items.length < 3) && (
        <section className="panel stack-3" aria-labelledby="checklista">
          <div className="panel-huvud">
            <h2 id="checklista" className="t-rubrik-4">{t("onboarding.checklist_title")}</h2>
            <button type="button" className="mid-lank-knapp mid-lank" onClick={() => { localStorage.setItem(`maskinid.checklist.${orgId}`, "hidden"); setHide(true); }}>{t("common.close")}</button>
          </div>
          <ul className="handlingar">
            <li><Link className="handling" to={path("machines/new")}><strong><Icon name={items.length ? "bock" : "plus"} />{t("onboarding.check_first_machine")}</strong></Link></li>
            <li><Link className="handling" to={path("import")}><strong><Icon name="uppladdning" />{t("onboarding.check_import")}</strong></Link></li>
            <li><Link className="handling" to={path("labels")}><strong><Icon name="qr" />{t("onboarding.check_labels")}</strong></Link></li>
            <li><Link className="handling" to={path("settings?tab=api")}><strong><Icon name="nyckel" />{t("onboarding.check_api")}</strong></Link></li>
          </ul>
        </section>
      )}
      <div className="rutnat">
        <section className="kol-7 stack-3" aria-labelledby="vantar">
          <div className="panel-huvud">
            <h2 id="vantar" className="t-rubrik-3">{t("dashboard.waiting")}</h2>
            <Link className="mid-lank" to={path("inbox")}>{t("common.view")}</Link>
          </div>
          {inbox.isLoading ? <Skeleton /> : <InboxList items={(inbox.data?.items ?? []).slice(0, 5)} />}
        </section>
        <section className="kol-5 stack-3" aria-labelledby="senaste">
          <h2 id="senaste" className="t-rubrik-3">{t("dashboard.recent")}</h2>
          {events.isLoading ? <Skeleton /> : (
            <ol className="mid-historik">
              {(events.data ?? []).map((e) => (
                <li key={e.seq}>
                  <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
                  <p>
                    {i18n.exists(`events.${e.type}`) ? t(`events.${e.type}`, { actor: e.actor_name ?? org.name, payload: e.payload }) : e.type}
                    {e.reg_number && <> · <Link to={path(`machines/${e.machine_id}`)}><RegNumber value={e.reg_number} /></Link></>}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
