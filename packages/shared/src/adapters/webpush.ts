/**
 * Web Push sender (step 24, ADR 0021): VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291/8188), dependency-free
 * with Web Crypto so it runs in Deno Edge Functions and in Node tests. The mock records messages instead of sending.
 */
type FetchLike = typeof fetch;

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export interface PushMessage { title: string; body: string; url: string; tag?: string; severity?: string }
export interface PushResult { ok: boolean; gone: boolean; status: number }

export interface PushSender {
  readonly name: "webpush" | "mock";
  send(target: PushTarget, message: PushMessage, opts?: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high" }): Promise<PushResult>;
}

// ---------- base64url ----------
export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, bytes * 8));
}

/** Derives content key and nonce (RFC 8291 §3.4 + RFC 8188). Shared by encrypt and the test's decrypt. */
export async function deriveKeys(ecdhSecret: Uint8Array, authSecret: Uint8Array, uaPublic: Uint8Array, asPublic: Uint8Array, salt: Uint8Array) {
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  return { cek, nonce };
}

/** Encrypts one push message for a subscription (single record, aes128gcm). */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, auth: string,
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  const server = opts.serverKeys ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", server.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", buf(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await deriveKeys(secret, authSecret, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, key, buf(concat(plaintext, new Uint8Array([2])))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, ct);
}

/** VAPID JWT (ES256) for the push service origin. */
export async function vapidJwt(audience: string, subject: string, publicKey: string, privateKey: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64urlDecode(publicKey);
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64urlEncode(sig)}`;
}

export interface WebPushConfig { publicKey: string; privateKey: string; subject: string; fetch?: FetchLike }

export function createWebPushSender(cfg: WebPushConfig): PushSender {
  const f = cfg.fetch ?? fetch;
  return {
    name: "webpush",
    async send(target, message, opts = {}) {
      const body = await encryptPayload(enc.encode(JSON.stringify(message)), target.p256dh, target.auth);
      const jwt = await vapidJwt(new URL(target.endpoint).origin, cfg.subject, cfg.publicKey, cfg.privateKey);
      const res = await f(target.endpoint, {
        method: "POST",
        headers: { Authorization: `vapid t=${jwt}, k=${cfg.publicKey}`, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
          TTL: String(opts.ttl ?? 24 * 3600), Urgency: opts.urgency ?? "normal" },
        body: buf(body),
      });
      return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
    },
  };
}

/** Mock: keeps the last messages (DEMO_MODE and tests). */
export function createMockPushSender(): PushSender & { sent: { target: PushTarget; message: PushMessage }[] } {
  const sent: { target: PushTarget; message: PushMessage }[] = [];
  return { name: "mock", sent, async send(target, message) { sent.push({ target, message }); return { ok: true, gone: false, status: 201 }; } };
}
