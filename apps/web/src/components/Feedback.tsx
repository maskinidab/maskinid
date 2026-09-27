import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/backend";
import { Icon, type IconName } from "./Icon";

/** Message after an action – confirmation or error. Says what happened and what to do. */
export function Notice({ kind = "info", title, children }: { kind?: "ok" | "fel" | "info"; title: string; children?: ReactNode }) {
  const icon = kind === "ok" ? "bock" : kind === "fel" ? "varning" : "info";
  return (
    <div className={`mid-besked ${kind === "ok" ? "mid-besked-ok" : kind === "fel" ? "mid-besked-fel" : ""}`} role={kind === "fel" ? "alert" : "status"}>
      <Icon name={icon} />
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

/** Translates backend error codes (errors.<CODE>) with their details as interpolation values. */
export function useErrorMessage() {
  const { t, i18n } = useTranslation();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      const key = `errors.${e.code}`;
      const detail = (e.detail && typeof e.detail === "object" ? e.detail : {}) as Record<string, unknown>;
      return i18n.exists(key) ? t(key, detail) : t("errors.UNKNOWN");
    }
    if (e instanceof TypeError) return t("errors.NETWORK");
    return t("errors.UNKNOWN");
  };
}

export function ErrorNotice({ error, title }: { error: unknown; title?: string }) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  if (!error) return null;
  return (
    <Notice kind="fel" title={title ?? msg(error)}>
      {title && <p className="t-liten">{msg(error)}</p>}
      {!title && error instanceof ApiError && error.code === "UNKNOWN" && <p className="t-liten t-sekundar">{t("common.retry")}</p>}
    </Notice>
  );
}

/** Loading placeholders (SPEC §10: skeletons, never spinners in content). */
export function Skeleton({ lines = 3, height = 16 }: { lines?: number; height?: number }) {
  const { t } = useTranslation();
  return (
    <div className="skelett" role="status" aria-label={t("components.loading_skeleton")}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} style={{ height, width: `${100 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

/** Empty states always offer a primary action (SPEC §10). */
export function EmptyState({ icon = "info", title, body, action }: {
  icon?: IconName; title: string; body?: string; action?: { label: string; to?: string; onClick?: () => void };
}) {
  return (
    <div className="tomt stack-3">
      <Icon name={icon} className="tomt-ikon" />
      <h3 className="t-rubrik-4">{title}</h3>
      {body && <p className="t-brodtext t-sekundar">{body}</p>}
      {action && (action.to
        ? <Link className="mid-knapp mid-knapp-primar" to={action.to}>{action.label}</Link>
        : <button type="button" className="mid-knapp mid-knapp-primar" onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}

export function PageHeader({ title, lead, actions, crumbs }: {
  title: string; lead?: string; actions?: ReactNode; crumbs?: { label: string; to?: string }[];
}) {
  return (
    <header className="sidrubrik">
      {crumbs && (
        <nav className="brodsmulor" aria-label="breadcrumbs">
          {crumbs.map((c, i) => (
            <span key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}{i < crumbs.length - 1 && " / "}</span>
          ))}
        </nav>
      )}
      <div className="sidrubrik-rad">
        <div className="stack-2">
          <h1 className="t-rubrik-2">{title}</h1>
          {lead && <p className="t-brodtext t-sekundar">{lead}</p>}
        </div>
        {actions && <div className="mid-rad">{actions}</div>}
      </div>
    </header>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label, panels = false }: {
  tabs: { id: T; label: string; count?: number }[]; value: T; onChange(v: T): void; label: string;
  /** The page renders `<div role="tabpanel" id="panel-{value}">` for the selected tab: link the tab to it. */
  panels?: boolean;
}) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, to: number) => {
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length]!.id;
    onChange(next);
    (e.currentTarget.parentElement?.querySelector(`#flik-${CSS.escape(next)}`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="flikar" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" id={`flik-${tab.id}`} aria-selected={tab.id === value}
          aria-controls={panels && tab.id === value ? `panel-${tab.id}` : undefined} tabIndex={tab.id === value ? 0 : -1}
          className={tab.id === value ? "flik is-vald" : "flik"} onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === value);
            if (e.key === "ArrowRight") move(e, i + 1);
            if (e.key === "ArrowLeft") move(e, i - 1);
            if (e.key === "Home") move(e, 0);
            if (e.key === "End") move(e, tabs.length - 1);
          }}>
          {tab.label}{typeof tab.count === "number" && <span className="flik-antal">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
