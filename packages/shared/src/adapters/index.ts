import type { Adapters, Ocr } from "./types.ts";
import {
  createConsoleEmail, createMockTheftRegistry, mockCompanyLookup, mockIdentity, mockOcr, mockSignature, mockVehicleRegistry,
  mockVirusScanner,
} from "./mock.ts";
import {
  createBankIdIdentity, createBankIdSignature, createClamAvScanner, createLarmtjanstSync, createResendEmail, createRoaringLookup,
  createTransportstyrelsenLookup,
} from "./real.ts";

export * from "./types.ts";
export * from "./mock.ts";
export * from "./real.ts";
export * from "./payments.ts";
export * from "./webpush.ts";
import { createMockPushSender, createWebPushSender } from "./webpush.ts";
import { createStripePayments, mockPayments } from "./payments.ts";

export type Env = Record<string, string | undefined>;

/**
 * Builds the adapter set from environment variables. DEMO_MODE=true (default) ⇒ mock everywhere.
 * Each provider can also be forced to mock individually (e.g. COMPANY_LOOKUP_PROVIDER=mock).
 * The OCR adapter is injected (it lives with the Edge Function that owns the model call).
 */
export function createAdapters(env: Env, ocr: Ocr = mockOcr): Adapters {
  const demo = (env.DEMO_MODE ?? "true") !== "false";
  const want = (key: string, real: string) => !demo && (env[key] ?? real) === real;
  const broker = { domain: env.BANKID_OIDC_DOMAIN ?? "", clientId: env.BANKID_OIDC_CLIENT_ID ?? "", clientSecret: env.BANKID_OIDC_CLIENT_SECRET ?? "" };
  return {
    identity: want("IDENTITY_PROVIDER", "bankid") ? createBankIdIdentity(broker) : mockIdentity,
    signature: want("SIGNATURE_PROVIDER", "bankid") ? createBankIdSignature(broker) : mockSignature,
    company: want("COMPANY_LOOKUP_PROVIDER", "roaring")
      ? createRoaringLookup({ clientId: env.ROARING_CLIENT_ID ?? "", clientSecret: env.ROARING_CLIENT_SECRET ?? "" })
      : mockCompanyLookup,
    vehicleRegistry: want("VEHICLE_REGISTRY_PROVIDER", "transportstyrelsen")
      ? createTransportstyrelsenLookup({ url: env.VTR_API_URL ?? "", token: env.VTR_API_TOKEN ?? "" })
      : mockVehicleRegistry,
    theftRegistry: want("THEFT_REGISTRY_PROVIDER", "larmtjanst")
      ? createLarmtjanstSync({ url: env.LARMTJANST_API_URL ?? "", apiKey: env.LARMTJANST_API_KEY ?? "" })
      : createMockTheftRegistry(),
    ocr: demo || (env.OCR_PROVIDER ?? "anthropic") !== "anthropic" ? mockOcr : ocr,
    email: !demo && (env.EMAIL_PROVIDER ?? "resend") === "resend" && env.RESEND_API_KEY
      ? createResendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? "MaskinID <noreply@maskinid.se>" })
      : createConsoleEmail(),
    virusScanner: !demo && env.CLAMAV_URL ? createClamAvScanner({ url: env.CLAMAV_URL, token: env.CLAMAV_TOKEN }) : mockVirusScanner,
    payments: !demo && (env.PAYMENTS_PROVIDER ?? "stripe") === "stripe" && env.STRIPE_SECRET_KEY
      ? createStripePayments({
        secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "", taxRateId: env.STRIPE_TAX_RATE_ID,
        allowLive: env.STRIPE_ALLOW_LIVE === "true",
        prices: Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith("STRIPE_PRICE_") && v)
          .map(([k, v]) => [k.slice("STRIPE_PRICE_".length).toLowerCase(), v as string])),
      })
      : mockPayments,
    push: !demo && env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY
      ? createWebPushSender({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? "mailto:drift@maskinid.se" })
      : createMockPushSender(),
  };
}
