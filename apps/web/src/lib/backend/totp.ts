// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for the local-mode MFA emulation.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomBase32(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let bits = "";
  for (const x of b) bits += x.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Uint8Array {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export async function totp(secret: string, time = Date.now(), step = 30): Promise<string> {
  const counter = Math.floor(time / 1000 / step);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, counter);
  const key = await crypto.subtle.importKey("raw", base32Decode(secret) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[h.length - 1]! & 0xf;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

export async function totpVerify(secret: string, code: string, time = Date.now()): Promise<boolean> {
  for (const drift of [-1, 0, 1]) if ((await totp(secret, time + drift * 30_000)) === code.trim()) return true;
  return false;
}
