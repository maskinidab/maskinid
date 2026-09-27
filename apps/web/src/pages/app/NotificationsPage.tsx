import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useOrg } from "../../auth/OrgContext";
import { EmptyState, PageHeader, Skeleton } from "../../components/Feedback";
import { Icon } from "../../components/Icon";
import { useRpc, useRpcMutation } from "../../lib/api/query";
import type { NotificationItem } from "../../lib/api/types";
import { formatDateTime } from "../../lib/format";

export function useNotificationText() {
  const { t, i18n } = useTranslation();
  return (n: NotificationItem) => {
    const base = `notifications.${n.type}`;
    const known = i18n.exists(`${base}.title`);
    const vars = { ...n.data, type: n.data.type ? t(`enum.flag_type.${n.data.type as string}`, { defaultValue: String(n.data.type) }) : undefined };
    return {
      title: n.title ?? (known ? t(`${base}.title`, vars) : t("notifications.fallback.title")),
      body: n.body ?? (known ? t(`${base}.body`, vars) : ""),
    };
  };
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const { path } = useOrg();
  const { refresh } = useAuth();
  const q = useRpc<NotificationItem[]>("list_notifications", { p_limit: 100 }, { refetchInterval: 15_000 });
  const mark = useRpcMutation<{ p_ids?: string[] | null }>("mark_notifications_read", { raw: true, onSuccess: () => void refresh() });
  const text = useNotificationText();
  const toLink = (link: string | null) => (link && link.startsWith("/") && !link.startsWith("/admin") ? path(link) : link ?? undefined);
  return (
    <div className="stack-5">
      <PageHeader title={t("nav.notifications")} actions={
        <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => mark.mutate({ p_ids: null })}>{t("notifications.mark_all_read")}</button>
      } />
      {q.isLoading ? <Skeleton lines={5} /> : !q.data?.length ? <EmptyState icon="klocka" title={t("notifications.empty")} action={{ label: t("nav.dashboard"), to: path("dashboard") }} /> : (
        <ul className="notiser">
          {q.data.map((n) => {
            const x = text(n);
            const to = toLink(n.link);
            return (
              <li key={n.id} className={`notis notis-${n.severity}${n.read_at ? "" : " is-olast"}`}>
                <Icon name={n.severity === "critical" ? "varning" : n.severity === "warning" ? "info" : "klocka"} />
                <div>
                  <strong>{x.title}</strong>
                  {x.body && <p>{x.body}</p>}
                  <small>{formatDateTime(n.created_at)}</small>
                </div>
                {to && <Link className="mid-knapp mid-knapp-kontur mid-knapp-liten" to={to} onClick={() => !n.read_at && mark.mutate({ p_ids: [n.id] })}>{t("common.open")}</Link>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
