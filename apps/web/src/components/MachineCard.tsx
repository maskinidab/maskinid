import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { MachineListItem } from "../lib/api/types";
import { formatNumber } from "../lib/format";
import { MachinePhoto } from "./MachinePhoto";
import { RegNumber } from "./RegNumber";
import { FinancingBadge, MachineStatusBadge, VerificationBadge } from "./StatusBadge";

export function MachineCard({ m, to, minTrusted = 0 }: { m: MachineListItem; to: string; minTrusted?: number }) {
  const { t } = useTranslation();
  return (
    <Link to={to} className="maskinkort">
      <MachinePhoto path={m.primary_photo_path} category={m.category} size={72} />
      <div className="maskinkort-text">
        <RegNumber value={m.reg_number} />
        <strong>{m.make} {m.model}{m.year ? ` · ${m.year}` : ""}</strong>
        <span className="t-liten t-sekundar">
          {t(`enum.category.${m.category}`)}{m.hour_meter !== null && ` · ${t("common.hours", { count: formatNumber(m.hour_meter) as unknown as number })}`}
        </span>
        <span className="badge-rad">
          {m.status !== "active" && <MachineStatusBadge status={m.status} />}
          <VerificationBadge level={m.verification_level} minTrusted={minTrusted} />
          {m.has_active_financing && <FinancingBadge hasActive />}
        </span>
      </div>
    </Link>
  );
}
