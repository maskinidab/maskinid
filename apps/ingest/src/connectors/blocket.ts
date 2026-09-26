import { listingSiteConnector } from "./listingSite.ts";

/**
 * Blocket (www.blocket.se), category "Entreprenadmaskiner/Traktorer". Most sellers are private ⇒ the sanitiser drops
 * all seller data unless the listing is marked as a company. Verify defaults and terms before enabling.
 */
export const blocket = listingSiteConnector("blocket", {
  search_paths: ["/mobility/search/car?category=entreprenadmaskiner", "/mobility/search/car?category=traktorer"],
  listing_pattern: "^/mobility/item/\\d+$",
  page_param: "page",
  max_pages: 3,
  private_marker: "\\bPrivat(?:person|säljare)?\\b",
  business_marker: "\\b(Företag|Butik)\\b",
});
