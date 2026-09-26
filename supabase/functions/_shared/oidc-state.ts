// Signed, expiring state for the BankID OIDC round trip. The Edge Function is stateless: everything it needs on the
// callback (who started it, the nonce, where to send the browser back) travels in the HMAC-signed state parameter.

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

export interface StatePayload {
  kind: "identify" | "sign";
  uid: string;
  nonce: string;
  return_to: string;
  sid?: string;
  exp: number; // unix seconds
}

export async function signState(p: Omit<StatePayload, "exp" | "nonce">, secret: string, ttlSeconds = 600): Promise<string> {
  const payload: StatePayload = { ...p, nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

export async function verifyState(token: string, secret: string, kind: StatePayload["kind"]): Promise<StatePayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!equal(fromB64url(sig), await hmac(secret, body))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as StatePayload;
    if (p.kind !== kind || typeof p.exp !== "number" || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Only return to our own app (no open redirect). */
export function safeReturnTo(url: unknown, appOrigin: string): string {
  try {
    const u = new URL(String(url));
    if (u.origin === new URL(appOrigin).origin) return u.toString();
  } catch {
    /* fall through */
  }
  return new URL("/app", appOrigin).toString();
}
