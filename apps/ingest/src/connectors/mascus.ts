import { listingSiteConnector } from "./listingSite.ts";

/**
 * Mascus (www.mascus.se). Listing pages carry Schema.org Product JSON-LD with the dealer as offers.seller.
 * Defaults are a starting point: verify against the live site and the terms before enabling (docs/OPEN_QUESTIONS.md).
 */
export const mascus = listingSiteConnector("mascus", {
  search_paths: ["/entreprenadmaskiner", "/lantbruk", "/transport", "/materialhantering"],
  listing_pattern: "^/[a-z0-9-]+(?:/[a-z0-9-]+)+/[a-z0-9-]+,[a-z0-9]+\\.html$",
  page_param: "page",
  max_pages: 3,
  business_marker: "\\b(Återförsäljare|Handlare|Dealer)\\b",
});
