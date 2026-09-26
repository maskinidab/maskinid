// Shared HTTP helpers for Edge Functions.
export const corsHeaders = (origin = Deno.env.get("APP_ORIGIN") ?? "*") => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Vary": "Origin",
});

export function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders() }) : null;
}

/** Maps a PostgREST/RPC error (message = application code, SQLSTATE PTxxx) to an HTTP response. */
export function rpcError(error: { message?: string; code?: string; details?: string | null }) {
  const status = error.code?.startsWith("PT") ? Number(error.code.slice(2)) : error.code === "42501" ? 403 : 400;
  let detail: unknown = error.details ?? undefined;
  try {
    detail = error.details ? JSON.parse(error.details) : undefined;
  } catch {
    /* keep string */
  }
  return json(Number.isFinite(status) && status >= 400 ? status : 400, { code: error.message ?? "ERROR", detail });
}

/** Scheduled/internal functions accept either the service role key or the CRON_SECRET header. */
export function isInternalCall(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") === secret) return true;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!service && req.headers.get("authorization") === `Bearer ${service}`;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Salted, truncated IP hash for logs (never the IP itself). */
export async function ipHash(req: Request): Promise<string> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("cf-connecting-ip") ?? "unknown";
  return (await sha256Hex(`${Deno.env.get("IP_HASH_SALT") ?? "maskinid"}:${ip}`)).slice(0, 32);
}
