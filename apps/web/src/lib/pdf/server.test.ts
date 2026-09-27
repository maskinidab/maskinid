import { describe, expect, it } from "vitest";
import { parsePdfRequest, PdfRequestError, renderPdf, supabaseRpc } from "./server";

const ORG = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const certificate = {
  report_number: "B-2026-000042", result_hash: "a".repeat(64),
  result: { generated_at: "2026-09-26T10:00:00Z", org_name: "Bergs", machine: { reg_number: "C9XK4F", make: "Caterpillar", model: "950 GC", variant: null, year: 2018,
    category: "wheel_loader", status: "active", verification_level: 2, technical: {} }, identifiers: [{ type: "serial", value: "CAT1", verified: true }],
    owner: { name: "Bergs", org_number: "556701-2009", city: "Västerås" }, owner_since: "2024-03-01", owner_ordinal: 1, label_code: null,
    financing: { has_active: false, type: null, holder: null }, first_sale_dealer: null },
};

describe("server-side PDFs (step 26)", () => {
  it("validates the request per kind", () => {
    expect(parsePdfRequest({ kind: "certificate", org_id: ORG, machine_id: M, locale: "en" })).toMatchObject({ kind: "certificate", locale: "en" });
    expect(parsePdfRequest({ kind: "receipt", receipt_number: "K-2026-000049" }).receipt_number).toBe("K-2026-000049");
    for (const bad of [{}, { kind: "sql" }, { kind: "certificate", org_id: ORG }, { kind: "receipt", receipt_number: "x; drop" }, { kind: "invoice", org_id: ORG, invoice_id: "1" }]) {
      expect(() => parsePdfRequest(bad)).toThrow(PdfRequestError);
    }
  });

  it("issues the certificate through the RPC as the user and renders it", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async <T>(fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return certificate as T; };
    const r = await renderPdf({ kind: "certificate", org_id: ORG, machine_id: M, locale: "sv" }, rpc);
    expect(calls).toEqual([["create_ownership_certificate", { p_org_id: ORG, p_machine_id: M }]]);
    expect(r.filename).toBe("agarbevis-B-2026-000042.pdf");
    expect(new TextDecoder().decode(r.bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("forwards the user's token and maps database errors", async () => {
    let auth = "";
    const fake = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ message: "FORBIDDEN" }), { status: 403 });
    }) as unknown as typeof fetch;
    const rpc = supabaseRpc("https://x.supabase.co", "anon", "user-jwt", fake);
    await expect(rpc("create_ownership_certificate", {})).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(auth).toBe("Bearer user-jwt");
  });
});
