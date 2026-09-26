/**
 * Supabase-implementationen av MaskinIdApi.
 *
 * All läsning av registerposter och alla skrivningar går via RPC-funktioner
 * (security definer) i supabase/migrations/0001_initial_schema.sql. Funktionerna
 * kontrollerar behörighet, skriver historik och returnerar JSON i samma form som
 * typerna i src/lib/types.ts – därför behövs ingen mappning här.
 *
 * Se docs/BACKEND.md för kontraktet per funktion.
 */
import type { AuthError, PostgrestError, User } from "@supabase/supabase-js";
import { normalizeIdentifier } from "../identifier";
import { getSupabase } from "../supabaseClient";
import type { AdminUser, MachineRecord, Organization, RegisterEvent, RegisterExtract, UserProfile } from "../types";
import { ApiError, type ApiErrorCode, type MaskinIdApi } from "./types";

/** Felkoder som RPC-funktionerna kastar med `raise exception using errcode = ...`. */
const PG_ERROR_MAP: Record<string, ApiErrorCode> = {
  "28000": "ej_inloggad",
  "42501": "saknar_behorighet",
  P0002: "hittades_inte",
  "23505": "finns_redan",
  "22023": "ogiltig_inmatning",
};

function toApiError(error: PostgrestError | AuthError): ApiError {
  const code = "code" in error && error.code ? PG_ERROR_MAP[error.code] : undefined;
  if (code) return new ApiError(code, error.message);
  if (error.message?.toLowerCase().includes("fetch")) {
    return new ApiError("natverksfel", "Det gick inte att nå registret. Kontrollera anslutningen och försök igen.");
  }
  return new ApiError("okant", "Något gick fel. Försök igen om en stund.");
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw toApiError(error);
  return data as T;
}

async function loadProfile(user: User | null): Promise<UserProfile | null> {
  if (!user) return null;
  // `my_profile` returnerar { id, email, fullName, organization } för auth.uid().
  const profile = await rpc<UserProfile | null>("my_profile");
  return profile;
}

export const supabaseApi: MaskinIdApi = {
  async getCurrentUser() {
    const { data } = await getSupabase().auth.getUser();
    return loadProfile(data.user);
  },

  async requestSignInLink(email) {
    const { error } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/mina-sidor`, shouldCreateUser: false },
    });
    if (error) throw toApiError(error);
  },

  async signInWithPassword(email, password) {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new ApiError("ogiltig_inmatning", "Fel e-postadress eller lösenord.");
    const profile = await loadProfile(data.user);
    if (!profile) throw new ApiError("saknar_behorighet", "Kontot är inte kopplat till någon organisation ännu.");
    return profile;
  },

  async signOut() {
    const { error } = await getSupabase().auth.signOut();
    if (error) throw toApiError(error);
  },

  onAuthChange(callback) {
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      // Anropa inte Supabase synkront inifrån callbacken (rekommendation i supabase-js).
      setTimeout(() => {
        loadProfile(session?.user ?? null).then(callback, () => callback(null));
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  },

  async lookupMachine(query) {
    const record = await rpc<MachineRecord | null>("lookup_machine", { q: normalizeIdentifier(query) });
    return record ? { status: "hittad", record } : { status: "ej_hittad", query };
  },

  getMachineRecord: (machineId) => rpc<MachineRecord | null>("get_machine_record", { p_machine_id: machineId }),

  getMachineHistory: (machineId) => rpc<RegisterEvent[]>("get_machine_history", { p_machine_id: machineId }),

  listMyMachines: () => rpc<MachineRecord[]>("list_my_machines"),

  async listOrganizations() {
    const { data, error } = await getSupabase()
      .from("organizations")
      .select("id, name, orgNr:org_nr, type")
      .order("name");
    if (error) throw toApiError(error);
    return data as Organization[];
  },

  registerMachine: (i) =>
    rpc<MachineRecord>("register_machine", {
      p_pin: i.pin,
      p_serial_number: i.serialNumber,
      p_manufacturer: i.manufacturer,
      p_model: i.model,
      p_machine_type: i.machineType,
      p_model_year: i.modelYear,
      p_owner_organization_id: i.ownerOrganizationId ?? null,
    }),

  transferOwnership: (i) =>
    rpc<MachineRecord>("transfer_ownership", {
      p_machine_id: i.machineId,
      p_new_owner_organization_id: i.newOwnerOrganizationId,
      p_effective_from: i.effectiveFrom,
    }),

  registerPledge: (i) =>
    rpc<MachineRecord>("register_pledge", { p_machine_id: i.machineId, p_reference: i.reference, p_amount_sek: i.amountSek }),

  releasePledge: (pledgeId) => rpc<MachineRecord>("release_pledge", { p_pledge_id: pledgeId }),

  registerInsurance: (i) =>
    rpc<MachineRecord>("register_insurance", {
      p_machine_id: i.machineId,
      p_coverage: i.coverage,
      p_policy_number: i.policyNumber,
      p_valid_from: i.validFrom,
      p_valid_to: i.validTo,
    }),

  reportBlock: (i) =>
    rpc<MachineRecord>("report_block", {
      p_machine_id: i.machineId,
      p_reason: i.reason,
      p_description: i.description,
      p_police_report_number: i.policeReportNumber,
    }),

  liftBlock: (blockId) => rpc<MachineRecord>("lift_block", { p_block_id: blockId }),

  issueExtract: (machineId) => rpc<RegisterExtract>("issue_extract", { p_machine_id: machineId }),

  getExtract: (extractId) => rpc<RegisterExtract | null>("get_extract", { p_extract_id: extractId }),

  verifyIdentity: (machineId, note) => rpc<MachineRecord>("verify_identity", { p_machine_id: machineId, p_note: note }),

  listUsers: () => rpc<AdminUser[]>("admin_list_users"),

  createOrganization: (i) =>
    rpc<Organization>("admin_create_organization", { p_name: i.name, p_org_nr: i.orgNr, p_type: i.type }),

  async inviteUser(input) {
    const { data, error } = await getSupabase().functions.invoke<AdminUser>("invite-user", { body: input });
    if (error) {
      // FunctionsHttpError bär svaret från funktionen: { code, message }.
      const ctx = (error as { context?: Response }).context;
      const body = ctx ? await ctx.json().catch(() => null) : null;
      if (body?.code && body?.message) throw new ApiError(body.code as ApiErrorCode, body.message);
      throw new ApiError("okant", "Inbjudan kunde inte skickas. Försök igen.");
    }
    return data as AdminUser;
  },
};
