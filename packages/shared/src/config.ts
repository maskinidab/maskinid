/**
 * Product-wide constants. APP_NAME is a working name and must be changeable in one place.
 * Never describe the product as "Svenska Maskinregistret", "det nationella registret" or
 * "det officiella registret" (CLAUDE.md rule 9) – see FORBIDDEN_PRODUCT_NAMES and its test.
 */
export const APP_NAME = "MaskinID";
export const APP_LEGAL_NAME = "MaskinID Sverige AB";
/**
 * Seller details printed on invoices (step 23). Must be filled in before real invoicing – an invoice needs the
 * seller's organisation and VAT number (mervärdesskattelagen 17 kap.). Empty values are left out of the PDF.
 */
export const BILLING_SELLER = { name: APP_LEGAL_NAME, orgNumber: "", vatNumber: "", address: "", bankgiro: "" };
export const APP_DOMAIN = "maskinid.se";
export const APP_BASE_URL = `https://${APP_DOMAIN}`;
export const API_BASE_URL = `https://api.${APP_DOMAIN}/v1`;
export const SUPPORT_EMAIL = `support@${APP_DOMAIN}`;
export const SECURITY_EMAIL = `security@${APP_DOMAIN}`;

/** Phrases the product must never use about itself (checked by tests over i18n, e-mail and PDF texts). */
export const FORBIDDEN_PRODUCT_NAMES = [
  "svenska maskinregistret",
  "nationella registret",
  "officiella registret",
  "national register",
  "official register",
] as const;

export const FEATURE_FLAGS = [
  "DEMO_MODE",
  "FEATURE_MARKET",
  "FEATURE_VALUATION",
  "FEATURE_SMS",
  "FEATURE_NFC",
  "FEATURE_PAYMENTS",
  "FEATURE_TELEMATICS",
  "FEATURE_THEFT_SYNC",
  "FEATURE_PUSH",
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** Defaults; overridden by env (VITE_ prefixed or Deno env) and by the `app_config` table at runtime. */
export const FEATURE_DEFAULTS: Record<FeatureFlag, boolean> = {
  DEMO_MODE: true,
  FEATURE_MARKET: true,
  FEATURE_VALUATION: false,
  FEATURE_SMS: false,
  FEATURE_NFC: false,
  FEATURE_PAYMENTS: false,
  FEATURE_TELEMATICS: false,
  FEATURE_THEFT_SYNC: false,
  FEATURE_PUSH: false,
};

/** Parses "true"/"1"/"false"/"0" env strings into a flag map on top of the defaults. */
export function resolveFlags(env: Record<string, string | boolean | undefined>): Record<FeatureFlag, boolean> {
  const out = { ...FEATURE_DEFAULTS };
  for (const flag of FEATURE_FLAGS) {
    const raw = env[flag] ?? env[`VITE_${flag}`];
    if (raw === undefined || raw === "") continue;
    out[flag] = raw === true || raw === "true" || raw === "1";
  }
  return out;
}

/** Business rules shared between client, edge functions and tests (mirrors SQL constants). */
export const RULES = {
  transferExpiryDays: 14,
  transferBackdateDays: 10,
  shareLinkDays: [7, 30] as const,
  publicRateLimitPerMin: 30,
  publicRateLimitPerDay: 300,
  maxUploadBytes: 25 * 1024 * 1024,
  allowedUploadMimes: ["application/pdf", "image/jpeg", "image/png", "image/heic"] as const,
  checkBatchMax: 500,
  encumbranceEndReminderDays: 30,
  inspectionReminderDays: [60, 30, 7] as const,
  temporaryRegistrationReminderDays: 30,
  registrationWeightThresholdKg: 1500,
  ocrMatchConfidence: 0.85,
  stolenDeregistrationSuggestMonths: 24,
  ownerCorrectionObjectionDays: 14,
} as const;
