import { useRpc } from "../../../lib/api/query";

export type OperatorRole = "support" | "verifier" | "superadmin";
const RANK: Record<OperatorRole, number> = { support: 1, verifier: 2, superadmin: 3 };

export interface AdminOverview {
  operator_org: { id: string; slug: string; name: string } | null;
  operator_role: OperatorRole;
  orgs_pending: number; verifications_open: number; conflicts_open: number; corrections_pending: number;
  label_batches_ordered: number; market_alerts_open: number; webhooks_failed_24h: number; api_requests_24h: number;
  machines: number; orgs: number; last_anchor: { day: string; published_at: string | null } | null;
}

/** Operator role of the signed-in user (SPEC §2.4): support reads, verifier handles queues, superadmin changes settings. */
export function useAdmin() {
  const q = useRpc<AdminOverview>("admin_overview", {}, { staleTime: 30_000 });
  const role = q.data?.operator_role;
  return { overview: q, role, atLeast: (r: OperatorRole) => !!role && RANK[role] >= RANK[r] };
}
