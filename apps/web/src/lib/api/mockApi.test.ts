import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../../data/seed";
import { mockApi, resetMockDatabase } from "./mockApi";
import { ApiError } from "./types";

describe("mockApi", () => {
  beforeEach(async () => {
    resetMockDatabase();
    await mockApi.signOut();
  });

  it("hittar maskin på PIN, serienummer och registernummer", async () => {
    for (const q of ["7KX0L2T4003198", "lx4003198", "MID-2026-0048812", "mid20260048812"]) {
      const r = await mockApi.lookupMachine(q);
      expect(r.status).toBe("hittad");
    }
    expect((await mockApi.lookupMachine("FINNSINTE123")).status).toBe("ej_hittad");
  });

  it("döljer belåningsbelopp för anonyma", async () => {
    const r = await mockApi.lookupMachine("7KX0L2T4003198");
    if (r.status !== "hittad") throw new Error("förväntade träff");
    expect(r.record.pledges[0].amountSek).toBeNull();
    await mockApi.signInWithPassword("langivare@exempel.se", DEMO_PASSWORD);
    const r2 = await mockApi.getMachineRecord(r.record.machine.id);
    expect(r2?.pledges[0].amountSek).toBe(1250000);
  });

  it("kräver inloggning för ändringar", async () => {
    await expect(mockApi.registerPledge({ machineId: "m-2", reference: null, amountSek: null })).rejects.toMatchObject({ code: "ej_inloggad" });
  });

  it("låter bara långivare registrera belåning", async () => {
    await mockApi.signInWithPassword("forsakring@exempel.se", DEMO_PASSWORD);
    await expect(mockApi.registerPledge({ machineId: "m-2", reference: null, amountSek: null })).rejects.toBeInstanceOf(ApiError);
    await mockApi.signInWithPassword("langivare@exempel.se", DEMO_PASSWORD);
    const r = await mockApi.registerPledge({ machineId: "m-2", reference: "KR-1", amountSek: 500000 });
    expect(r.pledges.filter((p) => !p.releasedAt)).toHaveLength(1);
    const history = await mockApi.getMachineHistory("m-2");
    expect(history[0].kind).toBe("belaning_registrerad");
  });

  it("registrerar maskin och stoppar dubbletter", async () => {
    await mockApi.signInWithPassword("agare@exempel.se", DEMO_PASSWORD);
    const input = { pin: "ABC12345678901", serialNumber: null, manufacturer: "Test", model: "T1", machineType: "Grävmaskin" as const, modelYear: 2024 };
    const r = await mockApi.registerMachine(input);
    expect(r.owner?.ownerName).toBe("Exempel Anläggning AB");
    expect(r.machine.registerNumber).toMatch(/^MID-\d{4}-\d{7}$/);
    await expect(mockApi.registerMachine(input)).rejects.toMatchObject({ code: "finns_redan" });
  });

  it("ägarbyte bara av nuvarande ägare", async () => {
    await mockApi.signInWithPassword("handlare@exempel.se", DEMO_PASSWORD);
    await expect(mockApi.transferOwnership({ machineId: "m-1", newOwnerOrganizationId: "org-hand", effectiveFrom: "2026-09-26T00:00:00Z" })).rejects.toMatchObject({ code: "saknar_behorighet" });
    await mockApi.signInWithPassword("agare@exempel.se", DEMO_PASSWORD);
    const r = await mockApi.transferOwnership({ machineId: "m-1", newOwnerOrganizationId: "org-hand", effectiveFrom: "2026-09-26T00:00:00Z" });
    expect(r.owner?.ownerName).toBe("Maskinhandel Mitt AB");
  });

  it("utfärdar registerutdrag med ögonblicksbild", async () => {
    await mockApi.signInWithPassword("handlare@exempel.se", DEMO_PASSWORD);
    const ex = await mockApi.issueExtract("m-1");
    expect(ex.id).toMatch(/^RU-\d{4}-\d{4}-\d+$/);
    expect((await mockApi.getExtract(ex.id))?.snapshot.machine.registerNumber).toBe("MID-2026-0048812");
  });

  it("administration: bara admin verifierar, skapar organisationer och bjuder in", async () => {
    await mockApi.signInWithPassword("agare@exempel.se", DEMO_PASSWORD);
    await expect(mockApi.verifyIdentity("m-5", null)).rejects.toMatchObject({ code: "saknar_behorighet" });
    await expect(mockApi.listUsers()).rejects.toMatchObject({ code: "saknar_behorighet" });

    const admin = await mockApi.signInWithPassword("admin@exempel.se", DEMO_PASSWORD);
    expect(admin.isAdmin).toBe(true);
    const r = await mockApi.verifyIdentity("m-5", "Kontrollerad på plats.");
    expect(r.machine.identityVerified).toBe(true);
    await expect(mockApi.verifyIdentity("m-5", null)).rejects.toMatchObject({ code: "ogiltig_inmatning" });

    const org = await mockApi.createOrganization({ name: "Ny Leasing AB", orgNr: "556200-0001", type: "langivare" });
    await expect(mockApi.createOrganization({ name: "X", orgNr: "556200-0001", type: "langivare" })).rejects.toMatchObject({ code: "finns_redan" });
    const invited = await mockApi.inviteUser({ email: "Ny@Leasing.se", fullName: "Nina Ny", organizationId: org.id, isAdmin: false });
    expect(invited.email).toBe("ny@leasing.se");
    expect((await mockApi.listUsers()).some((u) => u.email === "ny@leasing.se")).toBe(true);

    const nina = await mockApi.signInWithPassword("ny@leasing.se", DEMO_PASSWORD);
    expect(nina.organization.type).toBe("langivare");
  });
});
