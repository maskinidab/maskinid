/**
 * Exempeldata för mock-backend. Alla företag och personer är påhittade.
 * Samma data finns som SQL i supabase/seed.sql så att en lokal Supabase kan startas med identiskt innehåll.
 */
import type { Block, Insurance, Machine, Organization, Ownership, Pledge, RegisterEvent } from "../lib/types";

export interface DemoUser {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  isAdmin?: boolean;
  invitedAt?: string;
  lastSignInAt?: string;
}

export interface MockDatabase {
  organizations: Organization[];
  users: DemoUser[];
  machines: Machine[];
  ownerships: Ownership[];
  pledges: Pledge[];
  insurances: Insurance[];
  blocks: Block[];
  events: RegisterEvent[];
  extracts: import("../lib/types").RegisterExtract[];
  counters: { machine: number; extract: number };
}

/** Lösenord för alla demokonton i mock-läget. */
export const DEMO_PASSWORD = "maskinid";

export function createSeed(): MockDatabase {
  const organizations: Organization[] = [
    { id: "org-anl", name: "Exempel Anläggning AB", orgNr: "556100-0001", type: "maskinagare" },
    { id: "org-skog", name: "Norrskog Entreprenad AB", orgNr: "556100-0002", type: "maskinagare" },
    { id: "org-hand", name: "Maskinhandel Mitt AB", orgNr: "556100-0003", type: "maskinhandlare" },
    { id: "org-bank", name: "Exempelbanken AB", orgNr: "516100-0004", type: "langivare" },
    { id: "org-fin", name: "Maskinfinans Sverige AB", orgNr: "556100-0005", type: "langivare" },
    { id: "org-fors", name: "Exempelförsäkring AB", orgNr: "516100-0006", type: "forsakringsgivare" },
    { id: "org-mid", name: "MaskinID Sverige AB", orgNr: "559900-0007", type: "registerhallare" },
  ];

  const users: DemoUser[] = [
    { id: "u-agare", email: "agare@exempel.se", fullName: "Anna Ägare", organizationId: "org-anl" },
    { id: "u-handlare", email: "handlare@exempel.se", fullName: "Henrik Handlare", organizationId: "org-hand" },
    { id: "u-bank", email: "langivare@exempel.se", fullName: "Lena Långivare", organizationId: "org-bank" },
    { id: "u-fors", email: "forsakring@exempel.se", fullName: "Fredrik Försäkring", organizationId: "org-fors" },
    { id: "u-admin", email: "admin@exempel.se", fullName: "Alva Admin", organizationId: "org-mid", isAdmin: true },
  ];

  const m = (
    id: string,
    registerNumber: string,
    pin: string | null,
    serialNumber: string | null,
    manufacturer: string,
    model: string,
    machineType: Machine["machineType"],
    modelYear: number,
    identityVerified: boolean,
    createdAt: string,
    updatedAt: string,
  ): Machine => ({ id, registerNumber, pin, serialNumber, manufacturer, model, machineType, modelYear, identityVerified, createdAt, updatedAt });

  const machines: Machine[] = [
    m("m-1", "MID-2026-0048812", "7KX0L2T4003198", "LX4003198", "Exempeltillverkaren", "L120", "Hjullastare", 2021, true, "2024-03-14T09:12:00Z", "2026-09-26T12:05:00Z"),
    m("m-2", "MID-2026-0051207", "1FG5H3R8002741", "EX302741", "Exempeltillverkaren", "EC220", "Grävmaskin", 2019, true, "2023-05-02T10:00:00Z", "2026-08-11T07:40:00Z"),
    m("m-3", "MID-2026-0060033", "3SK9P1W2001188", "SK1188", "Nordmaskin", "Skotare 1110", "Skogsmaskin", 2020, true, "2022-11-20T13:30:00Z", "2026-09-02T08:15:00Z"),
    m("m-4", "MID-2026-0060391", "9DM2T7A5000452", "DM452", "Exempeltillverkaren", "A30", "Dumper", 2018, true, "2021-06-01T08:00:00Z", "2026-09-19T06:50:00Z"),
    m("m-5", "MID-2026-0071150", null, "TL-88213", "Lyftex", "TH 3.5", "Teleskoplastare", 2023, false, "2026-09-10T14:20:00Z", "2026-09-10T14:20:00Z"),
  ];

  const ownerships: Ownership[] = [
    { id: "o-1", machineId: "m-1", ownerOrganizationId: "org-hand", ownerName: "Maskinhandel Mitt AB", ownerOrgNr: "556100-0003", since: "2021-04-02T00:00:00Z", until: "2024-03-14T00:00:00Z" },
    { id: "o-2", machineId: "m-1", ownerOrganizationId: "org-anl", ownerName: "Exempel Anläggning AB", ownerOrgNr: "556100-0001", since: "2024-03-14T00:00:00Z", until: null },
    { id: "o-3", machineId: "m-2", ownerOrganizationId: "org-anl", ownerName: "Exempel Anläggning AB", ownerOrgNr: "556100-0001", since: "2023-05-02T00:00:00Z", until: null },
    { id: "o-4", machineId: "m-3", ownerOrganizationId: "org-skog", ownerName: "Norrskog Entreprenad AB", ownerOrgNr: "556100-0002", since: "2022-11-20T00:00:00Z", until: null },
    { id: "o-5", machineId: "m-4", ownerOrganizationId: "org-skog", ownerName: "Norrskog Entreprenad AB", ownerOrgNr: "556100-0002", since: "2021-06-01T00:00:00Z", until: null },
    { id: "o-6", machineId: "m-5", ownerOrganizationId: "org-hand", ownerName: "Maskinhandel Mitt AB", ownerOrgNr: "556100-0003", since: "2026-09-10T00:00:00Z", until: null },
  ];

  const pledges: Pledge[] = [
    { id: "p-1", machineId: "m-1", lenderOrganizationId: "org-bank", lenderName: "Exempelbanken AB", reference: "KR-2024-11873", amountSek: 1250000, registeredAt: "2024-03-14T10:00:00Z", releasedAt: null },
    { id: "p-2", machineId: "m-3", lenderOrganizationId: "org-fin", lenderName: "Maskinfinans Sverige AB", reference: "MF-88120", amountSek: 2100000, registeredAt: "2022-11-21T09:00:00Z", releasedAt: "2026-09-02T08:15:00Z" },
    { id: "p-3", machineId: "m-4", lenderOrganizationId: "org-bank", lenderName: "Exempelbanken AB", reference: "KR-2021-04410", amountSek: 980000, registeredAt: "2021-06-02T09:00:00Z", releasedAt: null },
  ];

  const insurances: Insurance[] = [
    { id: "i-1", machineId: "m-1", insurerOrganizationId: "org-fors", insurerName: "Exempelförsäkring AB", coverage: "Maskinförsäkring", policyNumber: "MF-448120", validFrom: "2026-01-01", validTo: "2026-12-31", cancelledAt: null },
    { id: "i-2", machineId: "m-2", insurerOrganizationId: "org-fors", insurerName: "Exempelförsäkring AB", coverage: "Maskinförsäkring", policyNumber: "MF-397702", validFrom: "2026-05-01", validTo: "2027-04-30", cancelledAt: null },
    { id: "i-3", machineId: "m-3", insurerOrganizationId: "org-fors", insurerName: "Exempelförsäkring AB", coverage: "Maskinförsäkring", policyNumber: "MF-300915", validFrom: "2026-01-01", validTo: "2026-12-31", cancelledAt: null },
  ];

  const blocks: Block[] = [
    { id: "b-1", machineId: "m-4", reason: "stulen", description: "Försvann från arbetsplats i Umeå natten mot 19 sep.", policeReportNumber: "5000-K123456-26", reportedByOrganizationId: "org-skog", reportedByName: "Norrskog Entreprenad AB", reportedAt: "2026-09-19T06:50:00Z", liftedAt: null },
  ];

  const e = (id: string, machineId: string, kind: RegisterEvent["kind"], description: string, sourceName: string, occurredAt: string): RegisterEvent => ({ id, machineId, kind, description, sourceName, occurredAt });
  const events: RegisterEvent[] = [
    e("e-1", "m-1", "maskin_registrerad", "Maskinen registrerades i MaskinID.", "Maskinhandel Mitt AB", "2021-04-02T09:00:00Z"),
    e("e-2", "m-1", "identitet_verifierad", "Identiteten verifierades mot typskylt.", "Maskinhandel Mitt AB", "2021-04-02T09:30:00Z"),
    e("e-3", "m-1", "agarbyte", "Ny registrerad ägare: Exempel Anläggning AB.", "Maskinhandel Mitt AB", "2024-03-14T09:12:00Z"),
    e("e-4", "m-1", "belaning_registrerad", "Belåning registrerad.", "Exempelbanken AB", "2024-03-14T10:00:00Z"),
    e("e-5", "m-1", "forsakring_registrerad", "Maskinförsäkring registrerad till 31 dec 2026.", "Exempelförsäkring AB", "2026-09-26T12:05:00Z"),
    e("e-6", "m-2", "maskin_registrerad", "Maskinen registrerades i MaskinID.", "Exempel Anläggning AB", "2023-05-02T10:00:00Z"),
    e("e-7", "m-2", "identitet_verifierad", "Identiteten verifierades mot typskylt.", "Exempel Anläggning AB", "2023-05-02T10:10:00Z"),
    e("e-8", "m-2", "forsakring_registrerad", "Maskinförsäkring registrerad till 30 apr 2027.", "Exempelförsäkring AB", "2026-08-11T07:40:00Z"),
    e("e-9", "m-3", "maskin_registrerad", "Maskinen registrerades i MaskinID.", "Norrskog Entreprenad AB", "2022-11-20T13:30:00Z"),
    e("e-10", "m-3", "belaning_registrerad", "Belåning registrerad.", "Maskinfinans Sverige AB", "2022-11-21T09:00:00Z"),
    e("e-11", "m-3", "belaning_avslutad", "Belåningen avslutades.", "Maskinfinans Sverige AB", "2026-09-02T08:15:00Z"),
    e("e-12", "m-4", "maskin_registrerad", "Maskinen registrerades i MaskinID.", "Norrskog Entreprenad AB", "2021-06-01T08:00:00Z"),
    e("e-13", "m-4", "belaning_registrerad", "Belåning registrerad.", "Exempelbanken AB", "2021-06-02T09:00:00Z"),
    e("e-14", "m-4", "sparr_registrerad", "Maskinen anmäld stulen. Polisens diarienummer 5000-K123456-26.", "Norrskog Entreprenad AB", "2026-09-19T06:50:00Z"),
    e("e-15", "m-5", "maskin_registrerad", "Maskinen registrerades i MaskinID.", "Maskinhandel Mitt AB", "2026-09-10T14:20:00Z"),
  ];

  return {
    organizations,
    users,
    machines,
    ownerships,
    pledges,
    insurances,
    blocks,
    events,
    extracts: [],
    counters: { machine: 71150, extract: 4470 },
  };
}
