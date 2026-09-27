import { isValidOrgNumber, normalizeOrgNumber } from "@maskinid/shared/identifiers.ts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { backend } from "../lib/backend";
import type { OrgBrief } from "../lib/api/types";
import { useErrorMessage } from "./Feedback";
import { Icon } from "./Icon";

export interface CompanyInfo {
  name: string;
  city: string | null;
  org_number: string;
  is_sole_trader: boolean;
  source: string;
  existing_org: OrgBrief | null;
}

/** Org number → company name/address via CompanyLookup (Roaring/Bolagsverket, mock in DEMO_MODE). */
export function CompanyLookupField({ id, value, onChange, onFound, describedBy, label }: {
  id?: string; value: string; onChange(v: string): void; onFound(c: CompanyInfo | null): void; describedBy?: string; label?: string;
}) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<CompanyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    setError(null);
    setFound(null);
    onFound(null);
    if (!isValidOrgNumber(value)) {
      setError(t("components.company.invalid"));
      return;
    }
    setBusy(true);
    try {
      const n = normalizeOrgNumber(value)!;
      // Supabase outside DEMO_MODE: the Edge Function queries Roaring and caches; the RPC then reads the cache.
      if (backend.kind === "supabase") await backend.invoke("company-lookup", { org_number: n }).catch(() => undefined);
      const r = await backend.rpc<CompanyInfo>("lookup_company", { p_org_number: n });
      setFound(r);
      onFound(r);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-2">
      <div className="mid-sok-rad">
        <input id={id} className="mid-input is-id" value={value} inputMode="numeric" autoComplete="off" placeholder="NNNNNN-NNNN"
          aria-label={label} aria-describedby={describedBy} aria-invalid={error ? true : undefined}
          onChange={(e) => { onChange(e.target.value); setFound(null); onFound(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }} />
        <button type="button" className="mid-knapp mid-knapp-sekundar" onClick={() => void lookup()} disabled={busy}>
          {busy ? t("common.loading") : t("components.company.lookup")}
        </button>
      </div>
      <div aria-live="polite">
        {error && <p className="mid-fel"><Icon name="varning" />{error}</p>}
        {found && <p className="t-liten"><Icon name="bock" className="ikon-inline" /> <strong>{found.name}</strong>{found.city ? `, ${found.city}` : ""}</p>}
      </div>
    </div>
  );
}
