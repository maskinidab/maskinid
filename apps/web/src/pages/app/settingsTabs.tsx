import type { ComponentType } from "react";
import type { OrgType } from "../../lib/api/types";
import { DepartmentSettings, GroupSettings } from "./org/GroupSettings";
import { ApiSettings } from "./settings/ApiSettings";

/** Extra settings tabs registered by later steps (API keys, webhooks, label orders, billing). */
export function settingsTabs({ isAdmin }: { isAdmin: boolean; has(t: OrgType): boolean }): { id: string; label: string; Component: ComponentType }[] {
  return isAdmin ? [
    { id: "api", label: "settings.tab_api", Component: ApiSettings },
    { id: "group", label: "settings.tab_group", Component: GroupSettings },
    { id: "departments", label: "settings.tab_departments", Component: DepartmentSettings },
  ] : [];
}
