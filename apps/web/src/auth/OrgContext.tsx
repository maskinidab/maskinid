import { createContext, useContext, useMemo, type ReactNode } from "react";
import { defaultModules, type ModuleName } from "../layouts/nav";
import type { Membership, OrgBrief, OrgType } from "../lib/api/types";

export interface OrgState {
  org: OrgBrief;
  orgId: string;
  role: Membership["role"];
  types: OrgType[];
  minTrustedLevel: number;
  /** Effective per-organisation modules (ADR 0031); the database resolves the default from the org type. */
  modules: Partial<Record<ModuleName, boolean>>;
  /** Whether a fleet module is on for this organisation. */
  moduleOn(m: ModuleName): boolean;
  has(type: OrgType): boolean;
  isAdmin: boolean;
  canWrite: boolean;
  /** Path inside the org context: path("machines") ⇒ /o/<slug>/machines */
  path(sub?: string): string;
  /** Operator support viewing the organisation read-only (step 22). */
  viewAs: boolean;
  viewAsExpiresAt: string | null;
}

const Ctx = createContext<OrgState | null>(null);

export function OrgProvider({ membership, children }: { membership: Membership; children: ReactNode }) {
  const value = useMemo<OrgState>(() => {
    const types = membership.effective_types;
    const modules = membership.modules ?? {};
    const fallback = defaultModules(types);
    return {
      org: membership.org,
      orgId: membership.org.id,
      role: membership.role,
      types,
      minTrustedLevel: membership.min_trusted_level,
      modules,
      moduleOn: (m) => modules[m] ?? fallback[m],
      has: (t) => types.includes(t),
      isAdmin: membership.role === "admin",
      canWrite: membership.role !== "readonly",
      viewAs: !!membership.view_as,
      viewAsExpiresAt: membership.view_as_expires_at ?? null,
      path: (sub = "") => `/o/${membership.org.slug}${sub ? `/${sub.replace(/^\//, "")}` : ""}`,
    };
  }, [membership]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg(): OrgState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrg outside an organisation route");
  return v;
}

export function useOptionalOrg(): OrgState | null {
  return useContext(Ctx);
}
