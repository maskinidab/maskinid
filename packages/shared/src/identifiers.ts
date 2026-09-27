/**
 * Machine identifiers (SPEC §4.2). Normalisation only touches case and whitespace/hyphens –
 * never O→0 or similar; the OCR step may suggest such corrections but the user decides.
 * The SQL twin is public.normalize_identifier().
 */
export const IDENTIFIER_TYPES = ["pin", "serial", "engine_serial", "vin", "road_reg", "external_registry", "chassis", "other"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** Types covered by the partial unique index (a duplicate creates a conflict instead of a silent duplicate). */
export const UNIQUE_IDENTIFIER_TYPES: readonly IdentifierType[] = ["pin", "serial", "vin"];

export function normalizeIdentifier(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").trim();
}

/** Public masking: "••••••3K7" (only the last 3 characters). */
export function maskSerial(value: string, visible = 3): string {
  const v = normalizeIdentifier(value);
  if (v.length <= visible) return "•".repeat(v.length);
  return "•".repeat(Math.max(3, v.length - visible)) + v.slice(-visible);
}

/** Masks a Swedish personal number used as sole-trader org number: 19XXXXXX-XXXX (SPEC §11.7). */
export function maskPersonalOrgNumber(orgNumber: string): string {
  const digits = orgNumber.replace(/\D/g, "");
  const century = digits.length === 12 ? digits.slice(0, 2) : "19";
  return `${century}XXXXXX-XXXX`;
}

/** Swedish organisation number: NNNNNN-NNNN with Luhn check digit. Accepts 10 or 12 digits (16-prefix). */
export function normalizeOrgNumber(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 12) d = d.slice(2);
  if (d.length !== 10) return null;
  return `${d.slice(0, 6)}-${d.slice(6)}`;
}

export function luhn10(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function isValidOrgNumber(input: string): boolean {
  const n = normalizeOrgNumber(input);
  return n !== null && luhn10(n.replace("-", ""));
}

/**
 * Sole traders use a personal number as org number. Legal entities have 3rd digit ≥ 2 ("månadssiffra" ≥ 20);
 * personal numbers have a month (01–12) in position 3–4.
 */
export function isSoleTraderNumber(input: string): boolean {
  const n = normalizeOrgNumber(input);
  if (!n) return false;
  const month = Number(n.slice(2, 4));
  return month >= 1 && month <= 12;
}

export const LABEL_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const LABEL_CODE_LENGTH = 22; // base62, ~131 bits

export function isLabelCode(input: string): boolean {
  return new RegExp(`^[0-9A-Za-z]{${LABEL_CODE_LENGTH}}$`).test(input);
}

/** Extracts a label code from a scanned QR URL (https://<domain>/m/<code>) or returns null. */
export function labelCodeFromScan(text: string): string | null {
  const trimmed = text.trim();
  if (isLabelCode(trimmed)) return trimmed;
  const m = trimmed.match(/\/m\/([0-9A-Za-z]{22})(?:[/?#]|$)/);
  return m ? m[1]! : null;
}

/** Label serial printed on the physical label: last 6 characters of the code. */
export function labelSerial(code: string): string {
  return code.slice(-6);
}
