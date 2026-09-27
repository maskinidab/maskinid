/**
 * Telematics adapters (step 25, SPEC §7.8, ADR 0022). Volvo CareTrack, Komatsu Komtrax and Trackunit all offer the
 * ISO 15143-3 (AEMP 2.0) fleet snapshot, so one client covers them; the connection only differs in URL and credential.
 * Readings are normalised to hours + latest position and matched to machines by serial/PIN/VIN in the database.
 */
type FetchLike = typeof fetch;

export interface TelematicsReading {
  external_id: string;
  serial?: string;
  pin?: string;
  make?: string;
  model?: string;
  hours?: number;
  hours_at?: string;
  lat?: number;
  lon?: number;
  position_at?: string;
}

export type TelematicsCredential =
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | { type: "oauth"; token_url: string; client_id: string; client_secret: string; scope?: string };

export interface TelematicsConnection {
  provider: "caretrack" | "komtrax" | "trackunit" | "iso15143" | "mock";
  base_url: string | null;
  credential: TelematicsCredential | null;
  /** For the mock: the org's machines, so demo readings match them. */
  machines?: { machine_id: string; serial: string | null; hour_meter: number | null }[];
}

export interface TelematicsProvider {
  readonly name: "iso15143" | "mock";
  fetch(conn: TelematicsConnection): Promise<TelematicsReading[]>;
}

const MAX_PAGES = 50;

async function authHeader(cred: TelematicsCredential | null, f: FetchLike): Promise<Record<string, string>> {
  if (!cred) return {};
  if (cred.type === "basic") return { Authorization: `Basic ${btoa(`${cred.username}:${cred.password}`)}` };
  if (cred.type === "bearer") return { Authorization: `Bearer ${cred.token}` };
  if (!/^https:\/\//.test(cred.token_url)) throw new Error("token_url must be https");
  const res = await f(cred.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cred.client_id, client_secret: cred.client_secret,
      ...(cred.scope ? { scope: cred.scope } : {}) }).toString(),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("token missing");
  return { Authorization: `Bearer ${j.access_token}` };
}

type Aemp = {
  Links?: { rel: string; href: string }[];
  Equipment?: {
    EquipmentHeader?: { OEMName?: string; Model?: string; EquipmentID?: string; SerialNumber?: string; PIN?: string };
    Location?: { datetime?: string; Latitude?: number | string; Longitude?: number | string };
    CumulativeOperatingHours?: { datetime?: string; Hour?: number | string };
  }[];
};

/** Normalises one ISO 15143-3 fleet page (with or without the "Fleet" wrapper). */
export function parseAempPage(json: unknown): { readings: TelematicsReading[]; next: string | null } {
  const fleet = ((json as { Fleet?: Aemp })?.Fleet ?? json) as Aemp;
  const readings: TelematicsReading[] = [];
  for (const e of fleet.Equipment ?? []) {
    const h = e.EquipmentHeader ?? {};
    const id = h.EquipmentID ?? h.SerialNumber ?? h.PIN;
    if (!id) continue;
    const num = (v: unknown) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
    const lat = num(e.Location?.Latitude);
    const lon = num(e.Location?.Longitude);
    readings.push({
      external_id: String(id), serial: h.SerialNumber, pin: h.PIN, make: h.OEMName, model: h.Model,
      hours: num(e.CumulativeOperatingHours?.Hour), hours_at: e.CumulativeOperatingHours?.datetime,
      ...(lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
        ? { lat, lon, position_at: e.Location?.datetime } : {}),
    });
  }
  const next = fleet.Links?.find((l) => l.rel.toLowerCase() === "next")?.href ?? null;
  return { readings, next };
}

export function createIso15143Provider(opts: { fetch?: FetchLike } = {}): TelematicsProvider {
  const f = opts.fetch ?? fetch;
  return {
    name: "iso15143",
    async fetch(conn) {
      if (!conn.base_url || !/^https:\/\//.test(conn.base_url)) throw new Error("base_url must be https");
      const origin = new URL(conn.base_url).origin;
      const headers = { Accept: "application/json", ...(await authHeader(conn.credential, f)) };
      const out: TelematicsReading[] = [];
      let url: string | null = `${conn.base_url.replace(/\/$/, "")}/Fleet/1`;
      for (let page = 0; url && page < MAX_PAGES; page++) {
        // Follow pagination only on the provider's own origin (never send the credential elsewhere).
        if (new URL(url, origin).origin !== origin) break;
        const res: Response = await f(new URL(url, origin).href, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const p = parseAempPage(await res.json());
        out.push(...p.readings);
        url = p.next;
      }
      return out;
    },
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Mock: the org's own machines report a few more hours each day and a position somewhere in southern Sweden. */
export function createMockTelematics(now: () => Date = () => new Date()): TelematicsProvider {
  return {
    name: "mock",
    async fetch(conn) {
      const day = Math.floor(now().getTime() / 86_400_000);
      return (conn.machines ?? []).filter((m) => m.serial).map((m) => {
        const h = hash(m.serial!);
        return {
          external_id: `MOCK-${m.serial}`, serial: m.serial!, hours: (m.hour_meter ?? 0) + 1 + ((h + day) % 7),
          hours_at: now().toISOString().slice(0, 10),
          lat: Math.round((55.6 + (h % 1000) / 1000 * 4.2) * 10000) / 10000, lon: Math.round((12.8 + ((h >> 10) % 1000) / 1000 * 5.8) * 10000) / 10000,
          position_at: now().toISOString(),
        };
      });
    },
  };
}

/** Provider for a connection: the mock only for mock connections (DEMO_MODE), otherwise the ISO 15143-3 client. */
export function telematicsFor(conn: Pick<TelematicsConnection, "provider">, opts: { fetch?: FetchLike } = {}): TelematicsProvider {
  return conn.provider === "mock" ? createMockTelematics() : createIso15143Provider(opts);
}
