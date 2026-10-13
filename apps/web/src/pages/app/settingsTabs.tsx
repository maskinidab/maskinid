import type { ComponentType } from "react";
import type { OrgType } from "../../lib/api/types";
import { DepartmentSettings, GroupSettings } from "./org/GroupSettings";
import { ApiSettings } from "./settings/ApiSettings";
import { BillingSettings } from "./settings/BillingSettings";
import { DataExportSettings } from "./settings/DataExportSettings";
import { FinancierSettings } from "./settings/FinancierSettings";
import { IntegrationsSettings } from "./settings/IntegrationsSettings";

/** Extra settings tabs registered by later steps (API keys, webhooks, label orders, billing). */
export function settingsTabs({ isAdmin, has, pricing = true }: { isAdmin: boolean; has(t: OrgType): boolean; pricing?: boolean }): { id: string; label: string; Component: ComponentType }[] {
  return isAdmin ? [
    // A lender fills in its own details once, and they follow every financing it is named in.
    ...(has("financier") ? [{ id: "financier", label: "settings.tab_financier", Component: FinancierSettings }] : []),
    { id: "api", label: "settings.tab_api", Component: ApiSettings },
    { id: "group", label: "settings.tab_group", Component: GroupSettings },
    { id: "departments", label: "settings.tab_departments", Component: DepartmentSettings },
    // Hidden while FEATURE_PRICING is off: the tab is nothing but prices, plans and invoices (ADR 0033).
    ...(pricing ? [{ id: "billing", label: "settings.tab_billing", Component: BillingSettings }] : []),
    { id: "integrations", label: "settings.tab_integrations", Component: IntegrationsSettings },
    { id: "data", label: "settings.tab_data", Component: DataExportSettings },
  ] : [];
}
