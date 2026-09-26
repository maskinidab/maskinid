import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../auth/OrgContext";
import { backend } from "../lib/backend";
import { formatReg } from "../lib/format";
import { Icon } from "./Icon";

export interface IdentifierCheck {
  exists: boolean;
  reg_number?: string;
  is_mine?: boolean;
  machine_id?: string | null;
  oem?: { make: string; model: string; year: number | null; [k: string]: unknown } | null;
}

/**
 * Serial/PIN input with live duplicate check against the register (SPEC §6.2): a hit shows
 * "Den här maskinen finns redan (regnr XXX-XXXX). Är det din? [Begär ägarbyte] [Rapportera fel]". No duplicate is created.
 */
export function SerialInput({ id, type = "serial", value, onChange, onCheck, invalid, describedBy }: {
  id?: string; type?: "serial" | "pin" | "vin"; value: string; onChange(v: string): void; onCheck?(c: IdentifierCheck | null): void;
  invalid?: boolean; describedBy?: string;
}) {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const [state, setState] = useState<{ checking: boolean; result: IdentifierCheck | null }>({ checking: false, result: null });

  useEffect(() => {
    const v = value.trim();
    if (v.replace(/[\s-]/g, "").length < 4) {
      setState({ checking: false, result: null });
      onCheck?.(null);
      return;
    }
    setState((s) => ({ ...s, checking: true }));
    const h = setTimeout(async () => {
      try {
        const r = await backend.rpc<IdentifierCheck>("check_identifier", { p_org_id: orgId, p_type: type, p_value: v });
        setState({ checking: false, result: r });
        onCheck?.(r);
      } catch {
        setState({ checking: false, result: null });
      }
    }, 350);
    return () => clearTimeout(h);
    // onCheck is a callback prop; re-running on its identity would loop.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [value, type, orgId]);

  const r = state.result;
  return (
    <div className="stack-2">
      <input id={id} className="mid-input is-id" value={value} onChange={(e) => onChange(e.target.value)} autoCapitalize="characters"
        spellCheck={false} autoComplete="off" aria-invalid={invalid || r?.exists ? true : undefined} aria-describedby={describedBy} />
      <div aria-live="polite" className="serie-status">
        {state.checking && <span className="mid-laddar">{t("components.serial.checking")}</span>}
        {!state.checking && r && !r.exists && (
          <span className="t-liten t-sekundar"><Icon name="bock" className="ikon-inline" /> {t("components.serial.free")}
            {r.oem && <> · <strong>{t("components.serial.oem", { make: r.oem.make, model: r.oem.model, year: r.oem.year ?? "" })}</strong></>}
          </span>
        )}
        {!state.checking && r?.exists && (r.is_mine ? (
          <p className="mid-fel"><Icon name="info" />{t("components.serial.exists_mine", { reg: formatReg(r.reg_number) })}{" "}
            {r.machine_id && <Link to={path(`machines/${r.machine_id}`)}>{t("common.open")}</Link>}</p>
        ) : (
          <div className="mid-fel stack-2" role="alert">
            <span><Icon name="varning" />{t("components.serial.exists_other", { reg: formatReg(r.reg_number) })}</span>
            <span className="mid-rad">
              <Link className="mid-knapp mid-knapp-kontur mid-knapp-liten" to={path(`transfer-request?reg=${r.reg_number}`)}>{t("components.serial.request_transfer")}</Link>
              <Link className="mid-knapp mid-knapp-kontur mid-knapp-liten" to={path(`report-error?reg=${r.reg_number}`)}>{t("components.serial.report_error")}</Link>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
