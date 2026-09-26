import { useTranslation } from "react-i18next";
import type { HistoryEvent } from "../lib/api/types";
import { formatDateTime } from "../lib/format";
import { Icon, type IconName } from "./Icon";

const CATEGORY_ICON: Record<string, IconName> = {
  machine: "maskin", encumbrance: "hanglas", transfer: "byt", flag: "flagga", label: "qr", document: "dokument",
  verification: "sigill", conflict: "varning", ownership: "byt", share_link: "lank", correction: "skold",
};

/** History as a timeline with icons and plain verbs ("Demo Bank Finans registrerade förbehåll"), newest first. */
export function Timeline({ events, onLoadMore, hasMore }: { events: HistoryEvent[]; onLoadMore?: () => void; hasMore?: boolean }) {
  const { t, i18n } = useTranslation();
  if (!events.length) return <p className="t-sekundar">{t("components.timeline.empty")}</p>;
  return (
    <>
      <ol className="tidslinje">
        {events.map((e) => {
          const actor = e.actor_org?.name ?? (e.actor_type === "api" ? t("events.api") : t("events.system"));
          const key = `events.${e.type}`;
          const text = i18n.exists(key) ? t(key, { actor, payload: e.payload }) : t("events.fallback");
          const city = (e.payload?.location as { city?: string } | undefined)?.city;
          return (
            <li key={e.seq} className={`tidslinje-${e.category}`}>
              <Icon name={CATEGORY_ICON[e.category] ?? "info"} />
              <div>
                <p>{text}{city ? ` – ${city}` : ""}</p>
                <small>
                  <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
                  {e.actor_name && ` · ${e.actor_name}`}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore && onLoadMore && (
        <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={onLoadMore}>{t("components.timeline.load_more")}</button>
      )}
    </>
  );
}
