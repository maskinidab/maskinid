import { jsonLd, stripTags } from "../extract.ts";
import type { Connector, ConnectorContext, Observation } from "../types.ts";
import { findProduct, productToObservation } from "./product.ts";

/**
 * Marketplace connector: search/category pages → listing URLs → listing pages with Schema.org JSON-LD.
 * Selectors live in `market_sources.config` so an operator can adjust them without a deploy:
 *   search_paths: string[]       category/search pages (relative to base_url), newest first
 *   listing_pattern: string      regex for listing links in href attributes
 *   page_param: string           query parameter for pagination (default "page")
 *   max_pages: number            per search path (default 3)
 *   private_marker / business_marker: regex on page text when JSON-LD has no seller type
 */
export interface ListingSiteDefaults {
  search_paths: string[];
  listing_pattern: string;
  page_param?: string;
  max_pages?: number;
  private_marker?: string;
  business_marker?: string;
}

export function listingSiteConnector(key: string, defaults: ListingSiteDefaults): Connector {
  return {
    key,
    complete: false,
    async fetchListings(ctx: ConnectorContext) {
      const cfg = { ...defaults, ...(ctx.source.config as Partial<ListingSiteDefaults>) };
      const base = ctx.source.base_url;
      if (!base) throw new Error(`${key}: base_url missing`);
      const pattern = new RegExp(cfg.listing_pattern, "i");
      const urls = new Set<string>();
      for (const path of cfg.search_paths) {
        for (let page = 1; page <= (cfg.max_pages ?? 3) && urls.size < ctx.limit; page++) {
          const u = new URL(path, base);
          if (page > 1) u.searchParams.set(cfg.page_param ?? "page", String(page));
          const html = await ctx.fetcher.text(u.toString());
          if (!html) break;
          const before = urls.size;
          for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
            const abs = new URL(m[1], base);
            if (abs.host === new URL(base).host && pattern.test(abs.pathname)) urls.add(abs.origin + abs.pathname);
            if (urls.size >= ctx.limit) break;
          }
          if (urls.size === before) break; // no new listings ⇒ end of results
        }
      }
      const out: Observation[] = [];
      for (const url of urls) {
        const html = await ctx.fetcher.text(url);
        if (!html) continue;
        const o = listingPage(html, url, cfg);
        if (o) out.push(o);
        else ctx.log(`${key}: no structured data at ${url}`);
      }
      return out;
    },
  };
}

export function listingPage(html: string, url: string, cfg: Pick<ListingSiteDefaults, "private_marker" | "business_marker">): Observation | null {
  const p = findProduct(jsonLd(html));
  if (!p) return null;
  const text = stripTags(html);
  const o = productToObservation(p, url, text);
  if (!o) return null;
  if (o.seller_type === "unknown") {
    if (cfg.private_marker && new RegExp(cfg.private_marker, "i").test(text)) o.seller_type = "private";
    else if (cfg.business_marker && new RegExp(cfg.business_marker, "i").test(text)) o.seller_type = "business";
  }
  // The listing id is the last path segment when the page has no sku.
  if (o.external_id === url) o.external_id = new URL(url).pathname.split("/").filter(Boolean).pop()!.replace(/\.html?$/, "");
  return o;
}
