import { isSoleTraderNumber, isValidOrgNumber, normalizeOrgNumber } from "@maskinid/shared/identifiers.ts";
import type { Observation } from "./types.ts";

/**
 * Legal guard rails (SPEC §8.1, §8.6), applied before anything leaves the worker. The database enforces the same rules
 * again (ingest_observations + table check), so a buggy connector cannot store personal data.
 *  - Private sellers: no name, org number or contact data.
 *  - Sole traders: the org number is a personal number (hard rule 6) ⇒ treated as private.
 *  - Business without a valid org number: name kept, number dropped.
 *  - raw: structured facts only; personal keys removed recursively; strings that look like phone numbers, e-mail
 *    addresses or personal numbers are removed.
 */
const PERSONAL_KEY = /(phone|telefon|mobil|email|e-post|mail|contact|kontakt|seller|saljare|säljare|person|name|namn|address|adress|ssn|personnummer)/i;
const PERSONAL_VALUE = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // e-mail
  /(?:\+46|0)\s*7\d[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/, // Swedish mobile
  /\b(?:19|20)?\d{6}[-+]?\d{4}\b/, // personal number shape
];

export function stripPersonal(v: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (Array.isArray(v)) return v.map((x) => stripPersonal(x, depth + 1)).filter((x) => x !== undefined);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (PERSONAL_KEY.test(k)) continue;
      const s = stripPersonal(x, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  if (typeof v === "string") return PERSONAL_VALUE.some((r) => r.test(v)) ? undefined : v.slice(0, 500);
  return v;
}

export function sanitizeObservation(o: Observation): Observation {
  const out: Observation = { ...o };
  let business = o.seller_type === "business";
  if (business && o.seller_org_number) {
    if (isSoleTraderNumber(o.seller_org_number)) business = false;
    else out.seller_org_number = isValidOrgNumber(o.seller_org_number) ? normalizeOrgNumber(o.seller_org_number)! : undefined;
  }
  if (!business) {
    delete out.seller_name;
    delete out.seller_org_number;
    if (o.seller_type === "business") out.seller_type = "private";
  }
  out.raw = (stripPersonal(o.raw ?? {}) as Record<string, unknown>) ?? {};
  // Text fields must never carry contact details either.
  for (const k of ["location", "make", "model", "category"] as const) {
    const v = out[k];
    if (typeof v === "string" && PERSONAL_VALUE.some((r) => r.test(v))) delete out[k];
  }
  out.images = (o.images ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 20);
  return out;
}
