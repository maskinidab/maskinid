import { describe, expect, it } from "vitest";
import { encumber, registerAs, serial, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

const MAPPING = { serial: "Serienr", make: "Fabrikat", model: "Modell", year: "År", category: "Typ", hour_meter: "Timmar", owner_org_number: "Kund orgnr" };

function row(over: Record<string, string> = {}) {
  return { Serienr: serial("IMP"), Fabrikat: "Volvo", Modell: "L120H", "År": "2020", Typ: "Hjullastare", Timmar: "5 400", ...over };
}

describe("imports (SPEC §6.5)", () => {
  it("validates rows: required fields, category text, duplicates in file and against the register", async () => {
    await tx(async (t) => {
      const existing = await registerAs(t, "owner_b");
      const existingSerial = (await t.q<{ value: string }>("select value from public.machine_identifiers where machine_id = $1", [existing.id]))[0]!.value;
      await t.as("dealer");
      const dup = serial("DUP");
      const rows = [row(), row({ Serienr: dup }), row({ Serienr: dup }), row({ Fabrikat: "" }), row({ Typ: "Rymdskepp" }),
        row({ Serienr: existingSerial }), row({ "År": "1850" }), row({ Serienr: "" })];
      const imp = await t.rpc("create_import", { p_org_id: ORGS.dealer, p_filename: "lager.csv", p_mapping: MAPPING, p_rows: JSON.stringify(rows) });
      const codes = imp.rows.map((r: any) => r.errors.map((e: any) => `${e.field}:${e.code}`).join(","));
      expect(codes).toEqual(["", "", "serial:duplicate_in_file", "make:required", "category:unknown",
        "serial:duplicate_in_register", "year:invalid", "serial:required"]);
      expect(imp).toMatchObject({ status: "validated", rows_total: 8, rows_ok: 2, rows_error: 6 });
      expect(imp.rows[5].errors[0].reg_number).toBe(existing.reg_number);
      expect(imp.rows[0].data).toMatchObject({ category: "wheel_loader", hour_meter: "5400" });
    });
  });

  it("commits only valid rows as origin import, level 0, one event per machine plus import.committed", async () => {
    await tx(async (t) => {
      await t.as("dealer");
      const imp = await t.rpc("create_import", { p_org_id: ORGS.dealer, p_filename: "x.csv", p_mapping: MAPPING,
        p_rows: JSON.stringify([row(), row({ "Kund orgnr": "559900-0001" }), row({ Fabrikat: "" })]) });
      const done = await t.rpc("import_commit", { p_org_id: ORGS.dealer, p_import_id: imp.id });
      expect(done).toMatchObject({ status: "committed", rows_committed: 2 });
      expect(done.rows.map((r: any) => r.status)).toEqual(["committed", "committed", "skipped"]);
      const ids = done.rows.filter((r: any) => r.machine_id).map((r: any) => r.machine_id);
      const ms = await t.q<any>("select origin, verification_level, owner_org_id, status from public.machines where id = any($1) order by created_at", [ids]);
      expect(ms.every((m: any) => m.origin === "import" && m.verification_level === 0 && m.status === "active")).toBe(true);
      expect(ms.map((m: any) => m.owner_org_id).sort()).toEqual([ORGS.dealer, ORGS.owner_a].sort());
      const ev = await t.q<any>("select type from public.events where org_id = $1 and type = 'import.committed'", [ORGS.dealer]);
      expect(ev).toHaveLength(1);
      expect((await t.rpcError("import_commit", { p_org_id: ORGS.dealer, p_import_id: imp.id })).code).toBe("IMPORT_NOT_VALIDATED");
      await t.as("owner_b");
      expect((await t.rpcError("get_import", { p_org_id: ORGS.owner_b, p_import_id: imp.id })).code).toBe("NOT_FOUND");
      expect(await t.q("select id from public.import_rows where import_id = $1", [imp.id])).toHaveLength(0);
    });
  });

  it("financier import registers active encumbrances with one signature; existing machines are encumbered, never overwritten", async () => {
    await tx(async (t) => {
      const mine = await registerAs(t, "owner_a");
      const taken = await registerAs(t, "owner_a");
      await encumber(t, "financier_b", taken.id);
      const serialOf = async (id: string) => (await t.q<{ value: string }>("select value from public.machine_identifiers where machine_id = $1", [id]))[0]!.value;
      await t.as("owner_a");
      const s1 = await serialOf(mine.id);
      const s2 = await serialOf(taken.id);
      await t.as("financier_a");
      const mapping = { ...MAPPING, contract_ref: "Avtal", encumbrance_type: "Avtalstyp", end_date: "Slut" };
      const rows = [
        row({ "Kund orgnr": "559900-0001", Avtal: "A-1", Avtalstyp: "Leasing", Slut: "2029-12-31" }),
        row({ Serienr: s1, Avtal: "A-2", Avtalstyp: "Äganderättsförbehåll", Slut: "2028-06-30" }),
        row({ Serienr: s2, Avtal: "A-3", Avtalstyp: "Leasing", Slut: "2029-01-01" }),
        row({ "Kund orgnr": "559900-0001", Avtal: "A-4", Avtalstyp: "Äganderättsförbehåll" }),
        row({ Avtal: "A-5", Avtalstyp: "Leasing", Slut: "2029-01-01" }),
      ];
      const imp = await t.rpc("create_import", { p_org_id: ORGS.financier_a, p_filename: "portfolj.csv", p_mapping: mapping, p_rows: JSON.stringify(rows) });
      expect(imp.rows.map((r: any) => [r.action, r.errors.map((e: any) => e.code).join(",")])).toEqual([
        ["create", ""], ["encumber_existing", ""], ["encumber_existing", "active_encumbrance_exists"],
        ["create", "required_for_ownership_reservation"], ["create", "required"],
      ]);
      expect(imp.encumbrance_rows).toBe(2);
      expect((await t.rpcError("import_commit", { p_org_id: ORGS.financier_a, p_import_id: imp.id })).code).toBe("SIGNATURE_REQUIRED");
      const sig = await sign(t, ORGS.financier_a, "import_commit", imp.id, { rows: 2, encumbrances: 2 });
      const s = await t.q<{ signed_text: string }>("select signed_text from public.signatures where id = $1", [sig]);
      expect(s[0]!.signed_text).toContain("Jag importerar 2 maskiner från portfolj.csv");
      const done = await t.rpc("import_commit", { p_org_id: ORGS.financier_a, p_import_id: imp.id, p_signature_id: sig });
      expect(done.rows_committed).toBe(2);
      const enc = await t.q<any>("select machine_id, type, status, holder_org_id, contract_ref from public.encumbrances where holder_org_id = $1 order by contract_ref", [ORGS.financier_a]);
      expect(enc.map((e: any) => [e.contract_ref, e.type, e.status])).toEqual([["A-1", "leasing", "active"], ["A-2", "ownership_reservation", "active"]]);
      expect(enc[1].machine_id).toBe(mine.id);
      await t.as("owner_a");
      expect((await t.q<any>("select holder_org_id from public.encumbrances where machine_id = $1 and status = 'active'", [taken.id])).map((x: any) => x.holder_org_id)).toEqual([ORGS.financier_b]);
    });
  });

  it("an encumbrance registered between validation and commit is never overwritten: conflict recorded", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a");
      const s1 = (await t.q<{ value: string }>("select value from public.machine_identifiers where machine_id = $1", [m.id]))[0]!.value;
      await t.as("financier_a");
      const mapping = { serial: "Serienr", contract_ref: "Avtal", encumbrance_type: "Typ", end_date: "Slut" };
      const imp = await t.rpc("create_import", { p_org_id: ORGS.financier_a, p_filename: "p.csv", p_mapping: mapping,
        p_rows: JSON.stringify([{ Serienr: s1, Avtal: "B-1", Typ: "leasing", Slut: "2030-01-01" }]) });
      expect(imp.rows_ok).toBe(1);
      await encumber(t, "financier_b", m.id);
      await t.as("financier_a");
      const sig = await sign(t, ORGS.financier_a, "import_commit", imp.id, { rows: 1, encumbrances: 1 });
      const done = await t.rpc("import_commit", { p_org_id: ORGS.financier_a, p_import_id: imp.id, p_signature_id: sig });
      expect(done.rows_committed).toBe(0);
      expect(done.rows[0].errors.at(-1)).toEqual({ field: "row", code: "ACTIVE_ENCUMBRANCE_EXISTS" });
      await t.as("service");
      const c = await t.q<any>("select type, status from public.conflicts where machine_id = $1", [m.id]);
      expect(c).toEqual([{ type: "double_encumbrance", status: "open" }]);
    });
  });

  it("only registering org types may import; row limit", async () => {
    await tx(async (t) => {
      await t.as("insurer");
      expect((await t.rpcError("create_import", { p_org_id: ORGS.insurer, p_filename: "x", p_mapping: MAPPING, p_rows: JSON.stringify([row()]) })).code).toBe("FORBIDDEN");
      await t.as("dealer");
      const big = JSON.stringify(Array.from({ length: 5001 }, () => ({ Serienr: "X" })));
      expect((await t.rpcError("create_import", { p_org_id: ORGS.dealer, p_filename: "x", p_mapping: MAPPING, p_rows: big })).code).toBe("VALIDATION");
    });
  });
});
