import { Icon } from "./Icon";

/** Statusmärkning – alltid ord plus ikon, aldrig färg ensam. Aldrig gul. */
export type StatusKind = "verifierad" | "belanad" | "sparr";

const ICON = { verifierad: "bock", belanad: "hanglas", sparr: "varning" } as const;

export function StatusBadge({ kind, children }: { kind: StatusKind; children: string }) {
  return (
    <span className={`mid-status mid-status-${kind}`}>
      <Icon name={ICON[kind]} />
      {children}
    </span>
  );
}
