import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { Icon } from "../../../components/Icon";
import { useRpc } from "../../../lib/api/query";
import { formatDateTime } from "../../../lib/format";

/**
 * Last position reported by telematics (step 25). Only the latest point is stored; owner and user see it, an authority
 * only while the machine is stolen. The map opens in OpenStreetMap – no third-party map is loaded on our page.
 */
export function PositionBox({ machineId, stolen }: { machineId: string; stolen: boolean }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const q = useRpc<{ lat: number; lon: number; reported_at: string; provider: string | null } | null>("get_machine_position",
    { p_org_id: orgId, p_machine_id: machineId }, { retry: false });
  if (!q.data) return null;
  const p = q.data;
  const osm = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=15/${p.lat}/${p.lon}`;
  return (
    <section className={`panel stack-2${stolen ? " panel-fara" : ""}`} aria-labelledby="position">
      <h2 id="position" className="t-rubrik-4"><Icon name="plats" className="ikon-inline" /> {t("position.title")}</h2>
      <p className="mid-id">{p.lat.toFixed(4)}, {p.lon.toFixed(4)}</p>
      <p className="t-liten t-sekundar">{t("position.reported", { at: formatDateTime(p.reported_at), provider: p.provider ? t(`integrations.provider.${p.provider}`) : "–" })}</p>
      <p><a className="mid-lank" href={osm} target="_blank" rel="noreferrer">{t("position.open_map")} <Icon name="extern" className="ikon-inline" /></a></p>
      {stolen && <p className="t-liten">{t("position.stolen_hint")}</p>}
    </section>
  );
}
