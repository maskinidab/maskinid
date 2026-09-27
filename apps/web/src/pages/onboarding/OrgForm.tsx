import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CompanyLookupField, type CompanyInfo } from "../../components/CompanyLookupField";
import { ErrorNotice, Notice } from "../../components/Feedback";
import type { OrgBrief, OrgType } from "../../lib/api/types";
import { backend } from "../../lib/backend";

export const DPA_VERSION = "2026-09";
const TYPES: OrgType[] = ["owner", "dealer", "financier", "insurer", "authority", "inspector", "marketplace", "manufacturer", "client"];

/** "Skapa organisation" (SPEC §6.1 step 2–3): org number lookup, type(s), DPA acceptance. */
export function OrgForm({ initialTypes = ["owner"], onCreated }: { initialTypes?: OrgType[]; onCreated(org: OrgBrief): void }) {
  const { t } = useTranslation();
  const [orgNumber, setOrgNumber] = useState("");
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [types, setTypes] = useState<OrgType[]>(initialTypes);
  const [dpa, setDpa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [requested, setRequested] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const org = await backend.rpc<OrgBrief>("create_org", {
        p_org_number: company?.org_number === "19XXXXXX-XXXX" ? orgNumber : company?.org_number ?? orgNumber,
        p_types: types, p_accept_dpa_version: dpa ? DPA_VERSION : null,
      });
      onCreated(org);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-5 formular">
      {!!error && <ErrorNotice error={error} />}
      <div className="mid-faltgrupp">
        <label className="mid-etikett" htmlFor="orgnr">{t("common.org_number")}</label>
        <CompanyLookupField id="orgnr" value={orgNumber} onChange={setOrgNumber} onFound={setCompany} />
      </div>
      {company?.is_sole_trader && <Notice title={t("onboarding.sole_trader")} />}
      {company?.existing_org ? (
        <Notice title={t("onboarding.existing", { name: company.existing_org.name })}>
          {requested ? <p className="t-liten">{t("onboarding.access_requested")}</p> : (
            <button type="button" className="mid-knapp mid-knapp-kontur mid-knapp-liten" onClick={async () => {
              await backend.rpc("request_membership", { p_org_id: company.existing_org!.id });
              setRequested(true);
            }}>{t("onboarding.request_access")}</button>
          )}
        </Notice>
      ) : (
        <>
          <fieldset className="stack-3">
            <legend className="mid-etikett">{t("onboarding.types_legend")}</legend>
            <p className="mid-hjalp">{t("onboarding.types_hint")}</p>
            <div className="mid-val">
              {TYPES.map((ty) => (
                <label key={ty}>
                  <input type="checkbox" checked={types.includes(ty)} onChange={(e) => setTypes((s) => e.target.checked ? [...s, ty] : s.filter((x) => x !== ty))} />
                  <span>{t(`enum.org_type.${ty}`)}<small>{t(`enum.org_type_desc.${ty}`)}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="kryss">
            <input type="checkbox" checked={dpa} onChange={(e) => setDpa(e.target.checked)} />
            <span>{t("onboarding.dpa_label", { version: DPA_VERSION })} <Link className="mid-lank" to="/legal/dpa" target="_blank">{t("onboarding.dpa_link")}</Link></span>
          </label>
          <button type="button" className="mid-knapp mid-knapp-primar" disabled={!company || !types.length || !dpa || busy} onClick={() => void create()}>
            {t("onboarding.create")}
          </button>
        </>
      )}
    </div>
  );
}
