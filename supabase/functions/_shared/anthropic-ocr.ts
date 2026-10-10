// Ocr adapter backed by Claude (vision + structured outputs). Used by ocr-nameplate, ocr-listing-images and import-map.
// Never used for authorisation decisions (SPEC §14). DEMO_MODE uses the mock adapter instead (createAdapters).
//
// Env: ANTHROPIC_API_KEY
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod@4";
import type { FinancingSuggestion, NameplateSuggestion, Ocr } from "./shared/adapters/types.ts";

const MODEL = "claude-opus-5";

const Nameplate = z.object({
  make: z.string().nullable(),
  model: z.string().nullable(),
  serial: z.string().nullable(),
  pin: z.string().nullable(),
  year: z.number().int().nullable(),
  engine_serial: z.string().nullable(),
  weight_kg: z.number().nullable(),
  confidence: z.number(),
  field_confidence: z.object({ make: z.number(), model: z.number(), serial: z.number(), pin: z.number(), year: z.number() }),
});

const ListingImage = z.object({ is_nameplate: z.boolean(), serial: z.string().nullable(), confidence: z.number() });

// Financing document (bank order / leasing or credit agreement). Note the absence of any amount field: the
// register stores no amounts (CLAUDE.md rule 5), so the model is never asked for one.
const FINANCING_FIELDS = [
  "document_kind", "financier_name", "financier_org_number", "encumbrance_type", "contract_ref",
  "start_date", "end_date", "term_months", "serial", "pin", "make", "model", "year",
  "customer_name", "customer_org_number",
] as const;

const Financing = z.object({
  document_kind: z.enum(["bank_order", "leasing_agreement", "credit_agreement", "payoff_statement", "other"]).nullable(),
  financier_name: z.string().nullable(),
  financier_org_number: z.string().nullable(),
  encumbrance_type: z.enum(["ownership_reservation", "leasing", "rental", "other"]).nullable(),
  contract_ref: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  term_months: z.number().int().nullable(),
  serial: z.string().nullable(),
  pin: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().int().nullable(),
  customer_name: z.string().nullable(),
  customer_org_number: z.string().nullable(),
  confidence: z.number(),
  field_confidence: z.record(z.string(), z.number()),
});

// JSON schemas for output_config.format (all properties required, no additional properties).
const nullable = (type: string) => ({ type: [type, "null"] });
const NAMEPLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["make", "model", "serial", "pin", "year", "engine_serial", "weight_kg", "confidence", "field_confidence"],
  properties: {
    make: nullable("string"), model: nullable("string"), serial: nullable("string"), pin: nullable("string"),
    year: nullable("integer"), engine_serial: nullable("string"), weight_kg: nullable("number"), confidence: { type: "number" },
    field_confidence: {
      type: "object", additionalProperties: false, required: ["make", "model", "serial", "pin", "year"],
      properties: { make: { type: "number" }, model: { type: "number" }, serial: { type: "number" }, pin: { type: "number" }, year: { type: "number" } },
    },
  },
};
const LISTING_SCHEMA = {
  type: "object", additionalProperties: false, required: ["is_nameplate", "serial", "confidence"],
  properties: { is_nameplate: { type: "boolean" }, serial: nullable("string"), confidence: { type: "number" } },
};
const FINANCING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...FINANCING_FIELDS, "confidence", "field_confidence"],
  properties: {
    document_kind: { type: ["string", "null"], enum: ["bank_order", "leasing_agreement", "credit_agreement", "payoff_statement", "other", null] },
    financier_name: nullable("string"),
    financier_org_number: nullable("string"),
    encumbrance_type: { type: ["string", "null"], enum: ["ownership_reservation", "leasing", "rental", "other", null] },
    contract_ref: nullable("string"),
    start_date: nullable("string"),
    end_date: nullable("string"),
    term_months: nullable("integer"),
    serial: nullable("string"),
    pin: nullable("string"),
    make: nullable("string"),
    model: nullable("string"),
    year: nullable("integer"),
    customer_name: nullable("string"),
    customer_org_number: nullable("string"),
    confidence: { type: "number" },
    field_confidence: {
      type: "object",
      additionalProperties: false,
      required: ["financier_name", "encumbrance_type", "contract_ref", "serial", "end_date"],
      properties: {
        financier_name: { type: "number" }, encumbrance_type: { type: "number" }, contract_ref: { type: "number" },
        serial: { type: "number" }, end_date: { type: "number" },
      },
    },
  },
};

export class OcrRefused extends Error {}

export function createAnthropicOcr(apiKey = Deno.env.get("ANTHROPIC_API_KEY")): Ocr {
  const client = new Anthropic({ apiKey });

  async function structured<T>(content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, parse: (v: unknown) => T): Promise<T> {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      // Extraction is a simple task: low effort keeps latency and cost down.
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      // Server-side fallback if a safety classifier declines (routes by refusal category).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (response.stop_reason === "refusal") throw new OcrRefused("refused");
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    return parse(JSON.parse(text));
  }

  const image = (base64: string, mediaType: string): Anthropic.Beta.BetaContentBlockParam => ({
    type: "image",
    source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png", data: base64 },
  });

  // Financing agreements are nearly always PDFs, which go in a document block rather than an image block.
  const fileBlock = (base64: string, mediaType: string): Anthropic.Beta.BetaContentBlockParam =>
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } as Anthropic.Beta.BetaContentBlockParam
      : image(base64, mediaType);

  return {
    name: "anthropic",
    async nameplate({ base64, mediaType }): Promise<NameplateSuggestion> {
      const r = await structured([
        image(base64, mediaType),
        {
          type: "text",
          text: "This is a photo of the manufacturer's nameplate (type plate) on a heavy machine. Read the plate exactly as printed. " +
            "Return make, model, serial number, PIN (17-character product identification number, if present), year of manufacture, " +
            "engine serial and operating weight in kg. Use null for anything not legible or not on the plate – never guess or " +
            "correct characters (do not change O to 0 or I to 1). Give an overall confidence and a per-field confidence between 0 and 1.",
        },
      ], NAMEPLATE_SCHEMA, (v) => Nameplate.parse(v));
      return {
        make: r.make ?? undefined, model: r.model ?? undefined, serial: r.serial ?? undefined, pin: r.pin ?? undefined,
        year: r.year ?? undefined, engine_serial: r.engine_serial ?? undefined, weight_kg: r.weight_kg ?? undefined,
        confidence: r.confidence, field_confidence: r.field_confidence,
      };
    },
    async listingImage({ base64, mediaType }) {
      const r = await structured([
        image(base64, mediaType),
        { type: "text", text: "Is this image a close-up of a machine nameplate (type plate)? If it is, read the serial number or PIN exactly as printed (null if not legible). Give a confidence between 0 and 1." },
      ], LISTING_SCHEMA, (v) => ListingImage.parse(v));
      return { isNameplate: r.is_nameplate, serial: r.serial ?? undefined, confidence: r.confidence };
    },
    async financingDocument({ base64, mediaType }): Promise<FinancingSuggestion> {
      const r = await structured([
        fileBlock(base64, mediaType),
        {
          type: "text",
          text: "This is a financing document for a heavy machine: a bank order (Swedish \"bankbeställning\"), a leasing " +
            "agreement, a credit/instalment agreement with retention of title, or a payoff statement. Read it exactly as " +
            "written and return: which kind of document it is; the financing company's name and Swedish organisation " +
            "number; whether the arrangement is leasing, retention of title (äganderättsförbehåll/avbetalning), rental, " +
            "or something else; the contract/agreement number; start and end dates as ISO dates (YYYY-MM-DD); the term in " +
            "months; the machine's serial number, PIN, make, model and year of manufacture; and the customer's name and " +
            "organisation number. Use null for anything that is not stated in the document – never guess, never infer a " +
            "date from a term, and never correct characters (do not change O to 0 or I to 1). " +
            "Do NOT return any monetary amount, price, instalment, residual value or debt figure, even if the document " +
            "states one: this register stores no amounts. Give an overall confidence and a per-field confidence between 0 and 1.",
        },
      ], FINANCING_SCHEMA, (v) => Financing.parse(v));
      const undef = <T>(x: T | null): T | undefined => (x === null ? undefined : x);
      return {
        document_kind: undef(r.document_kind), financier_name: undef(r.financier_name),
        financier_org_number: undef(r.financier_org_number), encumbrance_type: undef(r.encumbrance_type),
        contract_ref: undef(r.contract_ref), start_date: undef(r.start_date), end_date: undef(r.end_date),
        term_months: undef(r.term_months), serial: undef(r.serial), pin: undef(r.pin), make: undef(r.make),
        model: undef(r.model), year: undef(r.year), customer_name: undef(r.customer_name),
        customer_org_number: undef(r.customer_org_number),
        confidence: r.confidence, field_confidence: r.field_confidence,
      };
    },
    async mapColumns({ headers, sample, targets }) {
      const schema = {
        type: "object", additionalProperties: false, required: targets,
        properties: Object.fromEntries(targets.map((t) => [t, { type: ["string", "null"], enum: [...headers, null] }])),
      };
      return structured([{
        type: "text",
        text: `Map the columns of a machine register import file to target fields. Headers: ${JSON.stringify(headers)}. ` +
          `First rows: ${JSON.stringify(sample.slice(0, 5))}. Targets: ${JSON.stringify(targets)}. ` +
          "For each target return the header that holds that data, or null if none does. Use each header at most once.",
      }], schema, (v) => z.record(z.string(), z.string().nullable()).parse(v));
    },
  };
}
