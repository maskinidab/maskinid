// Shapes returned by the RPCs (jsonb). Only the fields the UI uses are typed; everything else stays `unknown`.
export type OrgType = "operator" | "dealer" | "owner" | "financier" | "insurer" | "authority" | "inspector" | "marketplace" | "manufacturer" | "client";
export type MemberRole = "admin" | "member" | "readonly";
export type MachineStatus = "draft" | "active" | "stolen" | "blocked" | "disputed" | "scrapped" | "exported" | "deregistered";
export type Level = 0 | 1 | 2;

export interface OrgBrief {
  id: string;
  name: string;
  slug: string;
  org_number: string | null;
  is_sole_trader: boolean;
  types: OrgType[];
  status: "pending" | "approved" | "suspended";
  city: string | null;
}

export interface Membership {
  membership_id: string;
  role: MemberRole;
  org: OrgBrief;
  effective_types: OrgType[];
  min_trusted_level: number;
}

export interface MyContext {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  locale: "sv" | "en";
  identity_verified_at: string | null;
  identity_provider: "bankid" | "mock" | null;
  last_active_org_id: string | null;
  operator_role: "superadmin" | "verifier" | "support" | null;
  memberships: Membership[];
  pending_invites: { membership_id: string; org: OrgBrief; role: MemberRole }[];
  unread_notifications: number;
  demo_mode: boolean;
}

export interface Identifier {
  id?: string;
  type: string;
  value: string;
  verified?: boolean;
  source?: string;
  external_system?: string | null;
  vtr_snapshot?: Record<string, unknown> | null;
  in_conflict?: boolean;
}

export interface Encumbrance {
  id: string;
  type: "ownership_reservation" | "leasing" | "rental" | "other";
  status: string;
  start_date: string;
  end_date: string | null;
  holder: { id: string; name: string };
  contract_ref?: string | null;
  counterparty?: OrgBrief | null;
  confirmed_at?: string | null;
  released_at?: string | null;
  created_at: string;
}

export interface Flag {
  id?: string;
  type: string;
  status: string;
  raised_at: string;
  reference?: string | null;
  description?: string | null;
  raised_by?: string | null;
  can_clear?: boolean;
  occurred_at?: string | null;
  location_text?: string | null;
}

export interface Technical {
  service_weight_kg: number | null;
  engine_power_kw: number | null;
  power_standard: string | null;
  has_lifting_device: boolean;
  fuel_type: string | null;
  electric_config: string | null;
  emission_stage: string | null;
  engine_make: string | null;
  engine_model: string | null;
  engine_type_approval_no: string | null;
  ce_marked: boolean | null;
  registration_liable: boolean;
}

export interface MachineView {
  id: string;
  reg_number: string;
  status: MachineStatus;
  verification_level: Level;
  verification_method: string | null;
  verified_at: string | null;
  verified_by: string | null;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  category: string;
  color: string | null;
  description: string | null;
  technical: Technical;
  registration_type: "permanent" | "temporary";
  valid_until: string | null;
  origin_country: string | null;
  origin: string;
  hour_meter: number | null;
  hour_meter_updated_at: string | null;
  primary_photo_path: string | null;
  deregistered_at: string | null;
  deregistration_reason: string | null;
  stock_status: string | null;
  created_at: string;
  updated_at: string;
  relations: string[];
  access: "full" | "previous_owner" | "partner" | "basic";
  owner: OrgBrief | null;
  user_org: OrgBrief | null;
  registered_by: OrgBrief | null;
  owner_ordinal: number;
  identifiers: Identifier[];
  labels: { id: string; code: string; status: string; role: string; bound_at: string | null; serial: string }[] | { has_bound_label: boolean };
  financing?: { has_active: boolean; active: Encumbrance | null; min_trusted_level: number };
  encumbrances?: Encumbrance[];
  flags: Flag[];
  last_transfer_date: string | null;
  open_transfer?: Transfer | null;
  [extra: string]: unknown;
}

export interface MachineListItem {
  id: string;
  reg_number: string;
  status: MachineStatus;
  verification_level: Level;
  make: string;
  model: string;
  year: number | null;
  category: string;
  hour_meter: number | null;
  primary_photo_path: string | null;
  owner_org_id: string;
  stock_status: string | null;
  serial: string | null;
  emission_stage: string | null;
  fuel_type: string | null;
  service_weight_kg: number | null;
  engine_power_kw: number | null;
  has_active_financing: boolean;
  active_flags: string[];
  open_transfer_status: string | null;
  updated_at: string;
  [extra: string]: unknown;
}

export interface PublicCard {
  reg_number: string;
  make: string;
  model: string;
  year: number | null;
  category: string;
  primary_photo_path: string | null;
  status: MachineStatus;
  verification_level: Level;
  serial_masked: string;
  has_registered_owner: boolean;
  label_status: "bound" | "replaced" | "unbound" | null;
  inspection_valid_until: string | null;
}

export interface Transfer {
  id: string;
  machine_id: string;
  reg_number: string;
  from: OrgBrief | null;
  to: OrgBrief | null;
  to_email: string | null;
  to_org_number: string | null;
  sale_date: string;
  effective_date: string;
  status: string;
  is_trade_in: boolean;
  financier_decision: string | null;
  expires_at: string;
  existing_encumbrance: { id: string; type: string; holder: { id: string; name: string } } | null;
  new_financing: Record<string, unknown> | null;
  created_at: string;
}

export interface HistoryEvent {
  seq: number;
  id: string;
  type: string;
  category: string;
  created_at: string;
  actor_type: "user" | "system" | "api";
  actor_org: { id: string; name: string } | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
}

export interface NotificationItem {
  id: string;
  org_id: string | null;
  type: string;
  title: string | null;
  body: string | null;
  data: Record<string, unknown>;
  link: string | null;
  severity: "info" | "warning" | "critical";
  read_at: string | null;
  created_at: string;
}

export interface InboxItem {
  kind: string;
  id: string;
  created_at: string;
  [k: string]: unknown;
}

export interface DocumentItem {
  id: string;
  machine_id: string | null;
  type: string;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  visibility: string;
  status: string;
  generated: boolean;
  uploaded_by: string;
  org_id: string;
  created_at: string;
}
