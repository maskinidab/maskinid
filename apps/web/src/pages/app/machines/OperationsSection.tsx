import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useOrg } from "../../../auth/OrgContext";
import { Dialog } from "../../../components/Dialog";
import { ErrorNotice, Notice } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { Icon } from "../../../components/Icon";
import { useRpc, useRpcMutation } from "../../../lib/api/query";
import type { MachineView } from "../../../lib/api/types";
import { formatDate, formatDateTime, formatNumber } from "../../../lib/format";
import { FuelDialog } from "../fleet/ClimatePage";
import { CheckDialog, CheckResultBadge, type DailyCheck } from "../fleet/DailyCheckPage";

export interface Operational { status: "operational" | "restricted" | "out_of_service"; reason: string | null; at: string | null }

/** Operational status notice for the machine header (owner/user only; SPEC step 20). */
export function OperationalNotice({ m }: { m: MachineView }) {
  const { t } = useTranslation();
  const op = m.operational as Operational | undefined;
  if (!op || op.status === "operational") return null;
  return (
    <Notice kind={op.status === "out_of_service" ? "fel" : "info"} title={t(`operations.status.${op.status}`)}>
      {op.reason && <p className="t-liten">{op.reason}{op.at ? ` · ${formatDateTime(op.at)}` : ""}</p>}
    </Notice>
  );
}

/** Service tab section: daily checks, fuel, attachments, operator and the operational status switch. */
export function OperationsSection({ m, write }: { m: MachineView; write: boolean }) {
  const { t } = useTranslation();
  const { orgId, path } = useOrg();
  const checks = useRpc<DailyCheck[]>("list_daily_checks", { p_org_id: orgId, p_machine_id: m.id, p_limit: 5 });
  const fuel = useRpc<{ id: string; entry_date: string; fuel: string; quantity: number; unit: string }[]>("list_fuel", { p_org_id: orgId, p_machine_id: m.id, p_limit: 5 });
  const [dialog, setDialog] = useState<"fuel" | "status" | null>(null);
  const [open, setOpen] = useState<DailyCheck | null>(null);
  const op = m.operational as Operational | undefined;
  const attachments = (m.attachments as { id: string; type: string; make: string | null; model: string | null }[] | undefined) ?? [];
  const operator = m.operator as { name: string } | undefined;
  return (
    <section className="panel stack-4" aria-labelledby="drift">
      <div className="mid-rad mid-rad-mellan">
        <h2 id="drift" className="t-rubrik-4">{t("operations.title")}</h2>
        {op && <span className="t-liten">{t(`operations.status.${op.status}`)}</span>}
      </div>
      {write && (
        <div className="mid-rad">
          <Link className="mid-knapp mid-knapp-primar mid-knapp-liten" to={path(`daily-check?machine=${m.id}`)}><Icon name="bock" />{t("nav.daily_check")}</Link>
          <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={() => setDialog("fuel")}><Icon name="plus" />{t("climate.add_fuel")}</button>
          <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setDialog("status")}>{t("operations.change_status")}</button>
        </div>
      )}
      <dl className="faktarutnat">
        <div><dt>{t("operations.operator")}</dt><dd>{operator?.name ?? "–"}</dd></div>
        <div><dt>{t("nav.attachments")}</dt><dd>{attachments.length
          ? attachments.map((a) => [t(`equipment.attachment_type.${a.type}`), a.make, a.model].filter(Boolean).join(" ")).join(", ") : "–"}</dd></div>
      </dl>
      <div className="stack-2">
        <h3 className="mid-etikett">{t("operations.recent_checks")}</h3>
        {checks.data?.length ? (
          <ul className="radlista">{checks.data.map((c) => (
            <li key={c.id}><span>{formatDateTime(c.created_at)} · {c.operator ?? c.by ?? ""}</span>
              <span className="mid-rad"><CheckResultBadge result={c.result} />
                <button type="button" className="mid-knapp mid-knapp-text mid-knapp-liten" onClick={() => setOpen(c)}>{t("common.view")}</button></span></li>
          ))}</ul>
        ) : <p className="t-liten t-sekundar">{t("daily.none")}</p>}
      </div>
      <div className="stack-2">
        <h3 className="mid-etikett">{t("operations.recent_fuel")}</h3>
        {fuel.data?.length ? (
          <ul className="radlista">{fuel.data.map((f) => (
            <li key={f.id}><span>{formatDate(f.entry_date)} · {t(`climate.fuel.${f.fuel}`)}</span><span>{formatNumber(f.quantity)} {f.unit}</span></li>
          ))}</ul>
        ) : <p className="t-liten t-sekundar">{t("climate.no_fuel")}</p>}
      </div>
      {dialog === "fuel" && <FuelDialog machineId={m.id} onClose={() => setDialog(null)} />}
      {dialog === "status" && <StatusDialog m={m} current={op?.status ?? "operational"} onClose={() => setDialog(null)} />}
      {open && <CheckDialog c={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function StatusDialog({ m, current, onClose }: { m: MachineView; current: string; onClose(): void }) {
  const { t } = useTranslation();
  const { orgId } = useOrg();
  const [status, setStatus] = useState(current);
  const [reason, setReason] = useState("");
  const mut = useRpcMutation<{ p_org_id: string; p_machine_id: string; p_status: string; p_reason: string | null }>("set_operational_status", { onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={t("operations.change_status")}>
      <form className="stack-4" onSubmit={(e) => { e.preventDefault(); mut.mutate({ p_org_id: orgId, p_machine_id: m.id, p_status: status, p_reason: reason.trim() || null }); }}>
        <fieldset className="stack-2">
          <legend className="mid-etikett">{t("common.status")}</legend>
          {(["operational", "restricted", "out_of_service"] as const).map((s) => (
            <label key={s} className="mid-kryss"><input type="radio" name="op" checked={status === s} onChange={() => setStatus(s)} />{t(`operations.status.${s}`)}</label>
          ))}
        </fieldset>
        {status !== "operational" && <FormField label={t("admin.reason")}><input className="mid-input" value={reason} onChange={(e) => setReason(e.target.value)} required /></FormField>}
        {mut.error && <ErrorNotice error={mut.error} />}
        <div className="mid-rad">
          <button type="submit" className="mid-knapp mid-knapp-primar" disabled={mut.isPending}>{t("common.save")}</button>
          <button type="button" className="mid-knapp mid-knapp-text" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Dialog>
  );
}
