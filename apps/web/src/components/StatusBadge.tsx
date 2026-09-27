import { useTranslation } from "react-i18next";
import type { Level, MachineStatus } from "../lib/api/types";
import { Icon, type IconName } from "./Icon";

/** Status marking – always word plus icon, never colour alone, never yellow (graphic profile). */
export type StatusKind = "verifierad" | "belanad" | "sparr" | "neutral" | "vantar";

const ICON: Record<StatusKind, IconName> = { verifierad: "bock", belanad: "hanglas", sparr: "varning", neutral: "info", vantar: "tid" };

export function StatusBadge({ kind, children, icon, title }: { kind: StatusKind; children: string; icon?: IconName; title?: string }) {
  return (
    <span className={`mid-status mid-status-${kind}`} title={title}>
      <Icon name={icon ?? ICON[kind]} />
      {children}
    </span>
  );
}

const STATUS_KIND: Record<MachineStatus, StatusKind> = {
  active: "verifierad", stolen: "sparr", blocked: "sparr", disputed: "sparr", scrapped: "neutral", exported: "neutral",
  deregistered: "neutral", draft: "vantar",
};

export function MachineStatusBadge({ status }: { status: MachineStatus }) {
  const { t } = useTranslation();
  return <StatusBadge kind={STATUS_KIND[status]} icon={status === "active" ? "bock" : undefined}>{t(`enum.machine_status.${status}`)}</StatusBadge>;
}

/** Verification level 0/1/2 (SPEC §3.1) with its explanation as tooltip and accessible description. */
export function VerificationBadge({ level, minTrusted = 0 }: { level: Level; minTrusted?: number }) {
  const { t } = useTranslation();
  const kind: StatusKind = level === 2 ? "verifierad" : level === 1 ? "verifierad" : "vantar";
  const below = level < minTrusted;
  return (
    <span className="badge-rad">
      <span className={`mid-status mid-status-${kind} niva-${level}`} title={t(`level.${level}.desc`)}>
        <Icon name={level === 2 ? "sigill" : level === 1 ? "dokument" : "info"} />
        {t(`level.${level}.name`)}
        <span className="visually-hidden"> – {t(`level.${level}.desc`)}</span>
      </span>
      {below && <StatusBadge kind="sparr">{t("level.below_trusted", { level: t(`level.${minTrusted}.name`) })}</StatusBadge>}
    </span>
  );
}

export function FinancingBadge({ hasActive }: { hasActive: boolean }) {
  const { t } = useTranslation();
  return hasActive ? <StatusBadge kind="belanad">{t("components.financing.yes")}</StatusBadge>
    : <StatusBadge kind="neutral" icon="bock">{t("components.financing.no")}</StatusBadge>;
}
