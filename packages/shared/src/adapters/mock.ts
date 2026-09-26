import { normalizeOrgNumber, isSoleTraderNumber } from "../identifiers.ts";
import type {
  CompanyLookup, Email, IdentityProvider, Ocr, SignatureProvider, TheftRegistrySync, VehicleRegistryLookup,
  TheftReport,
} from "./types.ts";

/** Demo-BankID: always succeeds with a deterministic fake personal number derived from the state. */
export const mockIdentity: IdentityProvider = {
  name: "mock",
  async start({ redirectUri, state }) {
    return { url: `${redirectUri}?code=demo-${encodeURIComponent(state)}&state=${encodeURIComponent(state)}` };
  },
  async complete({ code }) {
    return { personalNumber: `demo-${code}`, givenName: "Demo", surname: "Användare", provider: "mock", evidence: { demo: true } };
  },
};

export const mockSignature: SignatureProvider = {
  name: "mock",
  async start({ redirectUri, state }) {
    const orderRef = `demo-${state}`;
    return { url: `${redirectUri}?orderRef=${orderRef}`, orderRef };
  },
  async collect(orderRef) {
    return { provider: "mock", status: "completed", evidence: { demo: true, orderRef, at: new Date().toISOString() } };
  },
};

const CITIES = ["Stockholm", "Göteborg", "Malmö", "Uppsala", "Umeå", "Luleå", "Örebro", "Linköping", "Västerås", "Jönköping"];

/** Mirrors app.mock_company_lookup() in SQL so client and database agree in DEMO_MODE. */
export const mockCompanyLookup: CompanyLookup = {
  name: "mock",
  async lookup(orgNumber) {
    const n = normalizeOrgNumber(orgNumber);
    if (!n) return null;
    const city = CITIES[Number(n[9]) % 10]!;
    if (isSoleTraderNumber(n)) {
      return { orgNumber: n, name: `Enskild firma ${n.slice(7, 10)}`, city, address: { city }, isSoleTrader: true, signatories: [n], source: "mock" };
    }
    return {
      orgNumber: n,
      name: `Demoföretag ${n.slice(0, 6)} AB`,
      city,
      address: { street: `Industrivägen ${n.slice(8, 10)}`, postal_code: `${n.slice(0, 3)} ${n.slice(3, 5)}`, city },
      isSoleTrader: false,
      signatories: [],
      source: "mock",
    };
  },
};

/** Mirrors app.mock_vtr_lookup(). */
export const mockVehicleRegistry: VehicleRegistryLookup = {
  name: "mock",
  async lookup(roadReg) {
    const r = roadReg.toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z]{3}[0-9]{2}[0-9A-Z]$/.test(r)) return null;
    const c = r.charCodeAt(r.length - 1);
    const d = new Date(Date.UTC(2020, 0, 1) + c * 7 * 86400000).toISOString().slice(0, 10);
    return {
      road_reg: r,
      vehicle_class: c % 3 === 0 ? "traktor_b" : "motorredskap_klass_i",
      owner_category: c % 2 === 0 ? "legal_person" : "natural_person",
      status: "in_traffic",
      last_owner_change: d,
      source: "mock",
    };
  },
};

export function createMockTheftRegistry(): TheftRegistrySync {
  const store: TheftReport[] = [];
  return {
    name: "mock",
    async push(report) {
      store.push(report);
      return { externalRef: `LT-DEMO-${store.length.toString().padStart(6, "0")}` };
    },
    async pull(since) {
      return store.filter((r) => r.reportedAt >= since);
    },
  };
}

/**
 * Mock OCR. The demo nameplate photos embed their text in the file name or in a data URL comment
 * ("nameplate:make=Volvo;model=EC220E;serial=…"), otherwise a fixed plausible suggestion is returned.
 */
export const mockOcr: Ocr = {
  name: "mock",
  async nameplate(image) {
    const hint = decodeHint(image.base64);
    if (hint) return { ...hint, confidence: 0.97 };
    return { make: "Volvo", model: "EC220E", serial: "VCEC220EV00123K7", year: 2021, weight_kg: 22500, confidence: 0.91 };
  },
  async listingImage(image) {
    const hint = decodeHint(image.base64);
    if (hint?.serial) return { isNameplate: true, serial: String(hint.serial), confidence: 0.93 };
    return { isNameplate: false, confidence: 0.9 };
  },
  async mapColumns({ headers, targets }) {
    return heuristicColumnMapping(headers, targets);
  },
};

function decodeHint(base64: string): Record<string, string | number> | null {
  let text = "";
  try {
    text = typeof atob === "function" ? atob(base64.slice(0, 4096)) : "";
  } catch {
    return null;
  }
  const m = text.match(/nameplate:([^\n\0]*)/);
  if (!m) return null;
  const out: Record<string, string | number> = {};
  for (const part of m[1]!.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.trim()] = k.trim() === "year" || k.trim() === "weight_kg" ? Number(v) : v.trim();
  }
  return out;
}

const SYNONYMS: Record<string, string[]> = {
  serial: ["serial", "serienummer", "serienr", "sn", "s/n", "tillverkningsnummer", "chassinummer"],
  pin: ["pin", "product identification number", "pin-nummer"],
  vin: ["vin"],
  road_reg: ["regnr", "registreringsnummer", "reg.nr", "reg nr", "road_reg"],
  make: ["make", "fabrikat", "märke", "tillverkare", "brand"],
  model: ["model", "modell", "typ"],
  year: ["year", "år", "årsmodell", "tillverkningsår", "modellår"],
  category: ["category", "kategori", "maskintyp", "typ av maskin"],
  hour_meter: ["hours", "timmar", "drifttimmar", "timmätare", "h"],
  owner_org_number: ["orgnr", "organisationsnummer", "kundens orgnr", "ägare orgnr", "owner_org_number"],
  contract_ref: ["avtal", "avtalsnummer", "kontrakt", "contract", "contract_ref"],
  encumbrance_type: ["finansieringstyp", "avtalstyp", "encumbrance_type"],
  start_date: ["startdatum", "start", "start_date"],
  end_date: ["slutdatum", "slut", "end_date"],
  color: ["färg", "color"],
  description: ["beskrivning", "notering", "description", "kommentar"],
};

/** Deterministic header matching used by the mock and as the fallback when AI mapping is unavailable. */
export function heuristicColumnMapping(headers: string[], targets: string[]): Record<string, string | null> {
  const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  const result: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const target of targets) {
    const syn = (SYNONYMS[target] ?? [target]).map(norm);
    const hit = headers.find((h) => !used.has(h) && syn.includes(norm(h)))
      ?? headers.find((h) => !used.has(h) && syn.some((s) => norm(h).includes(s) && s.length > 2));
    result[target] = hit ?? null;
    if (hit) used.add(hit);
  }
  return result;
}

export function createConsoleEmail(log: (msg: string) => void = console.log): Email & { sent: { to: string; subject: string }[] } {
  const sent: { to: string; subject: string }[] = [];
  return {
    name: "console",
    sent,
    async send(msg) {
      sent.push({ to: msg.to, subject: msg.subject });
      log(`[email] to=${msg.to} subject=${msg.subject}`);
      return { id: `console-${sent.length}` };
    },
  };
}
