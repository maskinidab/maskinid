import { describe, expect, it } from "vitest";
import { createAdapters, heuristicColumnMapping, mockCompanyLookup, mockOcr, mockVehicleRegistry, verifyIdToken } from "./index.ts";

describe("adapters", () => {
  it("DEMO_MODE forces mocks everywhere", () => {
    const a = createAdapters({ DEMO_MODE: "true", IDENTITY_PROVIDER: "bankid", RESEND_API_KEY: "x" });
    expect([a.identity.name, a.signature.name, a.company.name, a.vehicleRegistry.name, a.theftRegistry.name, a.ocr.name, a.email.name])
      .toEqual(["mock", "mock", "mock", "mock", "mock", "mock", "console"]);
  });

  it("outside DEMO_MODE real providers are selected", () => {
    const a = createAdapters({ DEMO_MODE: "false", RESEND_API_KEY: "x" });
    expect([a.identity.name, a.signature.name, a.company.name, a.vehicleRegistry.name, a.email.name])
      .toEqual(["bankid", "bankid", "roaring", "transportstyrelsen", "resend"]);
  });

  // The demo needs real document reading without real BankID: a bank order has to be read for what it says,
  // while signing stays Demo-BankID. OCR is the only adapter allowed to opt in like this.
  it("OCR_PROVIDER=anthropic opts in to real reading while demo mode stays on", () => {
    const real = { name: "anthropic" } as unknown as Parameters<typeof createAdapters>[1];
    const a = createAdapters({ DEMO_MODE: "true", OCR_PROVIDER: "anthropic" }, real);
    expect(a.ocr.name).toBe("anthropic");
    // Everything else is untouched by the opt-in.
    expect([a.identity.name, a.signature.name, a.company.name, a.email.name]).toEqual(["mock", "mock", "mock", "console"]);
  });

  it("demo mode still mocks OCR when nothing opts in, and OCR_PROVIDER=mock wins outside demo mode", () => {
    const real = { name: "anthropic" } as unknown as Parameters<typeof createAdapters>[1];
    expect(createAdapters({ DEMO_MODE: "true" }, real).ocr.name).toBe("mock");
    expect(createAdapters({ DEMO_MODE: "false", OCR_PROVIDER: "mock" }, real).ocr.name).toBe("mock");
    expect(createAdapters({ DEMO_MODE: "false" }, real).ocr.name).toBe("anthropic");
  });

  it("mock company lookup mirrors the SQL mock", async () => {
    const c = await mockCompanyLookup.lookup("5566778899");
    expect(c).toMatchObject({ orgNumber: "556677-8899", name: "Demoföretag 556677 AB", isSoleTrader: false });
    const s = await mockCompanyLookup.lookup("780512-1236");
    expect(s?.isSoleTrader).toBe(true);
  });

  it("mock vehicle register never returns personal data", async () => {
    const r = await mockVehicleRegistry.lookup("abc 12b");
    expect(r?.road_reg).toBe("ABC12B");
    expect(Object.keys(r!)).not.toContain("owner_name");
  });

  it("mock OCR reads the demo hint", async () => {
    const img = btoa("nameplate:make=Cat;model=320;serial=CAT0320XYZ123;year=2020");
    expect(await mockOcr.nameplate({ base64: img, mediaType: "image/jpeg" })).toMatchObject({ make: "Cat", serial: "CAT0320XYZ123", year: 2020 });
  });

  it("mock OCR reads a financing document hint, and never returns an amount", async () => {
    // The hint sits at the end of the file, as it does in a real PDF fixture (e2e/helpers.ts financingPdf).
    const pdf = btoa("%PDF-1.4\nsome agreement text\nfinancing:financier_name=LF Finans;encumbrance_type=leasing;contract_ref=LF-77;term_months=60;serial=CAT0320XYZ123;amount=250000\n");
    const r = await mockOcr.financingDocument({ base64: pdf, mediaType: "application/pdf" });
    expect(r).toMatchObject({ financier_name: "LF Finans", encumbrance_type: "leasing", contract_ref: "LF-77", term_months: 60, serial: "CAT0320XYZ123" });
    // Nothing in the suggestion type carries money; an "amount" in the document must not reach the register.
    expect(Object.keys(r)).not.toContain("amount");
  });

  it("mock OCR falls back to a plausible financing suggestion with no hint", async () => {
    const r = await mockOcr.financingDocument({ base64: btoa("%PDF-1.4 no hint here"), mediaType: "application/pdf" });
    expect(r.encumbrance_type).toBe("leasing");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("heuristic column mapping recognises Swedish headers", () => {
    const m = heuristicColumnMapping(["Fabrikat", "Modell", "Serienummer", "Årsmodell", "Drifttimmar", "Övrigt"], ["make", "model", "serial", "year", "hour_meter", "vin"]);
    expect(m).toEqual({ make: "Fabrikat", model: "Modell", serial: "Serienummer", year: "Årsmodell", hour_meter: "Drifttimmar", vin: null });
  });

  it("id_token verification rejects tampering and wrong nonce", async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
    const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const now = Math.floor(Date.now() / 1000);
    const h = enc({ alg: "RS256", kid: "k1" });
    const p = enc({ iss: "https://b.example", aud: "cid", exp: now + 60, nonce: "n1", ssn: "197805121236" });
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`)));
    const s = btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const fetchStub = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch;
    const opts = { jwksUrl: "x", issuer: "https://b.example", audience: "cid", nonce: "n1", fetch: fetchStub };
    expect((await verifyIdToken(`${h}.${p}.${s}`, opts)).ssn).toBe("197805121236");
    await expect(verifyIdToken(`${h}.${p}.${s}`, { ...opts, nonce: "other" })).rejects.toThrow(/nonce/);
    const p2 = enc({ iss: "https://b.example", aud: "cid", exp: now + 60, nonce: "n1", ssn: "190001010000" });
    await expect(verifyIdToken(`${h}.${p2}.${s}`, opts)).rejects.toThrow(/signature/);
  });
});
