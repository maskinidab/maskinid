/**
 * Scrubbing before anything leaves for error tracking (SPEC §11.6): identifiers (reg/serial/PIN-like), Swedish personal
 * and organisation numbers, e-mail addresses and bearer tokens are replaced. Used by the web app and the Edge Functions.
 */
export function scrubText(s: string | undefined | null): string | undefined {
  if (s === undefined || s === null) return undefined;
  return s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [token]")
    .replace(/\bmk_(?:live|test)_[0-9a-f]+\b/g, "[api-key]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(?:19|20)?\d{6}[-+]?\d{4}\b/g, "[pnr]")
    .replace(/\b[0-9A-Z]{8,17}\b/g, "[id]");
}

/** Parses a Sentry DSN into the envelope endpoint and auth header. */
export function parseDsn(dsn: string): { url: string; auth: string } | null {
  const m = dsn.match(/^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/);
  if (!m) return null;
  return { url: `https://${m[2]}/api/${m[3]}/envelope/`, auth: `Sentry sentry_version=7, sentry_key=${m[1]}, sentry_client=maskinid/1.0` };
}
