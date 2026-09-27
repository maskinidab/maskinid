// Error reporting for Edge Functions (step 26, ADR 0023): unhandled errors go to Sentry as a minimal envelope, scrubbed
// of identifiers and personal data. No SDK: one fetch, never blocks or breaks the request. SENTRY_DSN unset ⇒ console only.
import { parseDsn, scrubText } from "./shared/scrub.ts";

export async function captureException(fn: string, err: unknown): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(fn, scrubText(e.message));
  const dsn = Deno.env.get("SENTRY_DSN");
  const target = dsn ? parseDsn(dsn) : null;
  if (!target) return;
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId, timestamp: Date.now() / 1000, platform: "javascript", level: "error", logger: "edge-function",
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production", tags: { function: fn },
    exception: { values: [{ type: e.name, value: scrubText(e.message),
      stacktrace: { frames: (e.stack ?? "").split("\n").slice(1, 20).reverse().map((l) => ({ function: scrubText(l.trim()) })) } }] },
  };
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
  try {
    await fetch(target.url, { method: "POST", headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": target.auth }, body,
      signal: AbortSignal.timeout(2000) });
  } catch {
    /* reporting must never fail the request */
  }
}

/** Wraps a handler: an unhandled error is reported and answered with 500 INTERNAL. */
export function withSentry(fn: string, handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (e) {
      await captureException(fn, e);
      return new Response(JSON.stringify({ code: "INTERNAL" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  };
}
