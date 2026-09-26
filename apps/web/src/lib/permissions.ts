/**
 * Behörighetsregler. Samma regler ska gälla i databasen (RLS-policyer och RPC-kontroller
 * i supabase/migrations) – frontend använder dem bara för att visa rätt handlingar.
 */
import { activeInsurance, activePledges } from "./status";
import type { Block, MachineRecord, Pledge, UserProfile } from "./types";

const orgId = (u: UserProfile | null) => u?.organization.id ?? null;
const orgType = (u: UserProfile | null) => u?.organization.type ?? null;

export const isOwner = (u: UserProfile | null, r: MachineRecord) =>
  !!u && r.owner?.ownerOrganizationId === orgId(u);

export const canRegisterMachine = (u: UserProfile | null) =>
  orgType(u) === "maskinagare" || orgType(u) === "maskinhandlare";

export const canTransferOwnership = (u: UserProfile | null, r: MachineRecord) => isOwner(u, r);

export const canRegisterPledge = (u: UserProfile | null) => orgType(u) === "langivare";

export const canReleasePledge = (u: UserProfile | null, p: Pledge) =>
  orgType(u) === "langivare" && p.lenderOrganizationId === orgId(u) && !p.releasedAt;

export const canRegisterInsurance = (u: UserProfile | null) => orgType(u) === "forsakringsgivare";

/** Ägare, långivare med aktiv belåning och försäkringsgivare med aktiv försäkring får spärra. */
export function canReportBlock(u: UserProfile | null, r: MachineRecord): boolean {
  if (!u) return false;
  if (isOwner(u, r)) return true;
  if (activePledges(r).some((p) => p.lenderOrganizationId === orgId(u))) return true;
  return activeInsurance(r)?.insurerOrganizationId === orgId(u);
}

export const canLiftBlock = (u: UserProfile | null, b: Block) =>
  !!u && b.reportedByOrganizationId === orgId(u) && !b.liftedAt;

/** Belopp visas bara för ägaren och långivaren själv. */
export const canSeePledgeAmount = (u: UserProfile | null, r: MachineRecord, p: Pledge) =>
  isOwner(u, r) || p.lenderOrganizationId === orgId(u);

export const isAdmin = (u: UserProfile | null) => u?.isAdmin === true;

export const ORG_TYPE_LABEL: Record<UserProfile["organization"]["type"], string> = {
  registerhallare: "Registerhållare",
  maskinhandlare: "Maskinhandlare",
  maskinagare: "Maskinägare",
  langivare: "Långivare",
  forsakringsgivare: "Försäkringsgivare",
};
