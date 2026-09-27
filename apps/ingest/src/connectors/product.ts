import { hasType, parseHours, parseNumber, parseYear, serialFromText, str, stripTags, vatIncluded } from "../extract.ts";
import type { Observation, SellerType } from "../types.ts";

const PRODUCT_TYPES = ["Product", "Vehicle", "Car", "IndividualProduct", "Offer"];

export function findProduct(items: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return items.find((o) => PRODUCT_TYPES.some((t) => hasType(o, t)) && (o.name || o.model || o.brand));
}

function prop(p: Record<string, unknown>, ...names: string[]): unknown {
  const list = Array.isArray(p.additionalProperty) ? (p.additionalProperty as Record<string, unknown>[]) : [];
  for (const n of names) {
    if (p[n] !== undefined) return p[n];
    const hit = list.find((x) => typeof x.name === "string" && x.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.value;
  }
  return undefined;
}

export function sellerFrom(v: unknown): { type: SellerType; name?: string; org?: string } {
  if (!v || typeof v !== "object") return { type: "unknown" };
  const s = v as Record<string, unknown>;
  if (hasType(s, "Person")) return { type: "private" };
  if (hasType(s, "Organization") || hasType(s, "AutoDealer") || hasType(s, "LocalBusiness") || hasType(s, "Corporation")) {
    return { type: "business", name: str(s.name), org: str(s.vatID) ?? str(s.taxID) ?? str(s.identifier) };
  }
  return { type: "unknown" };
}

/** Operating hours: explicit property, or mileageFromOdometer when its unit is hours (UN/CEFACT "HUR"). */
function hoursValue(p: Record<string, unknown>): unknown {
  const direct = prop(p, "hours", "operatingHours", "drifttimmar", "timmar");
  if (direct !== undefined) return direct;
  const odo = prop(p, "mileageFromOdometer") as Record<string, unknown> | undefined;
  if (odo && typeof odo === "object" && (odo.unitCode === "HUR" || /^(h|tim|hours?)/i.test(str(odo.unitText) ?? ""))) return odo.value;
  return undefined;
}

/** Schema.org Product/Vehicle (JSON-LD) → observation. `pageText` is the visible text, used for serial and VAT hints. */
export function productToObservation(p: Record<string, unknown>, url: string, pageText = ""): Observation | null {
  const offers = (Array.isArray(p.offers) ? p.offers[0] : p.offers) as Record<string, unknown> | undefined;
  const make = str(p.brand) ?? str(p.manufacturer);
  const name = str(p.name);
  const model = str(p.model) ?? (make && name?.toLowerCase().startsWith(make.toLowerCase()) ? name.slice(make.length).trim() : name);
  const id = str(p.sku) ?? str(p.productID) ?? str(offers?.sku) ?? url;
  if (!make && !model) return null;
  const seller = sellerFrom(offers?.seller ?? p.seller);
  const description = str(p.description);
  const serialField = str(prop(p, "serialNumber", "vehicleIdentificationNumber", "serienummer", "serial number", "pin"));
  const serial = serialField ?? serialFromText(description) ?? serialFromText(pageText);
  const priceSpec = offers?.priceSpecification as Record<string, unknown> | undefined;
  const images = (Array.isArray(p.image) ? p.image : p.image ? [p.image] : []).map((i) => str(i) ?? str((i as Record<string, unknown>)?.url)).filter(Boolean) as string[];
  const place = offers?.availableAtOrFrom as Record<string, unknown> | undefined;
  const location = str((place?.address as Record<string, unknown> | undefined)?.addressLocality) ?? str(prop(p, "location", "ort"));
  return {
    external_id: id,
    url,
    category: str(p.category) ?? str(prop(p, "category", "kategori")),
    make,
    model,
    year: parseYear(prop(p, "productionDate", "vehicleModelDate", "modelDate", "year", "årsmodell")),
    hours: parseHours(hoursValue(p)),
    price_amount: parseNumber(offers?.price ?? priceSpec?.price),
    price_currency: str(offers?.priceCurrency ?? priceSpec?.priceCurrency) ?? "SEK",
    price_vat_included: typeof priceSpec?.valueAddedTaxIncluded === "boolean" ? priceSpec.valueAddedTaxIncluded as boolean : vatIncluded(pageText),
    location,
    seller_type: seller.type,
    seller_name: seller.name,
    seller_org_number: seller.org,
    serial,
    serial_source: serial ? "listing_text" : undefined,
    serial_confidence: serial ? (serialField ? 1 : 0.9) : undefined,
    images,
    raw: {
      title: name,
      description: description ? stripTags(description).slice(0, 1000) : undefined,
      condition: str(offers?.itemCondition)?.replace(/^https?:\/\/schema\.org\//, ""),
      weight: str(prop(p, "weight", "vikt")),
    },
  };
}
