/**
 * Inställningar → Moduler (ADR 0031).
 *
 * The four fleet modules are off for a dealer by default, because the product owner asked for Daglig kontroll,
 * Uthyrning, Bränsle & klimat and Förare to be out of the dealer view — "men funktionen ska fortfarande finnas
 * kvar i systemet så att vi kan aktivera den för de handlare som vill ha eller behöver den framöver".
 *
 * This is where that activation happens. A module is a view simplification rather than a security boundary, so
 * the organisation's own admin can switch one on; the operator can also do it from the admin view. Writes are
 * refused server-side while a module is off, so turning it off is not merely cosmetic.
 */
import { useTranslation } from "react-i18next";
import { useOrg } from "../../../auth/OrgContext";
import { ErrorNotice, Notice } from "../../../components/Feedback";
import { MODULES, type ModuleName } from "../../../layouts/nav";
import { useRpcMutation } from "../../../lib/api/query";

export function ModuleSettings() {
  const { t } = useTranslation();
  const { orgId, moduleOn, has, isAdmin } = useOrg();
  const save = useRpcMutation<{ p_org_id: string; p_patch: Record<string, unknown> }>("update_org");
  return (
    <section className="stack-4">
      <p className="t-brodtext">{t("org.modules_lead")}</p>
      {has("dealer") && <Notice kind="info" title={t("org.modules_dealer_note")} />}
      <ul className="radlista">
        {MODULES.map((m: ModuleName) => (
          <li key={m}>
            <span><strong>{t(`org.module.${m}`)}</strong></span>
            <label className="mid-kryss">
              <input type="checkbox" role="switch" checked={moduleOn(m)} disabled={!isAdmin || save.isPending}
                onChange={(e) => save.mutate({ p_org_id: orgId, p_patch: { settings: { modules: { [m]: e.target.checked } } } })} />
              {moduleOn(m) ? t("admin.market.on") : t("admin.market.off")}
            </label>
          </li>
        ))}
      </ul>
      {save.error && <ErrorNotice error={save.error} />}
    </section>
  );
}
