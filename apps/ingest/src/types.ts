/**
 * Market surveillance (SPEC §8). A connector turns one source into observations; the worker sanitises them and hands
 * them to `ingest_observations` (service role). Matching and alerts run in the database.
 */
export type SellerType = "business" | "private" | "unknown";

/** Wire shape accepted by public.ingest_observations. */
export interface Observation {
  external_id: string;
  url?: string;
  category?: string;
  make?: string;
  model?: string;
  year?: number;
  hours?: number;
  price_amount?: number;
  price_currency?: string;
  price_vat_included?: boolean;
  location?: string;
  seller_type: SellerType;
  /** Only for businesses (§8.1); removed by sanitizeObservation otherwise. */
  seller_name?: string;
  seller_org_number?: string;
  serial?: string;
  serial_source?: "listing_text" | "image_ocr" | "feed";
  serial_confidence?: number;
  images?: string[];
  /** Structured facts only – never raw HTML, never personal fields. */
  raw?: Record<string, unknown>;
}

export interface SourceConfig {
  key: string;
  connector: string;
  base_url: string | null;
  config: Record<string, unknown>;
}

export interface Fetcher {
  /** Fetches text; null when robots.txt disallows the URL. */
  text(url: string, init?: { accept?: string; headers?: Record<string, string> }): Promise<string | null>;
}

export interface ConnectorContext {
  source: SourceConfig;
  since: Date | null;
  fetcher: Fetcher;
  /** Upper bound on listings per run (keeps runs short and polite). */
  limit: number;
  /** Worker environment (partner-feed tokens). */
  env: Record<string, string | undefined>;
  log(msg: string): void;
}

export interface Connector {
  key: string;
  /** true ⇒ the result is the source's complete active set, so missing listings are marked inactive. */
  complete: boolean;
  fetchListings(ctx: ConnectorContext): Promise<Observation[]>;
}
