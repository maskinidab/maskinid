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
  };
}
