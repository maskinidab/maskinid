import type { ComponentType } from "react";
import type { OrgType } from "../../lib/api/types";

/** Extra settings tabs registered by later steps (API keys, webhooks, label orders, billing). */
export function settingsTabs(_: { isAdmin: boolean; has(t: OrgType): boolean }): { id: string; label: string; Component: ComponentType }[] {
  return [];
}
