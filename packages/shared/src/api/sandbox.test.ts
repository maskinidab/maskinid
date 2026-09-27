import { describe, expect, it } from "vitest";
import { isValidRegNumber, hasMixedGroups } from "../regnr.ts";
import { matchRoute, ROUTES } from "./routes.ts";
import { SANDBOX_MACHINES, sandboxHandle } from "./sandbox.ts";

const call = (method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) => {
  const m = matchRoute(method, path)!;
  return sandboxHandle(m.route, { method, params: m.params, query, body, orgId: "org" }, { orgName: "Testbanken", now: () => new Date("2026-09-27T10:00:00Z") });
};

describe("API sandbox", () => {
  it("test machines have valid registration numbers and cover every scenario", () => {
    expect(SANDBOX_MACHINES.every((m) => isValidRegNumber(m.reg_number) && hasMixedGroups(m.reg_number))).toBe(true);
    expect(SANDBOX_MACHINES.map((m) => m.scenario)).toEqual(["clean", "financed", "stolen", "disputed", "scrapped"]);
  });

  it("answers every route without falling through", () => {
    for (const r of ROUTES) {
      const path = r.path.replace(":id", SANDBOX_MACHINES[0]!.id);
      const res = sandboxHandle(r, { method: r.method, params: { id: SANDBOX_MACHINES[0]!.id }, query: { reg: SANDBOX_MACHINES[0]!.reg_number, q: "SBXCLEAN" },
        body: { machine_id: SANDBOX_MACHINES[0]!.id, type: "leasing", make: "Volvo", model: "EC", category: "excavator_tracked", identifiers: [{ type: "serial", value: "NEW1" }], query: { value: "x" } }, orgId: "o" });
      expect([200, 201, 202], `${r.method} ${path}`).toContain(res.status);
      const b = res.body as { sandbox?: boolean }[] | { sandbox: boolean };
      expect(Array.isArray(b) ? b.every((x) => x.sandbox) : b.sandbox).toBe(true);
    }
  });

  it("financed machine: check shows the holder and a second encumbrance is a 409", () => {
    const fin = SANDBOX_MACHINES[1]!;
    const c = call("POST", "/checks", { query: { type: "reg", value: fin.reg_number } });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ sandbox: true, result: { found: true, has_active_financing: true, financing: { holder: "Sandbox Finans AB" } } });
    expect(call("POST", "/encumbrances", { machine_id: fin.id, type: "leasing" })).toMatchObject({ status: 409, body: { code: "ACTIVE_ENCUMBRANCE_EXISTS" } });
  });

  it("stolen machine blocks transfers; unknown machines are 404; partial search masks", () => {
    const stolen = SANDBOX_MACHINES[2]!;
    expect(call("POST", "/transfers", { machine_id: stolen.id, buyer: { org_number: "5566778899" } })).toMatchObject({ status: 409, body: { code: "MACHINE_STOLEN" } });
    expect(call("GET", "/machines/lookup", {}, { reg: "AAA2222" }).status).toBe(404);
    const s = call("GET", "/machines/search", {}, { q: "stolen" });
    expect(s.body).toMatchObject([{ reg_number: stolen.reg_number, match: "•••STOLEN••••", flagged: true }]);
    expect(call("GET", "/machines/search", {}, { q: "sb" }).status).toBe(422);
  });

  it("registering a serial that exists gives a duplicate conflict", () => {
    const r = call("POST", "/machines", { make: "Volvo", model: "EC220E", category: "excavator_tracked", identifiers: [{ type: "serial", value: "sbxclean0001" }] });
    expect(r.body).toMatchObject({ status: "disputed", conflict: { type: "duplicate_identifier" } });
  });
});
