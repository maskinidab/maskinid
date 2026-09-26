/** Parsing helpers shared by connectors. No DOM library: sources are read via structured data (JSON-LD, embedded JSON). */

/** All JSON-LD blocks in a page, flattened (@graph and arrays expanded). Invalid blocks are skipped. */
export function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      flatten(JSON.parse(decodeEntities(m[1].trim())), out);
    } catch {
      /* skip malformed block */
    }
  }
  return out;
}

function flatten(v: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(v)) v.forEach((x) => flatten(x, out));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o["@graph"])) flatten(o["@graph"], out);
    else out.push(o);
  }
}

export function hasType(o: Record<string, unknown>, type: string): boolean {
  const t = o["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/** JSON embedded in a script tag by id (e.g. Next.js __NEXT_DATA__). */
export function scriptJson(html: string, id: string): unknown {
  const re = new RegExp(`<script[^>]+id\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)</script>`, "i");
  const m = re.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** `<loc>` entries of a sitemap (urlset or sitemapindex). */
export function sitemapLocs(xml: string): { loc: string; lastmod: Date | null }[] {
  const out: { loc: string; lastmod: Date | null }[] = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/gi)) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(m[1])?.[1];
    const lm = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(m[1])?.[1];
    if (loc) out.push({ loc: decodeEntities(loc), lastmod: lm && !Number.isNaN(Date.parse(lm)) ? new Date(lm) : null });
  }
  return out;
}

/** "1 234 567 kr" / "1.234.567" / 1234567 → 1234567. */
export function parseNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const digits = v.replace(/[\s .]/g, "").replace(/,(\d{1,2})$/, ".$1").replace(/[^\d.]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

export function parseYear(v: unknown): number | undefined {
  const n = parseNumber(typeof v === "string" ? v.slice(0, 10).match(/\d{4}/)?.[0] : v);
  return n && n >= 1950 && n <= new Date().getFullYear() + 1 ? Math.trunc(n) : undefined;
}

export function parseHours(v: unknown): number | undefined {
  const n = parseNumber(v);
  return n !== undefined && n >= 0 && n < 1_000_000 ? Math.trunc(n) : undefined;
}

/** true when the text says the price is excl. VAT ("exkl. moms", "ex moms", "+ moms"); false for "inkl. moms". */
export function vatIncluded(text: string | undefined): boolean | undefined {
  if (!text) return undefined;
  if (/(exkl|excl|ex\.?)\s*\.?\s*(moms|vat)|\+\s*moms|plus moms/i.test(text)) return false;
  if (/(inkl|incl)\.?\s*(moms|vat)/i.test(text)) return true;
  return undefined;
}

// Serial numbers in listing text: explicit labels only ("Serienr", "S/N", "PIN", "VIN", "Chassinr"). Free-standing
// codes are never guessed – a wrong serial would create a false match.
const SERIAL_LABEL = /\b(?:serie(?:nummer|nr\.?)|serial(?:\s*(?:no\.?|number))?|s\/n|pin(?:\s*(?:nr|nummer|number))?|vin|chassi(?:nummer|nr\.?)|chassis(?:\s*(?:no\.?|number))?)(?:\s*[:#]\s*|\.?\s+)([A-Z0-9][A-Z0-9-]{3,24}[A-Z0-9])/i;

export function serialFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = SERIAL_LABEL.exec(text);
  if (!m) return undefined;
  const v = m[1].toUpperCase();
  // Must contain a digit and be at least 5 characters after normalisation.
  const n = v.replace(/-/g, "");
  return n.length >= 5 && /\d/.test(n) ? v : undefined;
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "name" in v) return str((v as { name: unknown }).name);
  return undefined;
}
