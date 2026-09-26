/**
 * Mock-backend som körs helt i webbläsaren. Data sparas i localStorage så att
 * registreringar överlever en omladdning. Beter sig som Supabase-implementationen:
 * samma behörighetsregler, samma fel, samma historikrader.
 */
import { createSeed, DEMO_PASSWORD, type MockDatabase } from "../../data/seed";
import { formatDate } from "../format";
import { detectIdentifierKind, identifierKey } from "../identifier";
import * as perm from "../permissions";
import type { AdminUser, Machine, MachineRecord, Organization, RegisterEvent, RegisterExtract, UserProfile } from "../types";
import { ApiError, type MaskinIdApi } from "./types";

const DB_KEY = "maskinid.mock.db.v2";
const SESSION_KEY = "maskinid.mock.session.v1";
const LATENCY_MS = 250;

let memoryDb: MockDatabase | null = null;
let memorySession: string | null = null;
const listeners = new Set<(u: UserProfile | null) => void>();

function load(): MockDatabase {
  if (memoryDb) return memoryDb;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) memoryDb = JSON.parse(raw) as MockDatabase;
  } catch {
    /* localStorage otillgängligt – kör i minnet */
  }
  memoryDb ??= createSeed();
  return memoryDb;
}

function save(db: MockDatabase) {
  memoryDb = db;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* ignoreras */
  }
}

function getSessionUserId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY) ?? memorySession;
  } catch {
    return memorySession;
  }
}

function setSessionUserId(id: string | null) {
  memorySession = id;
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignoreras */
  }
}

/** Återställer exempeldatan (används av "Återställ demodata" och i tester). */
export function resetMockDatabase() {
  save(createSeed());
}

const delay = <T>(value: T): Promise<T> => new Promise((r) => setTimeout(() => r(value), LATENCY_MS));
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const nowIso = () => new Date().toISOString();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function toProfile(db: MockDatabase, userId: string | null): UserProfile | null {
  const u = db.users.find((x) => x.id === userId);
  if (!u) return null;
  const organization = db.organizations.find((o) => o.id === u.organizationId);
  if (!organization) return null;
  return { id: u.id, email: u.email, fullName: u.fullName, organization, isAdmin: u.isAdmin === true };
}

function toAdminUser(db: MockDatabase, userId: string): AdminUser {
  const u = db.users.find((x) => x.id === userId)!;
  return { ...toProfile(db, userId)!, lastSignInAt: u.lastSignInAt ?? null, invitedAt: u.invitedAt ?? null };
}

function requireAdmin(db: MockDatabase): UserProfile {
  const u = requireUser(db);
  if (!u.isAdmin) throw new ApiError("saknar_behorighet", "Bara administratörer kan göra den här ändringen.");
  return u;
}

function buildRecord(db: MockDatabase, machine: Machine, viewer: UserProfile | null): MachineRecord {
  const owner = db.ownerships.find((o) => o.machineId === machine.id && !o.until) ?? null;
  const events = db.events.filter((e) => e.machineId === machine.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const record: MachineRecord = {
    machine,
    owner,
    pledges: db.pledges.filter((p) => p.machineId === machine.id),
    insurances: db.insurances.filter((i) => i.machineId === machine.id),
    blocks: db.blocks.filter((b) => b.machineId === machine.id),
    lastUpdatedAt: machine.updatedAt,
    lastUpdatedBy: events[0]?.sourceName ?? "MaskinID",
  };
  // Samma regel som RLS i Supabase: belopp döljs för obehöriga.
  record.pledges = record.pledges.map((p) =>
    perm.canSeePledgeAmount(viewer, record, p) ? p : { ...p, amountSek: null, reference: null },
  );
  return clone(record);
}

function requireUser(db: MockDatabase): UserProfile {
  const u = toProfile(db, getSessionUserId());
  if (!u) throw new ApiError("ej_inloggad", "Du behöver logga in för att göra ändringar i registret.");
  return u;
}

function requireMachine(db: MockDatabase, machineId: string): Machine {
  const m = db.machines.find((x) => x.id === machineId);
  if (!m) throw new ApiError("hittades_inte", "Maskinen finns inte i registret.");
  return m;
}

function logEvent(db: MockDatabase, machine: Machine, kind: RegisterEvent["kind"], description: string, sourceName: string) {
  const at = nowIso();
  db.events.push({ id: uid("e"), machineId: machine.id, kind, description, sourceName, occurredAt: at });
  machine.updatedAt = at;
}

function forbidden(): never {
  throw new ApiError("saknar_behorighet", "Din organisation har inte behörighet att göra den här ändringen.");
}

export const mockApi: MaskinIdApi = {
  async getCurrentUser() {
    return delay(toProfile(load(), getSessionUserId()));
  },

  async requestSignInLink(email) {
    const db = load();
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) throw new ApiError("hittades_inte", `Det finns inget konto för ${email}. Kontrollera adressen.`);
    // Mock: logga in direkt i stället för att skicka e-post.
    setSessionUserId(user.id);
    const p = toProfile(db, user.id);
    listeners.forEach((l) => l(p));
    return delay(undefined);
  },

  async signInWithPassword(email, password) {
    const db = load();
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || password !== DEMO_PASSWORD) {
      await delay(null);
      throw new ApiError("ogiltig_inmatning", "Fel e-postadress eller lösenord.");
    }
    setSessionUserId(user.id);
    user.lastSignInAt = nowIso();
    save(db);
    const p = toProfile(db, user.id)!;
    listeners.forEach((l) => l(p));
    return delay(p);
  },

  async signOut() {
    setSessionUserId(null);
    listeners.forEach((l) => l(null));
    return delay(undefined);
  },

  onAuthChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },

  async lookupMachine(query) {
    const db = load();
    const key = identifierKey(query);
    const kind = detectIdentifierKind(query);
    const machine = db.machines.find((m) =>
      kind === "registernummer"
        ? identifierKey(m.registerNumber) === key
        : [m.pin, m.serialNumber, m.registerNumber].some((v) => v && identifierKey(v) === key),
    );
    if (!machine) return delay({ status: "ej_hittad" as const, query });
    return delay({ status: "hittad" as const, record: buildRecord(db, machine, toProfile(db, getSessionUserId())) });
  },

  async getMachineRecord(machineId) {
    const db = load();
    const m = db.machines.find((x) => x.id === machineId);
    return delay(m ? buildRecord(db, m, toProfile(db, getSessionUserId())) : null);
  },

  async getMachineHistory(machineId) {
    const db = load();
    return delay(
      clone(db.events.filter((e) => e.machineId === machineId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))),
    );
  },

  async listMyMachines() {
    const db = load();
    const u = requireUser(db);
    const org = u.organization.id;
    const ids = new Set<string>();
    db.ownerships.filter((o) => !o.until && o.ownerOrganizationId === org).forEach((o) => ids.add(o.machineId));
    db.pledges.filter((p) => !p.releasedAt && p.lenderOrganizationId === org).forEach((p) => ids.add(p.machineId));
    db.insurances.filter((i) => !i.cancelledAt && i.insurerOrganizationId === org).forEach((i) => ids.add(i.machineId));
    const records = db.machines.filter((m) => ids.has(m.id)).map((m) => buildRecord(db, m, u));
    records.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
    return delay(records);
  },

  async listOrganizations() {
    return delay(clone(load().organizations));
  },

  async registerMachine(input) {
    const db = load();
    const u = requireUser(db);
    if (!perm.canRegisterMachine(u)) forbidden();
    const keys = [input.pin, input.serialNumber].filter(Boolean).map((v) => identifierKey(v!));
    if (keys.length === 0) throw new ApiError("ogiltig_inmatning", "Ange PIN eller serienummer.");
    const dup = db.machines.find((m) => [m.pin, m.serialNumber].some((v) => v && keys.includes(identifierKey(v))));
    if (dup) throw new ApiError("finns_redan", `Maskinen är redan registrerad med registernummer ${dup.registerNumber}.`);

    const ownerOrg = db.organizations.find((o) => o.id === (input.ownerOrganizationId ?? u.organization.id));
    if (!ownerOrg) throw new ApiError("ogiltig_inmatning", "Välj en registrerad ägare.");

    db.counters.machine += 1;
    const at = nowIso();
    const machine: Machine = {
      id: uid("m"),
      registerNumber: `MID-${new Date().getFullYear()}-${String(db.counters.machine).padStart(7, "0")}`,
      pin: input.pin ? input.pin.toUpperCase() : null,
      serialNumber: input.serialNumber ? input.serialNumber.toUpperCase() : null,
      manufacturer: input.manufacturer,
      model: input.model,
      machineType: input.machineType,
      modelYear: input.modelYear,
      identityVerified: false,
      createdAt: at,
      updatedAt: at,
    };
    db.machines.push(machine);
    db.ownerships.push({ id: uid("o"), machineId: machine.id, ownerOrganizationId: ownerOrg.id, ownerName: ownerOrg.name, ownerOrgNr: ownerOrg.orgNr, since: at, until: null });
    logEvent(db, machine, "maskin_registrerad", "Maskinen registrerades i MaskinID.", u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async transferOwnership(input) {
    const db = load();
    const u = requireUser(db);
    const machine = requireMachine(db, input.machineId);
    if (!perm.canTransferOwnership(u, buildRecord(db, machine, u))) forbidden();
    const newOwner = db.organizations.find((o) => o.id === input.newOwnerOrganizationId);
    if (!newOwner) throw new ApiError("ogiltig_inmatning", "Välj en ny registrerad ägare.");
    const current = db.ownerships.find((o) => o.machineId === machine.id && !o.until);
    if (current?.ownerOrganizationId === newOwner.id) throw new ApiError("ogiltig_inmatning", "Organisationen är redan registrerad ägare.");
    if (current) current.until = input.effectiveFrom;
    db.ownerships.push({ id: uid("o"), machineId: machine.id, ownerOrganizationId: newOwner.id, ownerName: newOwner.name, ownerOrgNr: newOwner.orgNr, since: input.effectiveFrom, until: null });
    logEvent(db, machine, "agarbyte", `Ny registrerad ägare: ${newOwner.name}.`, u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async registerPledge(input) {
    const db = load();
    const u = requireUser(db);
    if (!perm.canRegisterPledge(u)) forbidden();
    const machine = requireMachine(db, input.machineId);
    if (db.pledges.some((p) => p.machineId === machine.id && !p.releasedAt && p.lenderOrganizationId === u.organization.id)) {
      throw new ApiError("finns_redan", "Din organisation har redan en registrerad belåning på maskinen.");
    }
    db.pledges.push({ id: uid("p"), machineId: machine.id, lenderOrganizationId: u.organization.id, lenderName: u.organization.name, reference: input.reference, amountSek: input.amountSek, registeredAt: nowIso(), releasedAt: null });
    logEvent(db, machine, "belaning_registrerad", "Belåning registrerad.", u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async releasePledge(pledgeId) {
    const db = load();
    const u = requireUser(db);
    const p = db.pledges.find((x) => x.id === pledgeId);
    if (!p) throw new ApiError("hittades_inte", "Belåningen finns inte.");
    if (!perm.canReleasePledge(u, p)) forbidden();
    p.releasedAt = nowIso();
    const machine = requireMachine(db, p.machineId);
    logEvent(db, machine, "belaning_avslutad", "Belåningen avslutades.", u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async registerInsurance(input) {
    const db = load();
    const u = requireUser(db);
    if (!perm.canRegisterInsurance(u)) forbidden();
    const machine = requireMachine(db, input.machineId);
    if (input.validTo <= input.validFrom) throw new ApiError("ogiltig_inmatning", "Slutdatum måste vara efter startdatum.");
    // En aktiv försäkring per maskin: tidigare försäkringar avslutas.
    db.insurances.filter((i) => i.machineId === machine.id && !i.cancelledAt).forEach((i) => (i.cancelledAt = nowIso()));
    db.insurances.push({ id: uid("i"), machineId: machine.id, insurerOrganizationId: u.organization.id, insurerName: u.organization.name, coverage: input.coverage, policyNumber: input.policyNumber, validFrom: input.validFrom, validTo: input.validTo, cancelledAt: null });
    logEvent(db, machine, "forsakring_registrerad", `${input.coverage} registrerad till ${formatDate(input.validTo)}.`, u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async reportBlock(input) {
    const db = load();
    const u = requireUser(db);
    const machine = requireMachine(db, input.machineId);
    if (!perm.canReportBlock(u, buildRecord(db, machine, u))) forbidden();
    db.blocks.push({ id: uid("b"), machineId: machine.id, reason: input.reason, description: input.description, policeReportNumber: input.policeReportNumber, reportedByOrganizationId: u.organization.id, reportedByName: u.organization.name, reportedAt: nowIso(), liftedAt: null });
    const text = input.reason === "stulen" ? "Maskinen anmäld stulen." : "Spärr registrerad.";
    logEvent(db, machine, "sparr_registrerad", input.policeReportNumber ? `${text} Polisens diarienummer ${input.policeReportNumber}.` : text, u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async liftBlock(blockId) {
    const db = load();
    const u = requireUser(db);
    const b = db.blocks.find((x) => x.id === blockId);
    if (!b) throw new ApiError("hittades_inte", "Spärren finns inte.");
    if (!perm.canLiftBlock(u, b)) forbidden();
    b.liftedAt = nowIso();
    const machine = requireMachine(db, b.machineId);
    logEvent(db, machine, "sparr_havd", "Spärren hävdes.", u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async issueExtract(machineId) {
    const db = load();
    const u = requireUser(db);
    const machine = requireMachine(db, machineId);
    db.counters.extract += 1;
    const d = new Date();
    const id = `RU-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${db.counters.extract}`;
    const extract: RegisterExtract = { id, machineId, issuedAt: nowIso(), issuedToName: u.organization.name, snapshot: buildRecord(db, machine, u) };
    db.extracts.push(extract);
    db.events.push({ id: uid("e"), machineId, kind: "utdrag_hamtat", description: `Registerutdrag ${id} hämtat.`, sourceName: u.organization.name, occurredAt: extract.issuedAt });
    save(db);
    return delay(clone(extract));
  },

  async getExtract(extractId) {
    const db = load();
    return delay(clone(db.extracts.find((x) => x.id === extractId.toUpperCase()) ?? null));
  },

  async verifyIdentity(machineId, note) {
    const db = load();
    const u = requireAdmin(db);
    const machine = requireMachine(db, machineId);
    if (machine.identityVerified) throw new ApiError("ogiltig_inmatning", "Identiteten är redan verifierad.");
    machine.identityVerified = true;
    logEvent(db, machine, "identitet_verifierad", `Identiteten verifierades mot typskylt.${note?.trim() ? ` ${note.trim()}` : ""}`, u.organization.name);
    save(db);
    return delay(buildRecord(db, machine, u));
  },

  async listUsers() {
    const db = load();
    requireAdmin(db);
    const users = db.users.map((u) => toAdminUser(db, u.id));
    users.sort((a, b) => a.organization.name.localeCompare(b.organization.name, "sv") || a.fullName.localeCompare(b.fullName, "sv"));
    return delay(users);
  },

  async createOrganization(input) {
    const db = load();
    requireAdmin(db);
    const name = input.name.trim();
    const orgNr = input.orgNr.trim();
    if (!name) throw new ApiError("ogiltig_inmatning", "Ange organisationens namn.");
    if (!/^\d{6}-\d{4}$/.test(orgNr)) throw new ApiError("ogiltig_inmatning", "Ange organisationsnumret som NNNNNN-NNNN.");
    if (db.organizations.some((o) => o.orgNr === orgNr)) {
      throw new ApiError("finns_redan", `Det finns redan en organisation med organisationsnummer ${orgNr}.`);
    }
    const org: Organization = { id: uid("org"), name, orgNr, type: input.type };
    db.organizations.push(org);
    save(db);
    return delay(clone(org));
  },

  async inviteUser(input) {
    const db = load();
    requireAdmin(db);
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError("ogiltig_inmatning", "Skriv en giltig e-postadress.");
    if (!input.fullName.trim()) throw new ApiError("ogiltig_inmatning", "Skriv användarens namn.");
    if (!db.organizations.some((o) => o.id === input.organizationId)) throw new ApiError("ogiltig_inmatning", "Välj en organisation.");
    if (db.users.some((u) => u.email === email)) throw new ApiError("finns_redan", `Det finns redan ett konto för ${email}.`);
    // Mock: ingen e-post skickas. Kontot kan logga in direkt med demolösenordet.
    const id = uid("u");
    db.users.push({ id, email, fullName: input.fullName.trim(), organizationId: input.organizationId, isAdmin: input.isAdmin, invitedAt: nowIso() });
    save(db);
    return delay(toAdminUser(db, id));
  },
};
