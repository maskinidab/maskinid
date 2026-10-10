import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CompanyLookupField, type CompanyInfo, type ExistingOrg } from "./CompanyLookupField";
import { FormField } from "./FormField";
import { rpc, useRpc } from "../lib/api/query";
import type { OrgBrief } from "../lib/api/types";
import { StatusBadge } from "./StatusBadge";

/** Either a lender we already know, or one named by organisation number (which may not use MaskinID yet). */
export interface PickedFinancier {
  holder_org_id: string | null;
  holder_org_number: string | null;
  holder_name: string | null;
  /** True when the named organisation has no active members, i.e. the financing waits for them to claim it. */
  unclaimed: boolean;
  name: string;
}

export interface FinancierProfile extends OrgBrief {
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  claimable?: boolean;
  financing_defaults?: {
    contract_ref_prefix?: string;
    default_type?: string;
    default_term_months?: number;
    contact_email?: string;
    contact_phone?: string;
    payoff_instructions?: string;
  };
}

const OTHER = "__other__";

/**
 * Picks the lender for a financing.
 *
 * Approved lenders come from list_partner_orgs. Unclaimed placeholder organisations are deliberately NOT in that
 * list — a dropdown of unverified banks would be a phishing surface — so naming a bank outside MaskinID goes
 * through its organisation number instead (ADR 0027). Picking a known lender also pulls in that bank's own
 * defaults, so the right details follow the financing automatically.
 */
export function FinancierPicker({ value, onChange, onProfile, error, label }: {
  value: PickedFinancier | null;
  onChange(v: PickedFinancier | null): void;
  onProfile?(p: FinancierProfile | null): void;
  error?: string | null;
  label?: string;
}) {
  const { t } = useTranslation();

  const financiers = useRpc<OrgBrief[]>("list_partner_orgs", { p_type: "financier" });
  // The caller may set the lender without the user touching the control — reading a bank order resolves it
  // (AttachFinancingDialog). So the control's state is *derived* from `value`, and only overridden once the user
  // picks something. Otherwise the dropdown keeps reading "Välj" while a bank is in fact selected, and the
  // "does not use MaskinID yet" badge never appears.
  const [picked, setPicked] = useState<string | null>(null);
  const [typedOrgNr, setTypedOrgNr] = useState<string | null>(null);
  const mode = picked ?? value?.holder_org_id ?? (value?.holder_org_number ? OTHER : "");
  const orgNr = typedOrgNr ?? value?.holder_org_number ?? "";
  const [profile, setProfile] = useState<FinancierProfile | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const setMode = setPicked;
  const setOrgNr = setTypedOrgNr;

  async function pickKnown(id: string) {
    setMode(id);
    setProfile(null);
    if (!id || id === OTHER) {
      onChange(null);
      onProfile?.(null);
      return;
    }
    const name = (financiers.data ?? []).find((o) => o.id === id)?.name ?? "";
    onChange({ holder_org_id: id, holder_org_number: null, holder_name: null, unclaimed: false, name });
    try {
      const p = await rpc<FinancierProfile>("get_financier_profile", { p_org_id: id });
      setProfile(p);
      onProfile?.(p);
    } catch {
      // The profile is a convenience: a lender without one is still perfectly selectable.
      onProfile?.(null);
    }
  }

  function pickByNumber(c: CompanyInfo | null) {
    setLookupError(null);
    if (!c) {
      onChange(null);
      return;
    }
    const existing: ExistingOrg | null = c.existing_org;
    // An existing organisation that is not a lender cannot hold a financing; say so before the RPC does.
    if (existing && !existing.types?.includes("financier") && existing.claimable === false) {
      setLookupError(t("errors.FINANCIER_NOT_ELIGIBLE"));
      onChange(null);
      return;
    }
    onChange({
      holder_org_id: existing && existing.types?.includes("financier") && existing.claimable === false ? existing.id : null,
      holder_org_number: c.org_number,
      holder_name: c.name,
      unclaimed: !existing || existing.claimable !== false,
      name: c.name,
    });
  }

  const defaults = profile?.financing_defaults;
  const contact = defaults?.contact_email ?? profile?.email ?? defaults?.contact_phone ?? profile?.phone;
  return (
    <div className="stack-3">
      <FormField label={label ?? t("financier.picker.label")} error={error ?? lookupError}>
        <select className="mid-select" value={mode} onChange={(e) => void pickKnown(e.target.value)}>
          <option value="">{t("common.select")}</option>
          {(financiers.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value={OTHER}>{t("financier.picker.other")}</option>
        </select>
      </FormField>
      {mode === OTHER && (
        <div className="stack-2">
          <CompanyLookupField value={orgNr} onChange={setOrgNr} onFound={pickByNumber} label={t("common.org_number")} />
          <p className="mid-hjalp">{t("financier.picker.other_hint")}</p>
          {value?.name && <p className="t-liten"><strong>{value.name}</strong></p>}
          {value?.unclaimed && value.name && (
            <StatusBadge kind="vantar">{t("financier.picker.not_connected")}</StatusBadge>
          )}
        </div>
      )}
      {contact && <p className="t-liten t-sekundar">{t("financier.picker.contact", { contact })}</p>}
      {defaults?.payoff_instructions && <p className="t-liten t-sekundar">{defaults.payoff_instructions}</p>}
    </div>
  );
}
