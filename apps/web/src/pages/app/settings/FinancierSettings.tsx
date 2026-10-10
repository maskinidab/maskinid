import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { ErrorNotice, Notice } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { queryClient, rpc, useRpc } from "../../../lib/api/query";

interface Defaults {
  contract_ref_prefix?: string;
  default_type?: string;
  default_term_months?: number;
  contact_email?: string;
  contact_phone?: string;
  payoff_instructions?: string;
}

const TYPES = ["ownership_reservation", "leasing", "rental", "other"];

/**
 * A lender's own details, so they follow the financing automatically (SPEC §7.4).
 *
 * When a dealer picks this lender, FinancierPicker reads these through get_financier_profile and pre-fills the
 * agreement: the bank is named once, here, instead of in every sale. The payoff instructions are shown to
 * whoever asks for a payoff, which is the fastest way to tell a dealer where to send the paperwork.
 */
export function FinancierSettings() {
  const { t } = useTranslation();
  const { orgId, isAdmin } = useOrg();
  const q = useRpc<{ financing_defaults?: Defaults }>("get_financier_profile", { p_org_id: orgId });
  const [d, setD] = useState<Defaults | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const v = d ?? q.data?.financing_defaults ?? {};
  const set = <K extends keyof Defaults>(k: K, value: Defaults[K]) => { setD({ ...v, [k]: value }); setSaved(false); };

  return (
    <form className="panel stack-4" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      try {
        await rpc("update_org", { p_org_id: orgId, p_patch: { settings: { financing_defaults: v } } });
        await queryClient.invalidateQueries({ queryKey: ["rpc"] });
        setSaved(true);
      } catch (err) {
        setError(err);
      }
    }}>
      <h2 className="t-rubrik-4">{t("financier.defaults.title")}</h2>
      <p className="t-liten t-sekundar">{t("financier.defaults.lead")}</p>
      <div className="rutnat">
        <FormField className="kol-6" label={t("financier.defaults.contract_ref_prefix")} optional hint={t("financier.defaults.contract_ref_prefix_hint")}>
          <input className="mid-input is-id" value={v.contract_ref_prefix ?? ""} onChange={(e) => set("contract_ref_prefix", e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("financier.defaults.default_type")} optional>
          <select className="mid-select" value={v.default_type ?? ""} onChange={(e) => set("default_type", e.target.value)}>
            <option value="">{t("common.select")}</option>
            {TYPES.map((x) => <option key={x} value={x}>{t(`enum.encumbrance_type.${x}`)}</option>)}
          </select>
        </FormField>
        <FormField className="kol-6" label={t("financier.defaults.default_term_months")} optional>
          <input className="mid-input" type="number" min={1} max={240} value={v.default_term_months ?? ""}
            onChange={(e) => set("default_term_months", e.target.value ? Number(e.target.value) : undefined)} />
        </FormField>
        <FormField className="kol-6" label={t("financier.defaults.contact_email")} optional>
          <input className="mid-input" type="email" value={v.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} />
        </FormField>
        <FormField className="kol-6" label={t("financier.defaults.contact_phone")} optional>
          <input className="mid-input" value={v.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} />
        </FormField>
      </div>
      <FormField label={t("financier.defaults.payoff_instructions")} optional hint={t("financier.defaults.payoff_instructions_hint")}>
        <textarea className="mid-textarea" rows={3} value={v.payoff_instructions ?? ""} onChange={(e) => set("payoff_instructions", e.target.value)} />
      </FormField>
      {!!error && <ErrorNotice error={error} />}
      {saved && <Notice kind="ok" title={t("common.saved")} />}
      <div className="mid-rad">
        <button type="submit" className="mid-knapp mid-knapp-primar" disabled={!isAdmin}>{t("common.save")}</button>
      </div>
    </form>
  );
}
