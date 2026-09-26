import type {
  BlockReason,
  LookupResult,
  MachineRecord,
  MachineType,
  Organization,
  RegisterEvent,
  RegisterExtract,
  UserProfile,
  AdminUser,
  OrganizationType,
} from "../types";

/**
 * Kontraktet mellan frontend och backend.
 *
 * Två implementationer finns:
 * - `mockApi`     – körs i webbläsaren med exempeldata (localStorage). Används tills Supabase är på plats.
 * - `supabaseApi` – anropar Supabase (tabeller, vyer, RPC och Auth) enligt docs/BACKEND.md.
 *
 * Vilken som används styrs av VITE_DATA_SOURCE (se src/lib/api/index.ts).
 * Alla fel kastas som ApiError med ett meddelande som kan visas för användaren.
 */
export interface MaskinIdApi {
  // ---------- Auth ----------
  /** Nuvarande inloggade användare, eller null. */
  getCurrentUser(): Promise<UserProfile | null>;
  /** Skickar en inloggningslänk (magic link) till e-postadressen. */
  requestSignInLink(email: string): Promise<void>;
  /** Inloggning med lösenord. */
  signInWithPassword(email: string, password: string): Promise<UserProfile>;
  signOut(): Promise<void>;
  /** Anropas när inloggningsstatus ändras. Returnerar en funktion som avslutar prenumerationen. */
  onAuthChange(callback: (user: UserProfile | null) => void): () => void;

  // ---------- Register (läsning) ----------
  /** Slår upp en maskin på PIN, serienummer eller registernummer. */
  lookupMachine(query: string): Promise<LookupResult>;
  /** Hämtar en registerpost via maskinens id. */
  getMachineRecord(machineId: string): Promise<MachineRecord | null>;
  /** Maskinens historik, nyast först. */
  getMachineHistory(machineId: string): Promise<RegisterEvent[]>;
  /** Maskiner där den inloggade användarens organisation är ägare, långivare eller försäkringsgivare. */
  listMyMachines(): Promise<MachineRecord[]>;
  /** Organisationer, för val av ny ägare m.m. */
  listOrganizations(): Promise<Organization[]>;

  // ---------- Register (skrivning) ----------
  registerMachine(input: RegisterMachineInput): Promise<MachineRecord>;
  transferOwnership(input: TransferOwnershipInput): Promise<MachineRecord>;
  registerPledge(input: RegisterPledgeInput): Promise<MachineRecord>;
  releasePledge(pledgeId: string): Promise<MachineRecord>;
  registerInsurance(input: RegisterInsuranceInput): Promise<MachineRecord>;
  reportBlock(input: ReportBlockInput): Promise<MachineRecord>;
  liftBlock(blockId: string): Promise<MachineRecord>;

  // ---------- Registerutdrag ----------
  /** Utfärdar ett registerutdrag (sparas med ögonblicksbild och loggas i historiken). */
  issueExtract(machineId: string): Promise<RegisterExtract>;
  getExtract(extractId: string): Promise<RegisterExtract | null>;

  // ---------- Administration (kräver isAdmin) ----------
  /** Markerar maskinens identitet som kontrollerad mot typskylten. */
  verifyIdentity(machineId: string, note: string | null): Promise<MachineRecord>;
  listUsers(): Promise<AdminUser[]>;
  createOrganization(input: CreateOrganizationInput): Promise<Organization>;
  /** Skickar en inbjudan via e-post och kopplar användaren till en organisation (Edge Function invite-user). */
  inviteUser(input: InviteUserInput): Promise<AdminUser>;
}

export interface CreateOrganizationInput {
  name: string;
  orgNr: string;
  type: OrganizationType;
}

export interface InviteUserInput {
  email: string;
  fullName: string;
  organizationId: string;
  isAdmin: boolean;
}

export interface RegisterMachineInput {
  pin: string | null;
  serialNumber: string | null;
  manufacturer: string;
  model: string;
  machineType: MachineType;
  modelYear: number | null;
  /** Organisation som registreras som ägare. Standard: användarens egen organisation. */
  ownerOrganizationId?: string;
}

export interface TransferOwnershipInput {
  machineId: string;
  newOwnerOrganizationId: string;
  /** ISO-datum då ägarbytet gäller från. */
  effectiveFrom: string;
}

export interface RegisterPledgeInput {
  machineId: string;
  reference: string | null;
  amountSek: number | null;
}

export interface RegisterInsuranceInput {
  machineId: string;
  coverage: string;
  policyNumber: string | null;
  /** "YYYY-MM-DD" */
  validFrom: string;
  /** "YYYY-MM-DD", inklusive */
  validTo: string;
}

export interface ReportBlockInput {
  machineId: string;
  reason: BlockReason;
  description: string | null;
  policeReportNumber: string | null;
}

export type ApiErrorCode =
  | "ej_inloggad"
  | "saknar_behorighet"
  | "hittades_inte"
  | "finns_redan"
  | "ogiltig_inmatning"
  | "natverksfel"
  | "okant";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}
