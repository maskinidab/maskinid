/**
 * Market ingest worker (SPEC §8.5). Scheduled by GitHub Actions (.github/workflows/ingest.yml).
 *   npm run ingest -- --source mascus            one source
 *   npm run ingest -- --all                      every connector in the registry (disabled sources are skipped)
 *   npm run ingest -- --source X --dry-run       fetch + sanitise, print JSON, write nothing
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_LIMIT (default 500), INGEST_OCR=1 to read serials from images.
 * Enabling a source (and its terms review) happens in operator admin – the worker never bypasses the kill switch.
 */
import { CONNECTORS } from "./connectors/index.ts";
import { PoliteFetcher } from "./http.ts";
import { edgeOcr } from "./ocr.ts";
import { serviceRpc } from "./rpc.ts";
import { runSource } from "./run.ts";
import { sanitizeObservation } from "./sanitize.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const env = process.env;
const log = (m: string) => console.error(`[ingest] ${m}`);
const limit = Number(env.INGEST_LIMIT ?? 500);
const fetcher = new PoliteFetcher();

async function main() {
  if (args.includes("--dry-run")) {
    const key = opt("--connector") ?? opt("--source");
    const c = key && CONNECTORS[key];
    if (!c) throw new Error(`--dry-run needs --connector <${Object.keys(CONNECTORS).join("|")}>`);
    const config = opt("--config") ? JSON.parse(opt("--config")!) : {};
    const obs = await c.fetchListings({ source: { key, connector: key, base_url: opt("--base-url") ?? null, config }, since: null, fetcher, limit: Math.min(limit, 20), env, log });
    console.log(JSON.stringify(obs.map(sanitizeObservation), null, 2));
    return;
  }
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const sources = args.includes("--all") ? ["mascus", "blocket", "dealer-sitemap", "partner-feed"] : [opt("--source")].filter(Boolean) as string[];
  if (!sources.length) throw new Error("use --source <key> or --all");
  const rpc = serviceRpc(url, key);
  const ocr = env.INGEST_OCR === "1" ? edgeOcr(`${url.replace(/\/$/, "")}/functions/v1`, key, fetcher) : undefined;
  let failed = 0;
  for (const s of sources) {
    const r = await runSource(s, { rpc, fetcher, env, log, ocr, limit });
    if (r.status === "error") failed++;
  }
  log(`${fetcher.requests} HTTP requests`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  log((e as Error).message);
  process.exitCode = 1;
});
