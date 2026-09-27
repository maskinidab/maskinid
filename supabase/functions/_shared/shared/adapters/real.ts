/**
 * Production adapters. They are thin, dependency-free clients (fetch + Web Crypto) configured from environment
 * variables by the Edge Functions. Endpoints that depend on a partner agreement (Transportstyrelsen, Larmtjänst) are
 * configurable rather than hard-coded; see docs/runbooks/integrations.md.
 */
import { normalizeOrgNumber, isSoleTraderNumber } from "../identifiers.ts";
import type {
  CompanyLookup, Email, IdentityProvider, IdentityResult, SignatureProvider, TheftRegistrySync, VehicleRegistryLookup, VirusScanner,
} from "./types.ts";

type FetchLike = typeof fetch;

// ---------- JWT (RS256) verification for OIDC id_tokens ----------
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function verifyIdToken(
  token: string,
  opts: { jwksUrl: string; issuer: string; audience: string; nonce: string; fetch?: FetchLike; now?: number },
): Promise<Record<string, unknown>> {
  const f = opts.fetch ?? fetch;
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) throw new Error("malformed id_token");
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as Record<string, unknown>;
  if (header.alg !== "RS256") throw new Error("unsupported alg");
  const jwks = (await (await f(opts.jwksUrl)).json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig) as BufferSource, new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (payload.iss !== opts.issuer) throw new Error("bad issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(opts.audience)) throw new Error("bad audience");
  if (typeof payload.exp !== "number" || payload.exp < now - 60) throw new Error("expired");
  if (payload.nonce !== opts.nonce) throw new Error("bad nonce");
  return payload;
}

// ---------- BankID via an OIDC broker (Criipto Verify or Signicat) ----------
export interface OidcBrokerConfig {
  domain: string; // e.g. maskinid.criipto.id
  clientId: string;
  clientSecret: string;
  acrValues?: string; // default Swedish BankID same device
  fetch?: FetchLike;
}

function oidcAuthorizeUrl(cfg: OidcBrokerConfig, p: { redirectUri: string; state: string; nonce: string; loginHint?: string }) {
  const u = new URL(`https://${cfg.domain}/oauth2/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", "openid");
  u.searchParams.set("acr_values", cfg.acrValues ?? "urn:grn:authn:se:bankid:same-device");
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  if (p.loginHint) u.searchParams.set("login_hint", p.loginHint);
  return u.toString();
}

async function oidcExchange(cfg: OidcBrokerConfig, code: string, redirectUri: string, nonce: string) {
  const f = cfg.fetch ?? fetch;
  const res = await f(`https://${cfg.domain}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`)}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const body = (await res.json()) as { id_token: string };
  return verifyIdToken(body.id_token, {
    jwksUrl: `https://${cfg.domain}/.well-known/jwks`,
    issuer: `https://${cfg.domain}`,
    audience: cfg.clientId,
    nonce,
    fetch: f,
  });
}

function personalNumberFromClaims(c: Record<string, unknown>): string {
  const pn = (c.ssn ?? c.socialno ?? c.personal_number ?? c["https://criipto.com/claims/ssn"]) as string | undefined;
  if (!pn) throw new Error("no personal number in id_token");
  return pn;
}

export function createBankIdIdentity(cfg: OidcBrokerConfig): IdentityProvider {
  return {
    name: "bankid",
    async start({ redirectUri, state, nonce }) {
      return { url: oidcAuthorizeUrl(cfg, { redirectUri, state, nonce }) };
    },
    async complete({ code, redirectUri, nonce }): Promise<IdentityResult> {
      const claims = await oidcExchange(cfg, code, redirectUri, nonce);
      return {
        personalNumber: personalNumberFromClaims(claims),
        givenName: claims.given_name as string | undefined,
        surname: claims.family_name as string | undefined,
        provider: "bankid",
        // Evidence without the personal number (stored by the database).
        evidence: { iss: claims.iss, sub: claims.sub, iat: claims.iat, acr: claims.acr, identityscheme: claims.identityscheme },
      };
    },
  };
}

/** BankID signing through the broker: the text to sign is passed as login_hint "message:<base64>" with action sign. */
export function createBankIdSignature(cfg: OidcBrokerConfig): SignatureProvider {
  return {
    name: "bankid",
    async start({ signedText, redirectUri, state }) {
      const message = btoa(String.fromCharCode(...new TextEncoder().encode(signedText)));
      const url = oidcAuthorizeUrl(cfg, { redirectUri, state, nonce: state, loginHint: `action:sign message:${message}` });
      return { url, orderRef: state };
    },
    async collect(orderRef, params) {
      if (!params?.code || !params.redirectUri) return { provider: "bankid", status: "failed", evidence: { reason: "missing_code" } };
      try {
        const claims = await oidcExchange(cfg, params.code, params.redirectUri, orderRef);
        return {
          provider: "bankid",
          status: "completed",
          personalNumber: personalNumberFromClaims(claims),
          evidence: { iss: claims.iss, sub: claims.sub, iat: claims.iat, acr: claims.acr, signature: claims.signature ?? null },
        };
      } catch (e) {
        return { provider: "bankid", status: "failed", evidence: { reason: String(e) } };
      }
    },
  };
}

// ---------- Roaring company lookup ----------
export interface RoaringConfig { clientId: string; clientSecret: string; baseUrl?: string; fetch?: FetchLike }

export function createRoaringLookup(cfg: RoaringConfig): CompanyLookup {
  const base = cfg.baseUrl ?? "https://api.roaring.io";
  const f = cfg.fetch ?? fetch;
  let token: { value: string; exp: number } | null = null;
  async function auth() {
    if (token && token.exp > Date.now() + 30_000) return token.value;
    const res = await f(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}` },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    if (!res.ok) throw new Error(`roaring token ${res.status}`);
    const b = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: b.access_token, exp: Date.now() + b.expires_in * 1000 };
    return token.value;
  }
  return {
    name: "roaring",
    async lookup(orgNumber) {
      const n = normalizeOrgNumber(orgNumber);
      if (!n) return null;
      const digits = n.replace("-", "");
      const headers = { Authorization: `Bearer ${await auth()}` };
      const ov = await f(`${base}/se/company/overview/2.0/${digits}`, { headers });
      if (ov.status === 404) return null;
      if (!ov.ok) throw new Error(`roaring overview ${ov.status}`);
      const o = (await ov.json()) as Record<string, any>;
      const rec = (o.records?.[0] ?? o) as Record<string, any>;
      const board = await f(`${base}/se/company/board-members/2.0/${digits}`, { headers });
      const members = board.ok ? (((await board.json()) as any).records ?? []) : [];
      const signatories = members
        .map((m: any) => m.personalNumber ?? m.roleHolderPersonalNumber ?? m.idNumber)
        .filter((x: unknown): x is string => typeof x === "string");
      const city = rec.visitingAddress?.city ?? rec.postalAddress?.city ?? rec.city;
      return {
        orgNumber: n,
        name: rec.companyName ?? rec.name,
        city,
        address: { street: rec.address ?? rec.postalAddress?.street, postal_code: rec.zipCode ?? rec.postalAddress?.zipCode, city },
        isSoleTrader: isSoleTraderNumber(n) || rec.legalGroupCode === "EF",
        signatories: isSoleTraderNumber(n) ? [digits] : signatories,
        source: "roaring",
      };
    },
  };
}

// ---------- Transportstyrelsen (vehicle register) ----------
export interface VtrConfig { url: string; token: string; fetch?: FetchLike }

export function createTransportstyrelsenLookup(cfg: VtrConfig): VehicleRegistryLookup {
  const f = cfg.fetch ?? fetch;
  return {
    name: "transportstyrelsen",
    async lookup(roadReg) {
      const r = roadReg.toUpperCase().replace(/\s/g, "");
      const res = await f(`${cfg.url.replace(/\/$/, "")}/${encodeURIComponent(r)}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`vtr ${res.status}`);
      const b = (await res.json()) as Record<string, any>;
      const ownerKind = String(b.ownerCategory ?? b.agarkategori ?? "").toLowerCase();
      // Personal data (owner name/number/address) is intentionally not mapped (SPEC §4.2).
      return {
        road_reg: r,
        vehicle_class: String(b.vehicleClass ?? b.fordonsslag ?? "unknown"),
        owner_category: ownerKind.includes("jur") || ownerKind.includes("legal") ? "legal_person"
          : ownerKind.includes("fys") || ownerKind.includes("natural") ? "natural_person" : "unknown",
        status: String(b.status ?? b.fordonsstatus ?? "unknown"),
        last_owner_change: b.lastOwnerChange ?? b.senasteAgarbyte,
        source: "transportstyrelsen",
      };
    },
  };
}

// ---------- Larmtjänst (theft register) ----------
export interface LarmtjanstConfig { url: string; apiKey: string; fetch?: FetchLike }

export function createLarmtjanstSync(cfg: LarmtjanstConfig): TheftRegistrySync {
  const f = cfg.fetch ?? fetch;
  const base = cfg.url.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey };
  return {
    name: "larmtjanst",
    async push(report) {
      const res = await f(`${base}/reports`, { method: "POST", headers, body: JSON.stringify(report) });
      if (!res.ok) throw new Error(`larmtjanst ${res.status}`);
      const b = (await res.json()) as { reference?: string; id?: string };
      return { externalRef: b.reference ?? b.id ?? "" };
    },
    async pull(since) {
      const res = await f(`${base}/reports?since=${encodeURIComponent(since)}`, { headers });
      if (!res.ok) throw new Error(`larmtjanst ${res.status}`);
      return (await res.json()) as any[];
    },
  };
}

// ---------- Resend (e-mail) ----------
export interface ResendConfig { apiKey: string; from: string; fetch?: FetchLike }

export function createResendEmail(cfg: ResendConfig): Email {
  const f = cfg.fetch ?? fetch;
  return {
    name: "resend",
    async send(msg) {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: cfg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.contentBase64, content_type: a.contentType })),
        }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
      return (await res.json()) as { id: string };
    },
  };
}

// ---------- ClamAV over HTTP (e.g. a clamav-rest container next to the database) ----------
export interface ClamAvConfig { url: string; token?: string; fetch?: FetchLike }

export function createClamAvScanner(cfg: ClamAvConfig): VirusScanner {
  const f = cfg.fetch ?? fetch;
  return {
    name: "clamav",
    async scan(bytes, filename) {
      const form = new FormData();
      form.append("file", new Blob([bytes as BlobPart]), filename);
      const res = await f(`${cfg.url.replace(/\/$/, "")}/scan`, {
        method: "POST",
        headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
        body: form,
      });
      if (!res.ok) throw new Error(`clamav ${res.status}`);
      const b = (await res.json()) as { infected?: boolean; clean?: boolean; viruses?: string[]; signature?: string };
      const infected = b.infected ?? (b.clean === false);
      return { clean: !infected, signature: b.signature ?? b.viruses?.[0] };
    },
  };
}
