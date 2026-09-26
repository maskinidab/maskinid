import type { Connector } from "../types.ts";
import { blocket } from "./blocket.ts";
import { dealerSite } from "./dealerSite.ts";
import { mascus } from "./mascus.ts";
import { partnerFeed } from "./partnerFeed.ts";

/** Connector registry, keyed by market_sources.connector. */
export const CONNECTORS: Record<string, Connector> = {
  mascus,
  blocket,
  "generic-dealer": dealerSite,
  "partner-feed": partnerFeed,
};
