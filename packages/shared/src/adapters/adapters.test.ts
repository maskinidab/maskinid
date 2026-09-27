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
