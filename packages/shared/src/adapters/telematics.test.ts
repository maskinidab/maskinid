import { describe, expect, it } from "vitest";
import { createIso15143Provider, createMockTelematics, parseAempPage, telematicsFor } from "./telematics.ts";

const page1 = { Fleet: { Links: [{ rel: "self", href: "https://ct.example.com/aemp/Fleet/1" }, { rel: "Next", href: "https://ct.example.com/aemp/Fleet/2" }],
  Equipment: [
    { EquipmentHeader: { OEMName: "VOLVO", Model: "EC220E", EquipmentID: "E1", SerialNumber: "VCEC220E001" },
      Location: { datetime: "2026-09-26T10:00:00Z", Latitude: "59.33", Longitude: "18.06" }, CumulativeOperatingHours: { datetime: "2026-09-26T10:00:00Z", Hour: 1234.5 } },
    { EquipmentHeader: { PIN: "PIN-ONLY" }, Location: { Latitude: 0, Longitude: 0 } },
    { EquipmentHeader: {} },
  ] } };
const page2 = { Equipment: [{ EquipmentHeader: { EquipmentID: "E2", SerialNumber: "KMT002" }, CumulativeOperatingHours: { Hour: "88" } }],
  Links: [{ rel: "next", href: "https://evil.example.org/steal" }] };

describe("telematics (ISO 15143-3 / AEMP 2.0)", () => {
  it("parses a fleet page with and without the Fleet wrapper; drops 0,0 positions and headerless units", () => {
    const p = parseAempPage(page1);
    expect(p.readings).toEqual([
      { external_id: "E1", serial: "VCEC220E001", pin: undefined, make: "VOLVO", model: "EC220E", hours: 1234.5, hours_at: "2026-09-26T10:00:00Z",
        lat: 59.33, lon: 18.06, position_at: "2026-09-26T10:00:00Z" },
      { external_id: "PIN-ONLY", serial: undefined, pin: "PIN-ONLY", make: undefined, model: undefined, hours: undefined, hours_at: undefined },
    ]);
    expect(p.next).toBe("https://ct.example.com/aemp/Fleet/2");
    expect(parseAempPage(page2).readings[0]).toMatchObject({ external_id: "E2", hours: 88 });
  });

  it("follows pagination on the same origin only, with basic auth", async () => {
    const calls: { url: string; auth: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify(url.endsWith("/1") ? page1 : page2), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await createIso15143Provider({ fetch: fake }).fetch({ provider: "caretrack", base_url: "https://ct.example.com/aemp/",
      credential: { type: "basic", username: "u", password: "p" } });
    expect(r.map((x) => x.external_id)).toEqual(["E1", "PIN-ONLY", "E2"]);
    expect(calls.map((c) => c.url)).toEqual(["https://ct.example.com/aemp/Fleet/1", "https://ct.example.com/aemp/Fleet/2"]);
    expect(calls[0]!.auth).toBe(`Basic ${btoa("u:p")}`);
  });

  it("gets an OAuth token (Trackunit) and reports HTTP errors", async () => {
    const fake = (async (url: string, init: RequestInit) => {
      if (url.includes("token")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response("nope", { status: 401 });
    }) as unknown as typeof fetch;
    await expect(createIso15143Provider({ fetch: fake }).fetch({ provider: "trackunit", base_url: "https://tu.example.com",
      credential: { type: "oauth", token_url: "https://tu.example.com/token", client_id: "c", client_secret: "s" } })).rejects.toThrow("HTTP 401");
    await expect(createIso15143Provider({ fetch: fake }).fetch({ provider: "iso15143", base_url: "http://insecure", credential: null })).rejects.toThrow(/https/);
  });

  it("mock reports more hours and a Swedish position for the org's machines", async () => {
    const r = await createMockTelematics(() => new Date("2026-09-27T08:00:00Z")).fetch({ provider: "mock", base_url: null, credential: null,
      machines: [{ machine_id: "m", serial: "ABC123", hour_meter: 100 }, { machine_id: "n", serial: null, hour_meter: null }] });
    expect(r).toHaveLength(1);
    expect(r[0]!.hours).toBeGreaterThan(100);
    expect(r[0]!.lat).toBeGreaterThan(55);
    expect(telematicsFor({ provider: "komtrax" }).name).toBe("iso15143");
  });
});
