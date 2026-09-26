import { formatDateIso } from "./format";
import type { Block, Insurance, MachineRecord, Pledge } from "./types";

/** Aktiva poster – de som inte är avslutade eller hävda. */
export const activePledges = (r: MachineRecord): Pledge[] => r.pledges.filter((p) => !p.releasedAt);
export const activeBlocks = (r: MachineRecord): Block[] => r.blocks.filter((b) => !b.liftedAt);

/** Försäkring som gäller i dag (svensk tid). validFrom/validTo är datum, validTo inklusive. */
export function activeInsurance(r: MachineRecord, now = new Date()): Insurance | null {
  const today = formatDateIso(now.toISOString());
  return r.insurances.find((i) => !i.cancelledAt && i.validFrom <= today && i.validTo >= today) ?? null;
}

export const isBlocked = (r: MachineRecord) => activeBlocks(r).length > 0;
export const isPledged = (r: MachineRecord) => activePledges(r).length > 0;

/** "Hjullastare, årsmodell 2021" – registerpostens benämning. */
export function machineTitle(r: MachineRecord): string {
  const m = r.machine;
  return `${m.machineType}${m.modelYear ? `, årsmodell ${m.modelYear}` : ""}`;
}
