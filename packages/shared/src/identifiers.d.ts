/**
 * Machine identifiers (SPEC §4.2). Normalisation only touches case and whitespace/hyphens –
 * never O→0 or similar; the OCR step may suggest such corrections but the user decides.
 * The SQL twin is public.normalize_identifier().
 */
export declare const IDENTIFIER_TYPES: readonly ["pin", "serial", "engine_serial", "vin", "road_reg", "external_registry", "chassis", "other"];
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
/** Types covered by the partial unique index (a duplicate creates a conflict instead of a silent duplicate). */
export declare const UNIQUE_IDENTIFIER_TYPES: readonly IdentifierType[];
export declare function normalizeIdentifier(input: string): string;
/** Public masking: "••••••3K7" (only the last 3 characters). */
export declare function maskSerial(value: string, visible?: number): string;
/** Masks a Swedish personal number used as sole-trader org number: 19XXXXXX-XXXX (SPEC §11.7). */
export declare function maskPersonalOrgNumber(orgNumber: string): string;
/** Swedish organisation number: NNNNNN-NNNN with Luhn check digit. Accepts 10 or 12 digits (16-prefix). */
export declare function normalizeOrgNumber(input: string): string | null;
export declare function luhn10(digits: string): boolean;
export declare function isValidOrgNumber(input: string): boolean;
/**
 * Sole traders use a personal number as org number. Legal entities have 3rd digit ≥ 2 ("månadssiffra" ≥ 20);
 * personal numbers have a month (01–12) in position 3–4.
 */
export declare function isSoleTraderNumber(input: string): boolean;
export declare const LABEL_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export declare const LABEL_CODE_LENGTH = 22;
export declare function isLabelCode(input: string): boolean;
/** Extracts a label code from a scanned QR URL (https://<domain>/m/<code>) or returns null. */
export declare function labelCodeFromScan(text: string): string | null;
/** Label serial printed on the physical label: last 6 characters of the code. */
export declare function labelSerial(code: string): string;
