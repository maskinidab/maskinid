import { jsonLd, sitemapLocs, stripTags } from "../extract.ts";
import type { Connector, Observation } from "../types.ts";
import { findProduct, productToObservation } from "./product.ts";

/**
 * Generic dealer website (SPEC §8.2): sitemap(s) → product pages with Schema.org Product/Vehicle JSON-LD.
 * config: { sites: [{ sitemap, url_pattern?, seller_name?, seller_org_number? }] }. The dealer is a business by
 * definition; its name and org number come from config when the page does not state them.
 */
interface Site {
  sitemap: string;
  url_pattern?: string;
  seller_name?: string;
  seller_org_number?: string;
}

const DEFAULT_PATTERN = "(maskin|machine|begagnat|used|produkt|product|objekt|lager|stock)";

export const dealerSite: Connector = {
  key: "generic-dealer",
  complete: false,
  async fetchListings(ctx) {
    const cfg = ctx.source.config as { sites?: Site[]; sitemaps?: string[] };
    const sites: Site[] = cfg.sites ?? (cfg.sitemaps ?? []).map((sitemap) => ({ sitemap }));
    const out: Observation[] = [];
    for (const site of sites) {
      const pattern = new RegExp(site.url_pattern ?? DEFAULT_PATTERN, "i");
      const pages: string[] = [];
      const queue = [site.sitemap];
      for (let depth = 0; queue.length && depth < 20; depth++) {
        const xml = await ctx.fetcher.text(queue.shift()!, { accept: "application/xml,text/xml" });
        if (!xml) continue;
        const isIndex = /<sitemapindex/i.test(xml);
        for (const { loc, lastmod } of sitemapLocs(xml)) {
          if (isIndex) queue.push(loc);
          else if (pattern.test(new URL(loc).pathname) && (!ctx.since || !lastmod || lastmod > ctx.since)) pages.push(loc);
        }
      }
      for (const url of pages.slice(0, ctx.limit - out.length)) {
        const html = await ctx.fetcher.text(url);
        if (!html) continue;
        const p = findProduct(jsonLd(html));
        const o = p && productToObservation(p, url, stripTags(html));
        if (!o) continue;
        o.seller_type = "business";
        o.seller_name ??= site.seller_name;
        o.seller_org_number ??= site.seller_org_number;
        out.push(o);
      }
      if (out.length >= ctx.limit) break;
    }
    return out;
  },
};
