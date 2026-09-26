import { ORGS, type Tx } from "./helpers.ts";

let serialCounter = 0;
export function serial(prefix = "SN") {
  serialCounter++;
  return `${prefix}${Date.now().toString(36).toUpperCase()}${serialCounter}X`;
}

export function machineData(overrides: Record<string, unknown> = {}) {
  return {
    make: "Volvo",
    model: "EC220E",
    year: 2021,
    category: "excavator_tracked",
    identifiers: [{ type: "serial", value: serial() }],
    ...overrides,
  };
}

export async function registerAs(t: Tx, who: "owner_a" | "owner_b" | "dealer" | "financier_a", data = machineData()) {
  await t.as(who);
  const org = ORGS[who];
  return t.rpc("register_machine", { p_org_id: org, p_data: data });
}

/** Starts and completes a Demo-BankID signature as the current user; returns its id. */
export async function sign(t: Tx, orgId: string, action: string, subjectId: string, params: Record<string, unknown> = {}) {
  const s = await t.rpc("start_signature", { p_org_id: orgId, p_action: action, p_subject_id: subjectId, p_params: params });
  await t.rpc("complete_mock_signature", { p_signature_id: s.id });
  return s.id as string;
}

export function encParams(type: string, contractRef: string | null, start: string, end: string | null) {
  return { type, contract_ref: contractRef, start_date: start, end_date: end };
}

export const TODAY = new Date().toISOString().slice(0, 10);
export const NEXT_YEAR = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

/** Financier registers an active encumbrance with a mock signature. */
export async function encumber(t: Tx, who: "financier_a" | "financier_b", machineId: string, type = "leasing", end: string | null = NEXT_YEAR) {
  await t.as(who);
  const org = ORGS[who];
  const params = encParams(type, `AVT-${who}`, TODAY, end);
  const sig = await sign(t, org, "register_encumbrance", machineId, params);
  return t.rpc("register_encumbrance", {
    p_org_id: org, p_machine_id: machineId, p_type: type, p_contract_ref: `AVT-${who}`, p_start_date: TODAY, p_end_date: end, p_signature_id: sig,
  });
}
