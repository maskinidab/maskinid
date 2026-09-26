import { CONNECTORS } from "./connectors/index.ts";
import { sanitizeObservation } from "./sanitize.ts";
import { RpcError, type Rpc } from "./rpc.ts";
import type { Fetcher } from "./types.ts";

export interface RunDeps {
  rpc: Rpc;
  fetcher: Fetcher;
  env: Record<string, string | undefined>;
  log(msg: string): void;
  /** Reads serials from listing images (Edge Function ocr-listing-images); omitted ⇒ no OCR step. */
  ocr?: (observationId: string, imageUrls: string[]) => Promise<void>;
  limit?: number;
  batchSize?: number;
}

export interface RunResult {
  source: string;
  status: "ok" | "skipped" | "error";
  fetched: number;
  new: number;
  matched: number;
  alerts: number;
  error?: string;
}

interface Started {
  run_id: string;
  connector: string;
  base_url: string | null;
  config: Record<string, unknown>;
  since: string | null;
}

/** One run of one source: kill-switch check (start_market_run), fetch, sanitise, ingest in batches, OCR, finish. */
export async function runSource(key: string, deps: RunDeps): Promise<RunResult> {
  const result: RunResult = { source: key, status: "ok", fetched: 0, new: 0, matched: 0, alerts: 0 };
  let started: Started;
  try {
    started = await deps.rpc<Started>("start_market_run", { p_source_key: key });
  } catch (e) {
    if (e instanceof RpcError && (e.code === "SOURCE_DISABLED" || e.code === "NOT_FOUND")) {
      deps.log(`${key}: ${e.code === "SOURCE_DISABLED" ? "disabled (kill switch / terms)" : "unknown source"} – skipped`);
      return { ...result, status: "skipped" };
    }
    throw e;
  }
  try {
    const connector = CONNECTORS[started.connector];
    if (!connector) throw new Error(`no connector "${started.connector}"`);
    const observations = await connector.fetchListings({
      source: { key, connector: started.connector, base_url: started.base_url, config: started.config ?? {} },
      since: started.since ? new Date(started.since) : null,
      fetcher: deps.fetcher,
      limit: deps.limit ?? 500,
      env: deps.env,
      log: deps.log,
    });
    const clean = observations.map(sanitizeObservation);
    const size = deps.batchSize ?? 200;
    // A complete set is sent as one batch so deactivation sees every listing.
    const batches = connector.complete ? [clean] : Array.from({ length: Math.ceil(clean.length / size) }, (_, i) => clean.slice(i * size, (i + 1) * size));
    for (const batch of batches) {
      const r = await deps.rpc<{ fetched: number; new: number; matched: number; alerts: number }>("ingest_observations", {
        p_run_id: started.run_id, p_observations: batch, p_complete: connector.complete,
      });
      result.fetched += r.fetched;
      result.new += r.new;
      result.matched += r.matched;
      result.alerts += r.alerts;
    }
    if (deps.ocr) {
      const cands = await deps.rpc<{ id: string; images: string[] }[]>("claim_ocr_candidates", { p_run_id: started.run_id, p_limit: 20 });
      for (const c of cands) {
        try {
          await deps.ocr(c.id, c.images.slice(0, 4));
        } catch (e) {
          deps.log(`${key}: OCR failed for ${c.id}: ${(e as Error).message}`);
        }
      }
    }
    await deps.rpc("finish_market_run", { p_run_id: started.run_id, p_status: "ok" });
    deps.log(`${key}: ${result.fetched} listings, ${result.new} new, ${result.matched} matched, ${result.alerts} alerts`);
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    await deps.rpc("finish_market_run", { p_run_id: started.run_id, p_status: "error", p_error: msg }).catch(() => undefined);
    deps.log(`${key}: error – ${msg}`);
    return { ...result, status: "error", error: msg };
  }
}
