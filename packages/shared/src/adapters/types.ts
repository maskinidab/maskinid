/**
 * External services behind adapters (CLAUDE.md rule 10). Every adapter has a mock implementation; DEMO_MODE forces
 * mocks everywhere. Implementations only use fetch/Web Crypto so they run in the browser, Node and Deno (Edge Functions).
 */

export interface IdentityResult {
  personalNumber: string; // never stored in clear – callers hash it (record_identity_verification)
  givenName?: string;
  surname?: string;
  provider: "bankid" | "mock";
  evidence: Record<string, unknown>;
}

export interface IdentityProvider {
  readonly name: "bankid" | "mock";
  /** Starts an authentication; returns a URL to redirect to (OIDC) or a mock token. */
  start(opts: { redirectUri: string; state: string; nonce: string }): Promise<{ url: string }>;
  /** Completes the authentication from the callback parameters. */
  complete(params: { code: string; redirectUri: string; nonce: string }): Promise<IdentityResult>;
}

export interface SignatureRequest {
  signedText: string; // human-readable summary, e.g. "Jag bekräftar förvärv av maskin ABC-1234 från Org AB 2026-09-21"
  subjectType: string;
  subjectId: string;
  redirectUri: string;
  state: string;
}

export interface SignatureResult {
  provider: "bankid" | "mock";
  status: "completed" | "failed" | "cancelled";
  personalNumber?: string;
  evidence: Record<string, unknown>;
}

export interface SignatureProvider {
  readonly name: "bankid" | "mock";
  start(req: SignatureRequest): Promise<{ url: string; orderRef: string }>;
  collect(orderRef: string, params?: Record<string, string>): Promise<SignatureResult>;
}

export interface CompanyInfo {
  orgNumber: string;
  name: string;
  city?: string;
  address?: { street?: string; postal_code?: string; city?: string };
  isSoleTrader: boolean;
  /** Personal numbers of signatories/board – hashed by the database, never stored in clear. */
  signatories: string[];
  source: "roaring" | "bolagsverket" | "mock";
}

export interface CompanyLookup {
  readonly name: "roaring" | "mock";
  lookup(orgNumber: string): Promise<CompanyInfo | null>;
}

export interface VehicleRegistrySnapshot {
  road_reg: string;
  vehicle_class: string;
  owner_category: "legal_person" | "natural_person" | "unknown";
  status: string;
  last_owner_change?: string;
  source: "transportstyrelsen" | "mock";
}

export interface VehicleRegistryLookup {
  readonly name: "transportstyrelsen" | "mock";
  /** Never returns personal data (owner names/numbers are dropped by the adapter). */
  lookup(roadReg: string): Promise<VehicleRegistrySnapshot | null>;
}

export interface TheftReport {
  regNumber: string;
  serial: string;
  make?: string;
  model?: string;
  policeReference?: string;
  reportedAt: string;
  status: "stolen" | "recovered";
}

export interface TheftRegistrySync {
  readonly name: "larmtjanst" | "mock";
  push(report: TheftReport): Promise<{ externalRef: string }>;
  /** Serials reported stolen in the external register since a timestamp. */
  pull(since: string): Promise<TheftReport[]>;
}

export interface NameplateSuggestion {
  make?: string;
  model?: string;
  serial?: string;
  pin?: string;
  year?: number;
  engine_serial?: string;
  weight_kg?: number;
  confidence: number; // 0..1
  field_confidence?: Record<string, number>;
}

export interface Ocr {
  readonly name: "anthropic" | "mock";
  nameplate(image: { base64: string; mediaType: string }): Promise<NameplateSuggestion>;
  /** Classifies a listing image and extracts a serial if it shows a nameplate. */
  listingImage(image: { base64: string; mediaType: string }): Promise<{ isNameplate: boolean; serial?: string; confidence: number }>;
  /** Suggests a column mapping for an import file (header + sample rows). */
  mapColumns(input: { headers: string[]; sample: string[][]; targets: string[] }): Promise<Record<string, string | null>>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; contentBase64: string; contentType: string }[];
}

export interface Email {
  readonly name: "resend" | "console";
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export interface VirusScanner {
  readonly name: "clamav" | "mock";
  scan(bytes: Uint8Array, filename: string): Promise<{ clean: boolean; signature?: string }>;
}

export interface Adapters {
  identity: IdentityProvider;
  signature: SignatureProvider;
  company: CompanyLookup;
  vehicleRegistry: VehicleRegistryLookup;
  theftRegistry: TheftRegistrySync;
  ocr: Ocr;
  email: Email;
  virusScanner: VirusScanner;
}
