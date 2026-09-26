/**
 * Domänmodell för MaskinID.
 *
 * Typerna speglar tabellerna i supabase/migrations/0001_initial_schema.sql
 * (i camelCase – mappningen görs i src/lib/api/supabaseApi.ts).
 * Se docs/BACKEND.md för hela datamodellen.
 */

/** Vilken sorts aktör en organisation är. Styr vad dess användare får registrera. */
/** `registerhallare` är MaskinID själv – administratörernas organisation. */
export type OrganizationType = "maskinhandlare" | "maskinagare" | "langivare" | "forsakringsgivare" | "registerhallare";

export interface Organization {
  id: string;
  name: string;
  /** Organisationsnummer, t.ex. "556677-8899". */
  orgNr: string;
  type: OrganizationType;
}

/** En inloggad användare och den organisation hen företräder. */
export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  organization: Organization;
  /** Administratör: skapar organisationer, bjuder in användare och verifierar identitet. */
  isAdmin?: boolean;
}

/** Användare som administratören ser i Administration. */
export interface AdminUser extends UserProfile {
  lastSignInAt: string | null;
  invitedAt: string | null;
}

export type MachineType =
  | "Grävmaskin"
  | "Hjullastare"
  | "Dumper"
  | "Skogsmaskin"
  | "Traktor"
  | "Kran"
  | "Vält"
  | "Teleskoplastare"
  | "Övrigt";

export const MACHINE_TYPES: MachineType[] = [
  "Grävmaskin",
  "Hjullastare",
  "Dumper",
  "Skogsmaskin",
  "Traktor",
  "Kran",
  "Vält",
  "Teleskoplastare",
  "Övrigt",
];

export interface Machine {
  id: string;
  /** MaskinIDs eget registernummer, t.ex. "MID-2026-0048812". */
  registerNumber: string;
  /** Product Identification Number (17 tecken, ISO 10261), t.ex. "7KX0L2T4003198". */
  pin: string | null;
  /** Tillverkarens serienummer. */
  serialNumber: string | null;
  manufacturer: string;
  model: string;
  machineType: MachineType;
  modelYear: number | null;
  /** Identiteten är kontrollerad mot typskylt/tillverkare. */
  identityVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Ownership {
  id: string;
  machineId: string;
  ownerOrganizationId: string;
  ownerName: string;
  ownerOrgNr: string;
  since: string;
  /** null = nuvarande registrerad ägare. */
  until: string | null;
}

/** Belåning (pant) registrerad av en långivare. */
export interface Pledge {
  id: string;
  machineId: string;
  lenderOrganizationId: string;
  lenderName: string;
  /** Långivarens referens, t.ex. avtalsnummer. */
  reference: string | null;
  /** Belånat belopp i hela kronor. Visas bara för behöriga. */
  amountSek: number | null;
  registeredAt: string;
  /** null = belåningen gäller fortfarande. */
  releasedAt: string | null;
}

export interface Insurance {
  id: string;
  machineId: string;
  insurerOrganizationId: string;
  insurerName: string;
  /** T.ex. "Maskinförsäkring". */
  coverage: string;
  policyNumber: string | null;
  /** Datum "YYYY-MM-DD" (första giltiga dag). */
  validFrom: string;
  /** Datum "YYYY-MM-DD" (sista giltiga dag, inklusive). */
  validTo: string;
  cancelledAt: string | null;
}

export type BlockReason = "stulen" | "avvikelse" | "myndighetsbeslut";

export const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  stulen: "Anmäld stulen",
  avvikelse: "Avvikelse som kräver kontroll",
  myndighetsbeslut: "Spärrad enligt beslut",
};

/** Spärr – t.ex. anmäld stöld. Visas med status-sparr. */
export interface Block {
  id: string;
  machineId: string;
  reason: BlockReason;
  description: string | null;
  /** Polisens diarienummer vid stöld. */
  policeReportNumber: string | null;
  reportedByOrganizationId: string;
  reportedByName: string;
  reportedAt: string;
  liftedAt: string | null;
}

export type RegisterEventKind =
  | "maskin_registrerad"
  | "identitet_verifierad"
  | "agarbyte"
  | "belaning_registrerad"
  | "belaning_avslutad"
  | "forsakring_registrerad"
  | "forsakring_avslutad"
  | "sparr_registrerad"
  | "sparr_havd"
  | "utdrag_hamtat";

/** En rad i maskinens historik (audit log). Skrivs av databasen via triggers. */
export interface RegisterEvent {
  id: string;
  machineId: string;
  kind: RegisterEventKind;
  description: string;
  /** Vilken organisation som gjorde ändringen – "källa" enligt tonaliteten. */
  sourceName: string;
  occurredAt: string;
}

export interface RegisterExtract {
  /** Utdragsnummer, t.ex. "RU-2026-0931-4471". */
  id: string;
  machineId: string;
  issuedAt: string;
  issuedToName: string | null;
  /** Ögonblicksbild av registerposten vid utfärdandet. */
  snapshot: MachineRecord;
}

/**
 * Registerposten – det sammanställda svaret på en sökning.
 * I Supabase motsvaras den av vyn `machine_records` / RPC `lookup_machine`.
 */
export interface MachineRecord {
  machine: Machine;
  owner: Ownership | null;
  pledges: Pledge[];
  insurances: Insurance[];
  blocks: Block[];
  /** Senaste ändring över alla delar av posten. */
  lastUpdatedAt: string;
  /** Vem som gjorde senaste ändringen. */
  lastUpdatedBy: string;
}

export type LookupResult =
  | { status: "hittad"; record: MachineRecord }
  | { status: "ej_hittad"; query: string };
