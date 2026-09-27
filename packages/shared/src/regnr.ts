/**
 * Registration numbers (SPEC §5.1).
 * Alphabet of 32 characters without 0/O/1/I. 6 random characters + 1 check character (Luhn mod N, N = 32).
 * Displayed as XXX-XXXX, stored without hyphen. Both groups mix letters and digits so a number never
 * looks like a Swedish car plate (ABC 123 / ABC 12A). The SQL twin lives in the enums/extensions migration
 * (public.reg_check_char / public.generate_reg_number) and is tested against the same vectors.
 */
export const REG_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const N = REG_ALPHABET.length; // 32

function codePoint(ch: string): number {
  const i = REG_ALPHABET.indexOf(ch);
  if (i < 0) throw new Error(`Invalid registration character: ${ch}`);
  return i;
}

/** Luhn mod N check character for the given payload (without check character). */
export function regCheckChar(payload: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = payload.length - 1; i >= 0; i--) {
    let addend = factor * codePoint(payload[i]!);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    sum += addend;
  }
  return REG_ALPHABET[(N - (sum % N)) % N]!;
}

/** Upper-case and strip whitespace and hyphens. Does not map O→0 or I→1 (a wrong character must fail validation). */
export function normalizeRegNumber(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export type RegValidation = { ok: true; value: string } | { ok: false; reason: "length" | "characters" | "check" };

export function validateRegNumber(input: string): RegValidation {
  const v = normalizeRegNumber(input);
  if (v.length !== 7) return { ok: false, reason: "length" };
  for (const ch of v) if (!REG_ALPHABET.includes(ch)) return { ok: false, reason: "characters" };
  if (regCheckChar(v.slice(0, 6)) !== v[6]) return { ok: false, reason: "check" };
  return { ok: true, value: v };
}

export function isValidRegNumber(input: string): boolean {
  return validateRegNumber(input).ok;
}

/** XXX-XXXX display format. Returns the input unchanged if it is not 7 characters. */
export function formatRegNumber(input: string): string {
  const v = normalizeRegNumber(input);
  return v.length === 7 ? `${v.slice(0, 3)}-${v.slice(3)}` : input;
}

const isDigit = (c: string) => c >= "2" && c <= "9";
function mixed(group: string): boolean {
  return [...group].some(isDigit) && [...group].some((c) => !isDigit(c));
}

/** True if both display groups mix letters and digits. */
export function hasMixedGroups(reg: string): boolean {
  const v = normalizeRegNumber(reg);
  return mixed(v.slice(0, 3)) && mixed(v.slice(3));
}

/** Generates a registration number. `random` returns an integer in [0, 32). Server-side generation is authoritative. */
export function generateRegNumber(random: () => number = cryptoRandom32): string {
  for (;;) {
    let payload = "";
    for (let i = 0; i < 6; i++) payload += REG_ALPHABET[random() & 31];
    const reg = payload + regCheckChar(payload);
    if (hasMixedGroups(reg)) return reg;
  }
}

function cryptoRandom32(): number {
  const b = new Uint8Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0]! & 31;
}
