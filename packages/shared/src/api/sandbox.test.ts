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
    expect(SANDBOX_MACHINES.map((m) => m.scenario)).toEqual(["clean", "financed", "stolen", "disputed", "scrapped", "exported"]);
  });

  it("answers every route without falling through", () => {
    for (const r of ROUTES) {
      // Re-import only applies to the exported machine; asking it of an active one is a real 409, not a gap.
      const subject = r.rpc === "reimport_machine" ? SANDBOX_MACHINES.find((m) => m.scenario === "exported")! : SANDBOX_MACHINES[0]!;
      const path = r.path.replace(":id", subject.id);
      const res = sandboxHandle(r, { method: r.method, params: { id: subject.id }, query: { reg: subject.reg_number, q: "SBXCLEAN" },
        body: { machine_id: subject.id, type: "leasing", make: "Volvo", model: "EC", category: "excavator_tracked", identifiers: [{ type: "serial", value: "NEW1" }], query: { value: "x" },
          holder_org_id: "5a4db0c0-0000-4000-8000-0000000000f1", encumbrance_id: "5a4db0c0-0000-4000-8000-0000000000e1", document_id: "5a4db0c0-0000-4000-8000-0000000000d1" }, orgId: "o" });
      expect([200, 201, 202], `${r.method} ${path}`).toContain(res.status);
      const b = res.body as { sandbox?: boolean }[] | { sandbox: boolean };
      expect(Array.isArray(b) ? b.every((x) => x.sandbox) : b.sandbox).toBe(true);
    }
  });

  it("an exported machine is still fully identifiable", () => {
    const exp = SANDBOX_MACHINES.find((m) => m.scenario === "exported")!;
    const r = call("GET", "/machines/lookup", {}, { serial: exp.serial });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "exported", export_country: "NO", reg_number: exp.reg_number });
  });

  it("payoff: the lender quotes and settles, and no response ever carries an amount", () => {
    const fin = SANDBOX_MACHINES[1]!;
    const req = call("POST", "/payoffs", { encumbrance_id: "5a4db0c0-0000-4000-8000-0000000000e1", purpose: "trade_in" });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ status: "requested", holder: { name: fin.financing!.holder } });
    const quote = call("POST", `/payoffs/${(req.body as { id: string }).id}/quote`, { document_id: "d1", reference: "L-9", valid_until: "2026-12-01" });
    expect(quote.body).toMatchObject({ status: "quoted", quote_reference: "L-9" });
    const settled = call("POST", `/payoffs/${(req.body as { id: string }).id}/settle`, {});
    expect(settled.body).toMatchObject({ status: "settled", encumbrance: { status: "released" } });
    for (const res of [req, quote, settled]) {
      expect(JSON.stringify(res.body)).not.toMatch(/amount|belopp|restskuld|residual/i);
    }
  });

  it("reporting a financing against a bank that does not use MaskinID yields an unclaimed holder", () => {
    const clean = SANDBOX_MACHINES[0]!;
    const r = call("POST", "/encumbrances/request", { machine_id: clean.id, type: "leasing", holder_org_number: "516406-0120" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "pending", holder_unclaimed: true });
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
