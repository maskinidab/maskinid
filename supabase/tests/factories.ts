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
